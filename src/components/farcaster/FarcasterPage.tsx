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
  useFarcasterProfile,
  useFarcasterThread,
  useTrendingFeed,
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

type View =
  | { kind: 'trending' }
  | { kind: 'channel'; channel: string }
  | { kind: 'profile'; fid: number }
  | { kind: 'thread'; hash: string };

export const FarcasterPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [view, setView] = React.useState<View>({ kind: 'trending' });
  const [search, setSearch] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState(false);
  const [account, setAccount] = React.useState<DesktopFarcasterAccount | null>(null);
  const [accountLoaded, setAccountLoaded] = React.useState(false);
  const [showImport, setShowImport] = React.useState(false);
  const [composeText, setComposeText] = React.useState('');
  const [composeError, setComposeError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void loadDesktopFarcasterAccount()
      .then(setAccount)
      .finally(() => setAccountLoaded(true));
  }, []);

  const trending = useTrendingFeed(accountLoaded && account === null);
  const home = useHomeFeed({
    fid: account?.fid,
    token: account?.authToken,
    enabled: accountLoaded && account !== null,
    filterCast: isSafeFarcasterCast,
  });
  const channel = useDesktopChannelFeed(view.kind === 'channel' ? view.channel : null);
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

  const openUsername = React.useCallback(async (username: string) => {
    setSearchError(false);
    setSearching(true);
    const fid = await resolveFarcasterUsername(username);
    setSearching(false);
    if (fid === null) {
      setSearchError(true);
      return;
    }
    setView({ kind: 'profile', fid });
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
    onReact: account ? async (cast: NormalizedCast, reaction: 'like' | 'recast') => {
      setComposeError(null);
      try {
        await reactToCast.mutateAsync({
          castHashHex: cast.hash,
          castFid: cast.author.fid,
          reaction,
          remove: reaction === 'like' ? cast.reactions.viewerLiked : cast.reactions.viewerRecasted,
        });
        await queryClient.invalidateQueries({ queryKey: ['farcaster'] });
      } catch (cause) {
        setComposeError(cause instanceof Error ? cause.message : t`Reaction could not be published.`);
      }
    } : undefined,
  };

  let title = t`Trending`;
  let casts: NormalizedCast[] = [];
  const primaryFeed = account ? home : trending;
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
  } else if (view.kind === 'trending') {
    casts = primaryFeed.data?.pages.flatMap((page) => page.casts) ?? [];
    title = account ? t`Following` : t`Trending`;
  }

  const isDetail = view.kind !== 'trending';

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
    setView({ kind: 'trending' });
    queryClient.removeQueries({ queryKey: ['farcaster'] });
  };

  return (
    <div className="farcaster-page">
      <PhoneHeader />
      <div className="farcaster-page__inner">
        <header className="farcaster-page__header">
          <div className="farcaster-page__heading">
            {isDetail && <Button type="unstyled" iconName="arrow-left" iconOnly ariaLabel={t`Back`} onClick={() => setView({ kind: 'trending' })} />}
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

        {account && (
          <div className="farcaster-compose">
            {composeError && <Callout variant="error" size="sm">{composeError}</Callout>}
            <TextArea
              value={composeText}
              onChange={setComposeText}
              placeholder={view.kind === 'thread' ? t`Write a reply...` : t`What's happening?`}
              rows={3}
              autoResize
              maxRows={8}
              disabled={submitCast.isPending}
            />
            <div className="farcaster-compose__footer">
              <span>{new TextEncoder().encode(composeText).length} / 320 bytes</span>
              <Button type="primary" size="small" disabled={!composeText.trim() || new TextEncoder().encode(composeText).length > 320 || submitCast.isPending} onClick={publish}>
                {submitCast.isPending ? t`Publishing...` : view.kind === 'thread' ? t`Reply` : t`Cast`}
              </Button>
            </div>
          </div>
        )}

        {view.kind === 'profile' && <ProfileView fid={view.fid} profile={profile} cardProps={cardProps} />}

        {view.kind === 'thread' && (
          <section className="farcaster-feed" aria-label={t`Cast thread`}>
            {thread.isLoading && <LoadingState label={t`Loading thread...`} />}
            {thread.error && <ErrorState onRetry={() => thread.refetch()} />}
            {thread.data?.map((cast) => <FarcasterCastCard key={cast.hash} cast={cast} {...cardProps} />)}
          </section>
        )}

        {(view.kind === 'trending' || view.kind === 'channel') && (
          <section className="farcaster-feed" aria-label={title}>
            <div className="farcaster-feed__toolbar">
              <span>{view.kind === 'trending' ? (account ? t`Posts from accounts you follow` : t`Live from the Farcaster network`) : t`Channel feed`}</span>
              <Button type="unstyled" iconName="refresh" iconOnly ariaLabel={t`Refresh`} onClick={() => refetch()} />
            </div>
            {isLoading && casts.length === 0 && <LoadingState label={t`Loading Farcaster...`} />}
            {error && casts.length === 0 && <ErrorState onRetry={() => refetch()} />}
            {!isLoading && !error && casts.length === 0 && (
              <div className="empty-state empty-state--fill">
                <Icon name="farcaster" size="5xl" className="empty-state__icon" />
                <p className="empty-state__title">{t`No casts found.`}</p>
              </div>
            )}
            {casts.map((cast) => <FarcasterCastCard key={cast.hash} cast={cast} {...cardProps} />)}
            {hasNextPage && (
              <Button type="secondary" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
                {isFetchingNextPage ? t`Loading...` : t`Load more`}
              </Button>
            )}
          </section>
        )}
      </div>
      <FarcasterAccountModal visible={showImport} onClose={() => setShowImport(false)} onImported={(next) => { setAccount(next); setView({ kind: 'trending' }); }} />
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

const ProfileView: React.FC<{
  fid: number;
  profile: ProfileHook;
  cardProps: Omit<React.ComponentProps<typeof FarcasterCastCard>, 'cast'>;
}> = ({ fid, profile, cardProps }) => {
  const user = profile.user.data;
  const casts = profile.casts.data?.pages.flatMap((page) => page.casts) ?? [];
  return (
    <section className="farcaster-profile">
      {profile.user.isLoading && <LoadingState label={t`Loading profile...`} />}
      {profile.user.error && <ErrorState onRetry={() => profile.user.refetch()} />}
      {user && (
        <header className="farcaster-profile__header">
          {user.pfpUrl ? <img src={user.pfpUrl} alt="" /> : <span>{(user.displayName || user.username || '?').slice(0, 1).toUpperCase()}</span>}
          <div>
            <h2>{user.displayName || user.username}</h2>
            <p>@{user.username} · FID {fid}</p>
            {user.bio && <div className="farcaster-profile__bio">{user.bio}</div>}
            <div className="farcaster-profile__stats">
              <span><strong>{user.followingCount?.toLocaleString() ?? '—'}</strong> Following</span>
              <span><strong>{user.followerCount?.toLocaleString() ?? '—'}</strong> Followers</span>
            </div>
          </div>
        </header>
      )}
      <div className="farcaster-feed">
        {profile.casts.isLoading && <LoadingState label={t`Loading casts...`} />}
        {profile.casts.error && <ErrorState onRetry={() => profile.casts.refetch()} />}
        {casts.map((cast) => <FarcasterCastCard key={cast.hash} cast={cast} {...cardProps} />)}
        {profile.casts.hasNextPage && (
          <Button type="secondary" disabled={profile.casts.isFetchingNextPage} onClick={() => profile.casts.fetchNextPage()}>
            {profile.casts.isFetchingNextPage ? t`Loading...` : t`Load more`}
          </Button>
        )}
      </div>
    </section>
  );
};

export default FarcasterPage;
