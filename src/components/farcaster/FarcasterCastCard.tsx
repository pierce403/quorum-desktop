import * as React from 'react';
import { t } from '@lingui/core/macro';
import Hls from 'hls.js';
import { Button, Icon } from '../primitives';
import {
  useFarcasterCast,
  useFarcasterCastByUrl,
  type NormalizedCast,
  type NormalizedEmbed,
} from '@quilibrium/quorum-shared';

interface FarcasterCastCardProps {
  cast: NormalizedCast;
  onOpenProfile: (fid: number) => void;
  onOpenThread: (hash: string) => void;
  onOpenChannel: (channel: string) => void;
  onOpenUsername: (username: string) => void;
  onReply?: (cast: NormalizedCast) => void;
  onReact?: (cast: NormalizedCast, reaction: 'like' | 'recast') => Promise<void>;
  isRoot?: boolean;
  depth?: number;
}

function formatTimestamp(timestamp: number): string {
  const elapsed = Date.now() - timestamp;
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp);
}

function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

function isImageUrl(url: string): boolean {
  return (
    /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i.test(url) ||
    /imagedelivery\.net|i\.imgur\.com/i.test(url)
  );
}

function isVideoUrl(url: string): boolean {
  return (
    /\.(?:mp4|webm|mov|m4v|m3u8)(?:$|[?#])/i.test(url) ||
    /stream\.farcaster\.xyz|cloudflarestream\.com|livepeer\.studio/i.test(url)
  );
}

const FarcasterVideoPlayer: React.FC<{
  src: string;
  poster?: string;
}> = ({ src, poster }) => {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const isHls = src.includes('.m3u8') || src.includes('stream.farcaster.xyz');

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      return () => {
        hls.destroy();
      };
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
    } else {
      video.src = src;
    }
  }, [src]);

  return (
    <video
      ref={videoRef}
      className="farcaster-cast__video"
      controls
      preload="metadata"
      poster={poster}
      playsInline
      onClick={(e) => e.stopPropagation()}
    />
  );
};

const QuotedCastCard: React.FC<{
  castId?: { fid: number; hash: string };
  url?: string;
  onOpenThread: (hash: string) => void;
  onOpenProfile: (fid: number) => void;
}> = ({ castId, url, onOpenThread, onOpenProfile }) => {
  const match = url ? url.match(/https:\/\/(?:warpcast\.com|farcaster\.xyz)\/([a-zA-Z0-9._-]+)\/(0x[a-fA-F0-9]+)/i) : null;
  const usernameFromUrl = match ? match[1] : undefined;
  const hashFromUrl = match ? match[2] : undefined;

  const targetHash = castId?.hash ?? hashFromUrl;
  const targetFid = castId?.fid;

  const castByHash = useFarcasterCast(targetHash, targetFid, {
    enabled: Boolean(targetHash && targetFid),
  });
  const castByUrl = useFarcasterCastByUrl(usernameFromUrl, hashFromUrl, {
    enabled: Boolean(usernameFromUrl && hashFromUrl && !targetFid),
  });

  const quoted = castByHash.data ?? castByUrl.data;
  const isLoading = castByHash.isLoading || castByUrl.isLoading;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (targetHash) onOpenThread(targetHash);
    else if (quoted?.hash) onOpenThread(quoted.hash);
    else if (url) openExternal(url);
  };

  if (quoted) {
    return (
      <div className="farcaster-cast__quote" role="button" tabIndex={0} onClick={handleClick}>
        <header className="farcaster-cast__quote-header">
          {quoted.author.pfpUrl ? (
            <img className="farcaster-cast__quote-avatar" src={quoted.author.pfpUrl} alt="" loading="lazy" />
          ) : (
            <span className="farcaster-cast__quote-avatar farcaster-cast__quote-avatar--fallback">
              {(quoted.author.displayName || quoted.author.username || '?').slice(0, 1).toUpperCase()}
            </span>
          )}
          <strong>{quoted.author.displayName || quoted.author.username}</strong>
          <span>@{quoted.author.username}</span>
          <span className="farcaster-cast__quote-dot">·</span>
          <span>{formatTimestamp(quoted.timestamp)}</span>
        </header>
        <p className="farcaster-cast__quote-text">{quoted.text}</p>
      </div>
    );
  }

  return (
    <div className="farcaster-cast__quote" role="button" tabIndex={0} onClick={handleClick}>
      <div className="farcaster-cast__quote-header">
        <Icon name="messages" size="sm" />
        <span>{isLoading ? 'Loading quoted cast...' : 'Quoted cast'}</span>
        {targetHash && <span className="farcaster-cast__quote-hash">{targetHash.slice(0, 10)}</span>}
      </div>
    </div>
  );
};

