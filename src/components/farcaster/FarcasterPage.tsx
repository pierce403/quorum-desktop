import * as React from 'react';
import { t } from '@lingui/core/macro';
import { Button, Callout, Icon, Input, TextArea } from '../primitives';
import { useQueryClient } from '@tanstack/react-query';
import { useOptionalShellState } from '../shell/useShellState';
import { FarcasterCastCard } from './FarcasterCastCard';
import { FarcasterAccountModal } from './FarcasterAccountModal';
import {
  resolveFarcasterUsername,
  resolveChannelParentUrl,
  isSafeFarcasterCast,
  useDesktopChannelFeed,
  useDesktopChannelInfo,
  useFarcasterProfile,
  useFarcasterThread,
  useTrendingFeed,
  type ThreadNode,
} from './useFarcasterDesktop';
import {
  useHomeFeed,
  useReactToCast,
  useSubmitCast,
  type NormalizedCast,
} from '@quilibrium/quorum-shared';
import {
  desktopFarcasterSignerStore,
  disconnectDesktopFarcasterAccount,
  loadDesktopFarcasterAccount,
  type DesktopFarcasterAccount,
} from '@/services/FarcasterAccountService';
import './FarcasterPage.scss';

const PhoneHeader: React.FC = () => {
  const shell = useOptionalShellState();
  if (!shell || shell.viewport !== 'phone') return null;
  return (
    <div className="chat-header text-main">
      <Button type="unstyled" onClick={shell.openDrawer} className="header-icon-button" iconName="menu" iconSize="lg" iconOnly ariaLabel={t`Open navigation`} />
    </div>
  );
};

