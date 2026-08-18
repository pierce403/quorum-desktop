import * as React from 'react';
import { Button, Icon } from '../primitives';
import type { NormalizedCast, NormalizedEmbed } from '@quilibrium/quorum-shared';

interface FarcasterCastCardProps {
  cast: NormalizedCast;
  onOpenProfile: (fid: number) => void;
  onOpenThread: (hash: string) => void;
  onOpenChannel: (channel: string) => void;
  onOpenUsername: (username: string) => void;
  onReact?: (cast: NormalizedCast, reaction: 'like' | 'recast') => Promise<void>;
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
  return /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i.test(url) || /imagedelivery\.net|i\.imgur\.com/i.test(url);
}

const CastEmbed: React.FC<{ embed: NormalizedEmbed }> = ({ embed }) => {
  const imageUrl = embed.image?.url ?? (embed.url && isImageUrl(embed.url) ? embed.url : undefined);
  const videoUrl = embed.video?.url;
  const linkUrl = embed.openGraph?.sourceUrl ?? embed.url;

  if (imageUrl) {
    return (
      <button className="farcaster-cast__media-button" type="button" onClick={() => openExternal(imageUrl)}>
        <img className="farcaster-cast__image" src={imageUrl} alt={embed.image?.alt ?? ''} loading="lazy" />
      </button>
    );
  }
  if (videoUrl) {
    return <video className="farcaster-cast__video" controls preload="metadata" poster={embed.video?.thumbnailUrl} src={videoUrl} />;
  }
  if (embed.castId) {
    return (
      <div className="farcaster-cast__quote">
        <Icon name="messages" size="sm" /> Quoted cast
      </div>
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
) {
  const parts = text.split(/(https?:\/\/[^\s]+|@[a-zA-Z0-9._-]+|\/[a-zA-Z0-9_-]+)/g);
  return parts.map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      return <a key={index} href={part} target="_blank" rel="noreferrer">{part}</a>;
    }
    if (/^@[a-zA-Z0-9._-]+$/.test(part)) {
      return <button key={index} type="button" className="farcaster-cast__text-link" onClick={() => onUsername(part.slice(1))}>{part}</button>;
    }
    if (/^\/[a-zA-Z0-9_-]+$/.test(part)) {
      return <button key={index} type="button" className="farcaster-cast__text-link" onClick={() => onChannel(part.slice(1))}>{part}</button>;
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
  onReact,
}) => {
  const [pendingReaction, setPendingReaction] = React.useState<'like' | 'recast' | null>(null);
  const react = async (reaction: 'like' | 'recast') => {
    if (!onReact || pendingReaction) return;
    setPendingReaction(reaction);
    try {
      await onReact(cast, reaction);
    } finally {
      setPendingReaction(null);
    }
  };
  return <article className="farcaster-cast">
    <Button type="unstyled" className="farcaster-cast__avatar-button" onClick={() => onOpenProfile(cast.author.fid)}>
      {cast.author.pfpUrl ? (
        <img className="farcaster-cast__avatar" src={cast.author.pfpUrl} alt="" loading="lazy" />
      ) : (
        <span className="farcaster-cast__avatar farcaster-cast__avatar--fallback">{(cast.author.displayName || cast.author.username || '?').slice(0, 1).toUpperCase()}</span>
      )}
    </Button>
    <div className="farcaster-cast__body">
      <div className="farcaster-cast__byline">
        <Button type="unstyled" className="farcaster-cast__author" onClick={() => onOpenProfile(cast.author.fid)}>
          <strong>{cast.author.displayName || cast.author.username}</strong>
          <span>@{cast.author.username}</span>
        </Button>
        <span aria-hidden="true">·</span>
        <time dateTime={new Date(cast.timestamp).toISOString()}>{formatTimestamp(cast.timestamp)}</time>
      </div>
      {cast.channel && (
        <Button type="unstyled" className="farcaster-cast__channel" onClick={() => onOpenChannel(cast.channel!.key)}>
          /{cast.channel.name || cast.channel.key}
        </Button>
      )}
      <div className="farcaster-cast__text">{renderText(cast.text, onOpenUsername, onOpenChannel)}</div>
      {cast.embeds.length > 0 && (
        <div className="farcaster-cast__embeds">
          {cast.embeds.map((embed, index) => <CastEmbed key={`${embed.url ?? embed.castId?.hash ?? index}`} embed={embed} />)}
        </div>
      )}
      <div className="farcaster-cast__stats">
        <Button type="unstyled" onClick={() => onOpenThread(cast.hash)} ariaLabel="Open cast thread"><Icon name="message" size="sm" /> {cast.reactions.repliesCount}</Button>
        <Button type="unstyled" disabled={!onReact || pendingReaction !== null} onClick={() => react('recast')} ariaLabel="Recast"><Icon name="repeat" size="sm" /> {cast.reactions.recastsCount}</Button>
        <Button type="unstyled" disabled={!onReact || pendingReaction !== null} onClick={() => react('like')} ariaLabel="Like cast"><Icon name="heart" variant={cast.reactions.viewerLiked ? 'filled' : 'outline'} size="sm" /> {cast.reactions.likesCount}</Button>
      </div>
    </div>
  </article>;
};