const CastEmbed: React.FC<{
  embed: NormalizedEmbed;
  onOpenThread: (hash: string) => void;
  onOpenProfile: (fid: number) => void;
}> = ({ embed, onOpenThread, onOpenProfile }) => {
  const imageUrl = embed.image?.url ?? (embed.url && isImageUrl(embed.url) ? embed.url : undefined);
  const videoUrl = embed.video?.url ?? (embed.url && isVideoUrl(embed.url) ? embed.url : undefined);
  const linkUrl = embed.openGraph?.sourceUrl ?? embed.url;

  if (imageUrl) {
    return (
      <button className="farcaster-cast__media-button" type="button" onClick={() => openExternal(imageUrl)}>
        <img className="farcaster-cast__image" src={imageUrl} alt={embed.image?.alt ?? ''} loading="lazy" />
      </button>
    );
  }
  if (videoUrl) {
    return <FarcasterVideoPlayer src={videoUrl} poster={embed.video?.thumbnailUrl} />;
  }
  if (embed.castId) {
    return (
      <QuotedCastCard
        castId={embed.castId}
        onOpenThread={onOpenThread}
        onOpenProfile={onOpenProfile}
      />
    );
  }
  if (linkUrl && /https:\/\/(?:warpcast\.com|farcaster\.xyz)\/([a-zA-Z0-9._-]+)\/(0x[a-fA-F0-9]+)/i.test(linkUrl)) {
    return (
      <QuotedCastCard
        url={linkUrl}
        onOpenThread={onOpenThread}
        onOpenProfile={onOpenProfile}
      />
    );
  }
  if (!linkUrl) return null;
  return (
    <button className="farcaster-cast__link-card" type="button" onClick={() => openExternal(linkUrl)}>
      {embed.openGraph?.image && <img src={embed.openGraph.image} alt="" loading="lazy" />}
      <span>
        <strong>{embed.openGraph?.title ?? embed.openGraph?.domain ?? new URL(linkUrl).hostname}</strong>
        {embed.openGraph?.description && <small>{embed.openGraph.description}</small>}
        <small>{linkUrl}</small>
      </span>
    </button>
  );
};