const ChannelHeader: React.FC<{ channelKey: string }> = ({ channelKey }) => {
  const channelInfo = useDesktopChannelInfo(channelKey);
  const info = channelInfo.data;
  if (!info) return null;
  return (
    <div className="farcaster-channel-header">
      {info.imageUrl ? (
        <img className="farcaster-channel-header__image" src={info.imageUrl} alt="" />
      ) : (
        <div className="farcaster-channel-header__image farcaster-channel-header__image--fallback">
          /{channelKey.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="farcaster-channel-header__details">
        <h2>{info.name || `/${channelKey}`}</h2>
        {info.description && <p>{info.description}</p>}
        {info.followerCount !== undefined && (
          <span className="farcaster-channel-header__followers">
            <strong>{info.followerCount.toLocaleString()}</strong> {t`followers`}
          </span>
        )}
      </div>
    </div>
  );
};

const POPULAR_CHANNELS = [
  'farcaster',
  'ethereum',
  'base',
  'dev',
  'zk',
  'crypto',
  'nouns',
  'memes',
];

const useInfiniteScroll = (
  sentinelRef: React.RefObject<HTMLDivElement | null>,
  hasNextPage: boolean | undefined,
  isFetchingNextPage: boolean,
  fetchNextPage: () => void
) => {
  React.useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage || isFetchingNextPage) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          fetchNextPage();
        }
      },
      { rootMargin: '400px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [sentinelRef, hasNextPage, isFetchingNextPage, fetchNextPage]);
};

type View =
  | { kind: 'feed' }
  | { kind: 'channel'; channel: string }
  | { kind: 'profile'; fid: number }
  | { kind: 'thread'; hash: string };

type FeedTab = 'following' | 'trending';

export const FarcasterPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [view, setView] = React.useState<View>({ kind: 'feed' });
  const [feedTab, setFeedTab] = React.useState<FeedTab>('following');
  const [search, setSearch] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState(false);
  const [account, setAccount] = React.useState<DesktopFarcasterAccount | null>(null);
  const [accountLoaded, setAccountLoaded] = React.useState(false);
  const [showImport, setShowImport] = React.useState(false);
  const [composeText, setComposeText] = React.useState('');
  const [composeError, setComposeError] = React.useState<string | null>(null);
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    void loadDesktopFarcasterAccount()
      .then((acc) => {
        setAccount(acc);
        if (!acc) setFeedTab('trending');
      })
      .finally(() => setAccountLoaded(true));
  }, []);

  const showFollowing = accountLoaded && account !== null && feedTab === 'following';
  const trending = useTrendingFeed(accountLoaded && (feedTab === 'trending' || account === null));
  const home = useHomeFeed({
    fid: account?.fid,
    token: account?.authToken,
    enabled: showFollowing,
    filterCast: isSafeFarcasterCast,
  });
  const channel = useDesktopChannelFeed(
    view.kind === 'channel' ? view.channel : null,
    account?.authToken
  );
  const profile = useFarcasterProfile(view.kind === 'profile' ? view.fid : null);
  const thread = useFarcasterThread(view.kind === 'thread' ? view.hash : null);
  const submitCast = useSubmitCast({
    fid: account?.fid,
    token: account?.authToken,
    signerStore: desktopFarcasterSignerStore,
  });
  const reactToCast = useReactToCast({
    fid: account?.fid,
    token: account?.authToken,
    signerStore: desktopFarcasterSignerStore,
  });

  const openUsername = React.useCallback(async (query: string) => {
    const clean = query.replace(/^[@/]/, '').trim();
    if (!clean) return;
    setSearchError(false);
    setSearching(true);
    try {
      const fid = await resolveFarcasterUsername(clean);
      setSearching(false);
      if (fid !== null) {
        setView({ kind: 'profile', fid });
        return;
      }
      setView({ kind: 'channel', channel: clean });
    } catch {
      setSearching(false);
      setView({ kind: 'channel', channel: clean });
    }
  }, []);

  const submitSearch = React.useCallback(() => {
    const query = search.trim();
    if (!query) return;
    if (query.startsWith('/')) {
      setSearchError(false);
      setView({ kind: 'channel', channel: query.slice(1) });
      return;
    }
    void openUsername(query);
  }, [openUsername, search]);

  const cardProps = {
    onOpenProfile: (fid: number) => setView({ kind: 'profile', fid }),
    onOpenThread: (hash: string) => setView({ kind: 'thread', hash }),
    onOpenChannel: (nextChannel: string) => setView({ kind: 'channel', channel: nextChannel }),
    onOpenUsername: openUsername,
    onReact: account ? async (targetCast: NormalizedCast, reaction: 'like' | 'recast') => {
      setComposeError(null);
      const isRemoving = reaction === 'like'
        ? Boolean(targetCast.reactions.viewerLiked)
        : Boolean(targetCast.reactions.viewerRecasted);
      try {
        await reactToCast.mutateAsync({
          castHashHex: targetCast.hash,
          castFid: targetCast.author.fid,
          reaction,
          remove: isRemoving,
        });
      } catch (cause) {
        setComposeError(cause instanceof Error ? cause.message : t`Reaction could not be published.`);
        throw cause;
      }
    } : undefined,
  };

  const primaryFeed = showFollowing ? home : trending;
  let title = t`Trending`;
  let casts: NormalizedCast[] = [];
  let isLoading = primaryFeed.isLoading;
  let isFetchingNextPage = primaryFeed.isFetchingNextPage;
  let hasNextPage = primaryFeed.hasNextPage;
  let error = primaryFeed.error;
  let fetchNextPage = primaryFeed.fetchNextPage;
  let refetch = primaryFeed.refetch;

  if (view.kind === 'channel') {
    title = `/${view.channel}`;
    casts = channel.data?.pages.flatMap((page) => page.casts) ?? [];
    isLoading = channel.isLoading;
    isFetchingNextPage = channel.isFetchingNextPage;
    hasNextPage = channel.hasNextPage;
    error = channel.error;
    fetchNextPage = channel.fetchNextPage;
    refetch = channel.refetch;
  } else if (view.kind === 'feed') {
    casts = primaryFeed.data?.pages.flatMap((page) => page.casts) ?? [];
    title = showFollowing ? t`Following` : t`Trending`;
  }

  useInfiniteScroll(
    sentinelRef,
    hasNextPage,
    isFetchingNextPage,
    () => void fetchNextPage()
  );

  const isDetail = view.kind !== 'feed';

  const publish = async () => {
    const text = composeText.trim();
    if (!text || !account) return;
    setComposeError(null);
    try {
      const root = view.kind === 'thread' ? thread.data?.[0] : undefined;
      const channelParentUrl = view.kind === 'channel'
        ? await resolveChannelParentUrl(view.channel)
        : undefined;
      await submitCast.mutateAsync({
        text,
        parent: root ? { castHashHex: root.hash, fid: root.author.fid } : undefined,
        channelKey: view.kind === 'channel' ? view.channel : undefined,
        channelKeyToUrl: channelParentUrl ? () => channelParentUrl : undefined,
      });
      setComposeText('');
      await queryClient.invalidateQueries({ queryKey: ['farcaster'] });
      if (view.kind === 'thread') await thread.refetch();
      else await refetch();
    } catch (cause) {
      setComposeError(cause instanceof Error ? cause.message : t`Cast could not be published.`);
    }
  };

  const disconnect = async () => {
    await disconnectDesktopFarcasterAccount();
    setAccount(null);
    setFeedTab('trending');
    setView({ kind: 'feed' });
    queryClient.removeQueries({ queryKey: ['farcaster'] });
  };

  return (
    <div className="farcaster-page">
      <PhoneHeader />
      <div className="farcaster-page__inner">
        <header className="farcaster-page__header">
          <div className="farcaster-page__heading">
            {isDetail && <Button type="unstyled" iconName="arrow-left" iconOnly ariaLabel={t`Back`} onClick={() => setView({ kind: 'feed' })} />}
            <Icon name="farcaster" size="2xl" />
            <div>
              <h1 className="farcaster-page__title">{t`Farcaster`}</h1>
              <span className="farcaster-page__subtitle">{title}</span>
            </div>
          </div>
          <div className="farcaster-page__search">
            <Input
              type="search"
              variant="bordered"
              value={search}
              onChange={(value: string) => { setSearch(value); setSearchError(false); }}
              onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') submitSearch(); }}
              placeholder={t`Open @username or /channel`}
              leftIcon={<Icon name="search" size="sm" />}
              error={searchError}
            />
            <Button type="secondary" size="small" disabled={searching || !search.trim()} onClick={submitSearch}>
              {searching ? t`Searching...` : t`Open`}
            </Button>
          </div>
        </header>

        <div className="farcaster-account-bar">
          {account ? (
            <>
              <span>{account.pfpUrl && <img src={account.pfpUrl} alt="" />} Connected as <strong>@{account.username}</strong></span>
              <Button type="unstyled" size="small" onClick={disconnect}>{t`Disconnect`}</Button>
            </>
          ) : (
            <>
              <span>{t`Browse the public network or import your Farcaster account to post and react.`}</span>
              <Button type="primary" size="small" onClick={() => setShowImport(true)}>{t`Import account`}</Button>
            </>
          )}
        </div>

        {/* Feed tabs when account is connected */}
        {view.kind === 'feed' && account && (
          <div className="farcaster-tabs">
            <Button
              type="unstyled"
              className={`farcaster-tabs__button ${feedTab === 'following' ? 'farcaster-tabs__button--active' : ''}`}
              onClick={() => setFeedTab('following')}
            >
              {t`Following`}
            </Button>
            <Button
              type="unstyled"
              className={`farcaster-tabs__button ${feedTab === 'trending' ? 'farcaster-tabs__button--active' : ''}`}
              onClick={() => setFeedTab('trending')}
            >
              {t`Trending`}
            </Button>
          </div>
        )}

        {/* Quick channel pills */}
        {view.kind === 'feed' && (
          <div className="farcaster-channels-strip">
            <span className="farcaster-channels-strip__label">{t`Popular:`}</span>
            {POPULAR_CHANNELS.map((ch) => (
              <Button
                key={ch}
                type="unstyled"
                className="farcaster-channels-strip__chip"
                onClick={() => setView({ kind: 'channel', channel: ch })}
              >
                /{ch}
              </Button>
            ))}
          </div>
        )}

        {account && view.kind !== 'thread' && (
          <div className="farcaster-compose">
            {composeError && <Callout variant="error" size="sm">{composeError}</Callout>}
            <TextArea
              value={composeText}
              onChange={setComposeText}
              placeholder={t`What's happening?`}
              rows={3}
              autoResize
              maxRows={8}
              disabled={submitCast.isPending}
            />
            <div className="farcaster-compose__footer">
              <span>{new TextEncoder().encode(composeText).length} / 320 bytes</span>
              <Button type="primary" size="small" disabled={!composeText.trim() || new TextEncoder().encode(composeText).length > 320 || submitCast.isPending} onClick={publish}>
                {submitCast.isPending ? t`Publishing...` : t`Cast`}
              </Button>
            </div>
          </div>
        )}

        {view.kind === 'profile' && <ProfileView fid={view.fid} profile={profile} cardProps={cardProps} />}

        {view.kind === 'thread' && (
          <ThreadView
            rootHash={view.hash}
            account={account}
            onBack={() => setView({ kind: 'feed' })}
            onOpenThread={(hash: string) => setView({ kind: 'thread', hash })}
            cardProps={cardProps}
            submitCast={submitCast}
          />
        )}

        {view.kind === 'channel' && <ChannelHeader channelKey={view.channel} />}

        {(view.kind === 'feed' || view.kind === 'channel') && (
          <section className="farcaster-feed" aria-label={title}>
            <div className="farcaster-feed__toolbar">
              <span>{view.kind === 'feed' ? (showFollowing ? t`Posts from accounts you follow` : t`Live from the Farcaster network`) : t`Channel feed`}</span>
              <Button type="unstyled" iconName="refresh" iconOnly ariaLabel={t`Refresh`} onClick={() => refetch()} />
            </div>
            {(isLoading || (isFetchingNextPage && casts.length === 0)) && <LoadingState label={t`Loading Farcaster...`} />}
            {error && casts.length === 0 && <ErrorState onRetry={() => refetch()} />}
            {!isLoading && !isFetchingNextPage && !error && casts.length === 0 && (
              <div className="empty-state empty-state--fill">
                <Icon name="farcaster" size="5xl" className="empty-state__icon" />
                <p className="empty-state__title">{t`No casts found.`}</p>
              </div>
            )}
            {casts.map((cast) => <FarcasterCastCard key={cast.hash} cast={cast} {...cardProps} />)}
            {casts.length > 0 && <div ref={sentinelRef} className="farcaster-feed__sentinel" aria-hidden="true" />}
            {casts.length > 0 && hasNextPage && (
              <Button type="secondary" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
                {isFetchingNextPage ? t`Loading...` : t`Load more`}
              </Button>
            )}
          </section>
        )}
      </div>
      <FarcasterAccountModal visible={showImport} onClose={() => setShowImport(false)} onImported={(next) => { setAccount(next); setFeedTab('following'); setView({ kind: 'feed' }); }} />
    </div>
  );
};

const LoadingState: React.FC<{ label: string }> = ({ label }) => (
  <div className="farcaster-page__state"><Icon name="spinner" className="icon-spin" /><span>{label}</span></div>
);

const ErrorState: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <div className="farcaster-page__state farcaster-page__state--error">
    <Icon name="warning" />
    <span>{t`Farcaster could not be reached.`}</span>
    <Button type="secondary" size="small" onClick={onRetry}>{t`Retry`}</Button>
  </div>
);

type ProfileHook = ReturnType<typeof useFarcasterProfile>;

type ProfileTab = 'casts' | 'replies' | 'media';

const ProfileView: React.FC<{
  fid: number;
  profile: ProfileHook;
  cardProps: Omit<React.ComponentProps<typeof FarcasterCastCard>, 'cast'>;
}> = ({ fid, profile, cardProps }) => {
  const [tab, setTab] = React.useState<ProfileTab>('casts');
  const user = profile.user.data;
  const profileSentinelRef = React.useRef<HTMLDivElement | null>(null);

  const activeQuery = tab === 'replies' ? profile.replies : profile.casts;
  const rawCasts = activeQuery.data?.pages.flatMap((page) => page.casts) ?? [];
  const casts = React.useMemo(() => {
    if (tab === 'casts') {
      return rawCasts.filter((c) => !c.parentHash && !c.parentAuthor);
    }
    if (tab === 'media') {
      return rawCasts.filter((c) =>
        c.embeds.some(
          (e) =>
            Boolean(
              e.image ||
                e.video ||
                (e.url &&
                  /\.(?:avif|gif|jpe?g|png|webp|mp4|webm|mov|m4v|m3u8)(?:$|[?#])/i.test(
                    e.url
                  )) ||
                (e.url &&
                  (e.url.includes('stream.farcaster.xyz') ||
                    e.url.includes('imagedelivery.net') ||
                    e.url.includes('cloudflarestream.com') ||
                    e.url.includes('livepeer.studio')))
            )
        )
      );
    }
    return rawCasts;
  }, [rawCasts, tab]);

  useInfiniteScroll(
    profileSentinelRef,
    activeQuery.hasNextPage,
    activeQuery.isFetchingNextPage,
    () => void activeQuery.fetchNextPage()
  );

  return (
    <section className="farcaster-profile">
      {profile.user.isLoading && <LoadingState label={t`Loading profile...`} />}
      {profile.user.error && <ErrorState onRetry={() => profile.user.refetch()} />}
      {user && (
        <header className="farcaster-profile__header">
          {user.pfpUrl ? (
            <img src={user.pfpUrl} alt="" />
          ) : (
            <span>{(user.displayName || user.username || '?').slice(0, 1).toUpperCase()}</span>
          )}
          <div>
            <h2>{user.displayName || user.username}</h2>
            <p>@{user.username} · FID {fid}</p>
            {user.bio && <div className="farcaster-profile__bio">{user.bio}</div>}
            <div className="farcaster-profile__stats">
              <span><strong>{user.followingCount?.toLocaleString() ?? '—'}</strong> {t`Following`}</span>
              <span><strong>{user.followerCount?.toLocaleString() ?? '—'}</strong> {t`Followers`}</span>
            </div>
          </div>
        </header>
      )}
      <div className="farcaster-profile__tabs">
        <button
          type="button"
          className={`farcaster-profile__tab ${tab === 'casts' ? 'farcaster-profile__tab--active' : ''}`}
          onClick={() => setTab('casts')}
        >
          {t`Casts`}
        </button>
        <button
          type="button"
          className={`farcaster-profile__tab ${tab === 'replies' ? 'farcaster-profile__tab--active' : ''}`}
          onClick={() => setTab('replies')}
        >
          {t`Casts & Replies`}
        </button>
        <button
          type="button"
          className={`farcaster-profile__tab ${tab === 'media' ? 'farcaster-profile__tab--active' : ''}`}
          onClick={() => setTab('media')}
        >
          {t`Media`}
        </button>
      </div>
      <div className="farcaster-feed">
        {activeQuery.isLoading && casts.length === 0 && <LoadingState label={t`Loading casts...`} />}
        {activeQuery.error && casts.length === 0 && <ErrorState onRetry={() => activeQuery.refetch()} />}
        {!activeQuery.isLoading && casts.length === 0 && (
          <div className="empty-state empty-state--fill">
            <Icon name="farcaster" size="5xl" className="empty-state__icon" />
            <p className="empty-state__title">{t`No casts found.`}</p>
          </div>
        )}
        {casts.map((cast) => (
          <FarcasterCastCard key={cast.hash} cast={cast} {...cardProps} />
        ))}
        {casts.length > 0 && <div ref={profileSentinelRef} className="farcaster-feed__sentinel" aria-hidden="true" />}
        {casts.length > 0 && activeQuery.hasNextPage && (
          <Button
            type="secondary"
            disabled={activeQuery.isFetchingNextPage}
            onClick={() => activeQuery.fetchNextPage()}
          >
            {activeQuery.isFetchingNextPage ? t`Loading...` : t`Load more`}
          </Button>
        )}
      </div>
    </section>
  );
};

const InlineReplyComposer: React.FC<{
  targetCast: NormalizedCast;
  onCancel?: () => void;
  onSubmit: (text: string, targetCast: NormalizedCast) => Promise<void>;
  isSubmitting: boolean;
}> = ({ targetCast, onCancel, onSubmit, isSubmitting }) => {
  const [text, setText] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const byteLength = new TextEncoder().encode(text).length;

  const handleSubmit = async () => {
    if (!text.trim() || byteLength > 320 || isSubmitting) return;
    setError(null);
    try {
      await onSubmit(text, targetCast);
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t`Failed to send reply.`);
    }
  };

  return (
    <div className="farcaster-inline-reply">
      <div className="farcaster-inline-reply__header">
        <span>
          {t`Replying to`}{' '}
          <strong className="farcaster-inline-reply__target">
            @{targetCast.author.username}
          </strong>
        </span>
        {onCancel && (
          <Button
            type="unstyled"
            className="farcaster-inline-reply__cancel-icon"
            onClick={onCancel}
            ariaLabel={t`Cancel reply`}
          >
            <Icon name="close" size="sm" />
          </Button>
        )}
      </div>
      {error && <Callout variant="error" size="sm">{error}</Callout>}
      <TextArea
        className="farcaster-inline-reply__textarea"
        value={text}
        onChange={setText}
        placeholder={t`Write a reply...`}
        rows={2}
        autoResize
        maxRows={6}
        disabled={isSubmitting}
        autoFocus
      />
      <div className="farcaster-inline-reply__footer">
        <span className="farcaster-inline-reply__bytes">{byteLength} / 320 bytes</span>
        <div className="farcaster-inline-reply__actions">
          {onCancel && (
            <Button
              type="secondary"
              size="small"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              {t`Cancel`}
            </Button>
          )}
          <Button
            type="primary"
            size="small"
            disabled={!text.trim() || byteLength > 320 || isSubmitting}
            onClick={handleSubmit}
          >
            {isSubmitting ? t`Replying...` : t`Reply`}
          </Button>
        </div>
      </div>
    </div>
  );
};