function renderText(
  text: string,
  onUsername: (username: string) => void,
  onChannel: (channel: string) => void,
  onThread: (hash: string) => void,
) {
  const parts = text.split(/(https?:\/\/[^\s]+|@[a-zA-Z0-9._-]+|\/[a-zA-Z0-9_-]+)/g);
  return parts.map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      const castMatch = part.match(/^https:\/\/(?:warpcast\.com|farcaster\.xyz)\/([a-zA-Z0-9._-]+)\/(0x[a-fA-F0-9]+)/i);
      if (castMatch) {
        return (
          <button
            key={index}
            type="button"
            className="farcaster-cast__text-link"
            onClick={(e) => {
              e.stopPropagation();
              onThread(castMatch[2]);
            }}
          >
            {part}
          </button>
        );
      }
      const channelMatch = part.match(/^https:\/\/(?:warpcast\.com|farcaster\.xyz)\/~\/channel\/([a-zA-Z0-9_-]+)/i);
      if (channelMatch) {
        return (
          <button
            key={index}
            type="button"
            className="farcaster-cast__text-link"
            onClick={(e) => {
              e.stopPropagation();
              onChannel(channelMatch[1]);
            }}
          >
            /{channelMatch[1]}
          </button>
        );
      }
      return (
        <a key={index} href={part} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {part}
        </a>
      );
    }
    if (/^@[a-zA-Z0-9._-]+$/.test(part)) {
      return (
        <button
          key={index}
          type="button"
          className="farcaster-cast__text-link"
          onClick={(e) => {
            e.stopPropagation();
            onUsername(part.slice(1));
          }}
        >
          {part}
        </button>
      );
    }
    if (/^\/[a-zA-Z0-9_-]+$/.test(part)) {
      return (
        <button
          key={index}
          type="button"
          className="farcaster-cast__text-link"
          onClick={(e) => {
            e.stopPropagation();
            onChannel(part.slice(1));
          }}
        >
          {part}
        </button>
      );
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

export const FarcasterCastCard: React.FC<FarcasterCastCardProps> = ({
  cast,
  onOpenProfile,
  onOpenThread,
  onOpenChannel,
  onOpenUsername,
  onReply,
  onReact,
  isRoot,
  depth = 0,
}) => {
  const [isLiked, setIsLiked] = React.useState(Boolean(cast.reactions.viewerLiked));
  const [likesCount, setLikesCount] = React.useState(cast.reactions.likesCount);
  const [isRecasted, setIsRecasted] = React.useState(Boolean(cast.reactions.viewerRecasted));
  const [recastsCount, setRecastsCount] = React.useState(cast.reactions.recastsCount);
  const [pendingReaction, setPendingReaction] = React.useState<'like' | 'recast' | null>(null);

  React.useEffect(() => {
    setIsLiked(Boolean(cast.reactions.viewerLiked));
    setLikesCount(cast.reactions.likesCount);
    setIsRecasted(Boolean(cast.reactions.viewerRecasted));
    setRecastsCount(cast.reactions.recastsCount);
  }, [
    cast.reactions.viewerLiked,
    cast.reactions.likesCount,
    cast.reactions.viewerRecasted,
    cast.reactions.recastsCount,
  ]);

  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onReact || pendingReaction) return;
    const prevLiked = isLiked;
    const prevCount = likesCount;
    const nextLiked = !prevLiked;
    const nextCount = Math.max(0, prevCount + (nextLiked ? 1 : -1));

    setIsLiked(nextLiked);
    setLikesCount(nextCount);
    setPendingReaction('like');

    try {
      await onReact(
        {
          ...cast,
          reactions: {
            ...cast.reactions,
            viewerLiked: prevLiked,
          },
        },
        'like'
      );
    } catch {
      setIsLiked(prevLiked);
      setLikesCount(prevCount);
    } finally {
      setPendingReaction(null);
    }
  };

  const handleRecast = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onReact || pendingReaction) return;
    const prevRecasted = isRecasted;
    const prevCount = recastsCount;
    const nextRecasted = !prevRecasted;
    const nextCount = Math.max(0, prevCount + (nextRecasted ? 1 : -1));

    setIsRecasted(nextRecasted);
    setRecastsCount(nextCount);
    setPendingReaction('recast');

    try {
      await onReact(
        {
          ...cast,
          reactions: {
            ...cast.reactions,
            viewerRecasted: prevRecasted,
          },
        },
        'recast'
      );
    } catch {
      setIsRecasted(prevRecasted);
      setRecastsCount(prevCount);
    } finally {
      setPendingReaction(null);
    }
  };

  const handleCardClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.closest(
        'button, a, input, textarea, video, .farcaster-cast__quote, .farcaster-cast__link-card, .farcaster-cast__media-button'
      )
    ) {
      return;
    }
    onOpenThread(cast.threadHash || cast.hash);
  };

  return (
    <article
      className={`farcaster-cast ${isRoot ? 'farcaster-cast--root' : ''} ${depth > 0 ? 'farcaster-cast--reply' : ''}`}
      onClick={handleCardClick}
    >
      <Button
        type="unstyled"
        className="farcaster-cast__avatar-button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenProfile(cast.author.fid);
        }}
      >
        {cast.author.pfpUrl ? (
          <img className="farcaster-cast__avatar" src={cast.author.pfpUrl} alt="" loading="lazy" />
        ) : (
          <span className="farcaster-cast__avatar farcaster-cast__avatar--fallback">
            {(cast.author.displayName || cast.author.username || '?').slice(0, 1).toUpperCase()}
          </span>
        )}
      </Button>
      <div className="farcaster-cast__body">
        {cast.isPinned && (
          <div className="farcaster-cast__pinned-badge">
            <Icon name="pin" size="xs" />
            <span>{t`Pinned`}</span>
          </div>
        )}
        {!isRoot && cast.parentHash && (
          <div className="farcaster-cast__reply-context">
            <span>{t`Replying to`}</span>
            {cast.parentAuthor?.username ? (
              <button
                type="button"
                className="farcaster-cast__text-link"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenUsername(cast.parentAuthor!.username!);
                }}
              >
                @{cast.parentAuthor.username}
              </button>
            ) : (
              <button
                type="button"
                className="farcaster-cast__text-link"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenThread(cast.parentHash!);
                }}
              >
                {t`thread`}
              </button>
            )}
          </div>
        )}
        <div className="farcaster-cast__byline">
          <Button
            type="unstyled"
            className="farcaster-cast__author"
            onClick={(e) => {
              e.stopPropagation();
              onOpenProfile(cast.author.fid);
            }}
          >
            <strong>{cast.author.displayName || cast.author.username}</strong>
            <span>@{cast.author.username}</span>
          </Button>
          {cast.channel && !cast.parentHash && (
            <span className="farcaster-cast__in-channel">
              {t`in`}{' '}
              <button
                type="button"
                className="farcaster-cast__text-link"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenChannel(cast.channel!.key);
                }}
              >
                /{cast.channel.name || cast.channel.key}
              </button>
            </span>
          )}
          <span aria-hidden="true">·</span>
          <time dateTime={new Date(cast.timestamp).toISOString()}>{formatTimestamp(cast.timestamp)}</time>
        </div>
        <div className="farcaster-cast__text">
          {renderText(cast.text, onOpenUsername, onOpenChannel, onOpenThread)}
        </div>
        {cast.embeds.length > 0 && (
          <div className="farcaster-cast__embeds">
            {cast.embeds.map((embed, index) => (
              <CastEmbed
                key={`${embed.url ?? embed.castId?.hash ?? index}`}
                embed={embed}
                onOpenThread={onOpenThread}
                onOpenProfile={onOpenProfile}
              />
            ))}
          </div>
        )}
        <div className="farcaster-cast__stats">
          <Button
            type="unstyled"
            className="farcaster-cast__stat-btn farcaster-cast__stat-btn--reply"
            onClick={(e) => {
              e.stopPropagation();
              if (onReply) {
                onReply(cast);
              } else {
                onOpenThread(cast.threadHash || cast.hash);
              }
            }}
            ariaLabel="Reply to cast"
          >
            <Icon name="message" size="sm" />
            <span>{cast.reactions.repliesCount}</span>
            <span className="farcaster-cast__stat-label">{t`Reply`}</span>
          </Button>
          <Button
            type="unstyled"
            className={`farcaster-cast__stat-btn farcaster-cast__stat-btn--recast ${isRecasted ? 'farcaster-cast__stat-btn--recasted' : ''}`}
            disabled={!onReact || pendingReaction !== null}
            onClick={handleRecast}
            ariaLabel="Recast"
          >
            <Icon name="repeat" size="sm" />
            <span>{recastsCount}</span>
          </Button>
          <Button
            type="unstyled"
            className={`farcaster-cast__stat-btn farcaster-cast__stat-btn--like ${isLiked ? 'farcaster-cast__stat-btn--liked' : ''}`}
            disabled={!onReact || pendingReaction !== null}
            onClick={handleLike}
            ariaLabel="Like cast"
          >
            <Icon
              name="heart"
              variant={isLiked ? 'filled' : 'outline'}
              size="sm"
            />
            <span>{likesCount}</span>
          </Button>
        </div>
      </div>
    </article>
  );
};