const ThreadNodeItem: React.FC<{
  node: ThreadNode;
  activeReplyCast: NormalizedCast | null;
  onSelectReply: (cast: NormalizedCast | null) => void;
  onSubmitReply: (text: string, targetCast: NormalizedCast) => Promise<void>;
  isSubmitting: boolean;
  cardProps: Omit<React.ComponentProps<typeof FarcasterCastCard>, 'cast' | 'isRoot' | 'depth' | 'onReply'>;
}> = ({
  node,
  activeReplyCast,
  onSelectReply,
  onSubmitReply,
  isSubmitting,
  cardProps,
}) => {
  const isTargetForReply = activeReplyCast?.hash === node.cast.hash;

  return (
    <div
      className={`farcaster-thread-branch farcaster-thread-branch--depth-${Math.min(node.depth, 6)} ${node.depth === 0 ? 'farcaster-thread-branch--root' : ''}`}
    >
      <FarcasterCastCard
        cast={node.cast}
        isRoot={node.depth === 0}
        depth={node.depth}
        onReply={(cast) => onSelectReply(cast)}
        {...cardProps}
      />
      {isTargetForReply && (
        <InlineReplyComposer
          targetCast={node.cast}
          onCancel={() => onSelectReply(null)}
          onSubmit={onSubmitReply}
          isSubmitting={isSubmitting}
        />
      )}
      {node.replies.length > 0 && (
        <div className="farcaster-thread-branch__children">
          {node.replies.map((child) => (
            <ThreadNodeItem
              key={child.cast.hash}
              node={child}
              activeReplyCast={activeReplyCast}
              onSelectReply={onSelectReply}
              onSubmitReply={onSubmitReply}
              isSubmitting={isSubmitting}
              cardProps={cardProps}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const ThreadView: React.FC<{
  rootHash: string;
  account: DesktopFarcasterAccount | null;
  onBack: () => void;
  onOpenThread: (hash: string) => void;
  cardProps: Omit<React.ComponentProps<typeof FarcasterCastCard>, 'cast' | 'isRoot' | 'depth' | 'onReply'>;
  submitCast: ReturnType<typeof useSubmitCast>;
}> = ({ rootHash, account, onBack, onOpenThread, cardProps, submitCast }) => {
  const queryClient = useQueryClient();
  const thread = useFarcasterThread(rootHash);
  const [activeReplyCast, setActiveReplyCast] = React.useState<NormalizedCast | null>(null);

  const handleSubmitReply = async (text: string, targetCast: NormalizedCast) => {
    await submitCast.mutateAsync({
      text,
      parent: {
        castHashHex: targetCast.hash,
        fid: targetCast.author.fid,
      },
    });
    setActiveReplyCast(null);
    await queryClient.invalidateQueries({
      queryKey: ['farcaster', 'desktop', 'thread-tree', rootHash],
    });
  };

  const rootCast = thread.data?.cast;
  const isSubthread = Boolean(
    rootCast &&
      ((rootCast.threadHash && rootCast.threadHash !== rootCast.hash) || rootCast.parentHash)
  );
  const fullThreadRootHash = rootCast?.threadHash || rootCast?.parentHash;

  return (
    <section className="farcaster-thread-view" aria-label={t`Cast thread`}>
      <div className="farcaster-thread-view__toolbar">
        <Button
          type="unstyled"
          className="farcaster-thread-view__back-btn"
          onClick={onBack}
          ariaLabel={t`Back to feed`}
        >
          <Icon name="arrow-left" size="sm" />
          <span>{t`Back`}</span>
        </Button>
        <span className="farcaster-thread-view__title">{t`Thread`}</span>
        <Button
          type="unstyled"
          iconName="refresh"
          iconOnly
          ariaLabel={t`Refresh thread`}
          onClick={() => thread.refetch()}
        />
      </div>

      {isSubthread && fullThreadRootHash && (
        <div className="farcaster-thread-view__full-thread-banner">
          <Button
            type="secondary"
            className="farcaster-thread-view__full-thread-btn"
            onClick={() => onOpenThread(fullThreadRootHash)}
          >
            <Icon name="arrow-up" size="sm" />
            <span>{t`View full thread`}</span>
          </Button>
        </div>
      )}

      {thread.isLoading && <LoadingState label={t`Loading thread...`} />}
      {thread.error && <ErrorState onRetry={() => thread.refetch()} />}

      {thread.data && (
        <div className="farcaster-thread-tree">
          <ThreadNodeItem
            node={thread.data}
            activeReplyCast={activeReplyCast}
            onSelectReply={setActiveReplyCast}
            onSubmitReply={handleSubmitReply}
            isSubmitting={submitCast.isPending}
            cardProps={cardProps}
          />
          {!activeReplyCast && account && (
            <div className="farcaster-thread-tree__bottom-reply">
              <InlineReplyComposer
                targetCast={thread.data.cast}
                onSubmit={handleSubmitReply}
                isSubmitting={submitCast.isPending}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default FarcasterPage;
