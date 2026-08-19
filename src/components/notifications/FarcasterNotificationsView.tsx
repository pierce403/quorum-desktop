import React, { useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '@lingui/core/macro';
import { Flex, Icon, Button } from '../primitives';
import {
  useFarcasterNotifications,
  type FarcasterNotificationItem,
} from '../farcaster/useFarcasterDesktop';
import type { DesktopFarcasterAccount } from '@/services/FarcasterAccountService';
import './FarcasterNotificationsView.scss';

function formatNotificationTimestamp(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return t`just now`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp);
}

type NotificationFilter = 'all' | 'mentions' | 'reactions' | 'follows';

export const FarcasterNotificationCard: React.FC<{
  item: FarcasterNotificationItem;
  onOpenProfile: (fid: number) => void;
  onOpenThread: (hash: string) => void;
}> = ({ item, onOpenProfile, onOpenThread }) => {
  const isLike = item.type === 'likes' || item.type === 'like';
  const isRecast = item.type === 'recasts' || item.type === 'recast';
  const isReply = item.type === 'reply' || item.type === 'replies';
  const isMention = item.type === 'mention' || item.type === 'mentions';
  const isFollow = item.type === 'follows' || item.type === 'follow';

  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, a, .farcaster-notification__avatar-button')) return;

    if (item.cast) {
      onOpenThread(item.cast.threadHash || item.cast.parentHash || item.cast.hash);
    } else if (isFollow) {
      onOpenProfile(item.user.fid);
    }
  };

  let iconName: any = 'bell';
  let iconClass = 'farcaster-notification__icon--default';
  let actionText = t`interacted with you`;

  if (isLike) {
    iconName = 'heart';
    iconClass = 'farcaster-notification__icon--likes';
    actionText = t`liked your cast`;
  } else if (isRecast) {
    iconName = 'refresh';
    iconClass = 'farcaster-notification__icon--recasts';
    actionText = t`recasted your cast`;
  } else if (isReply) {
    iconName = 'message';
    iconClass = 'farcaster-notification__icon--reply';
    actionText = t`replied to your cast`;
  } else if (isMention) {
    iconName = 'at-sign';
    iconClass = 'farcaster-notification__icon--mention';
    actionText = t`mentioned you`;
  } else if (isFollow) {
    iconName = 'user-plus';
    iconClass = 'farcaster-notification__icon--follows';
    actionText = t`followed you`;
  }

  return (
    <article
      className="farcaster-notification"
      onClick={handleClick}
      role={item.cast || isFollow ? 'button' : undefined}
      tabIndex={item.cast || isFollow ? 0 : undefined}
    >
      <div className="farcaster-notification__header">
        <div className={`farcaster-notification__icon ${iconClass}`}>
          <Icon name={iconName} size="sm" />
        </div>

        <button
          type="button"
          className="farcaster-notification__avatar-button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenProfile(item.user.fid);
          }}
        >
          {item.user.pfpUrl ? (
            <img className="farcaster-notification__avatar" src={item.user.pfpUrl} alt="" loading="lazy" />
          ) : (
            <span className="farcaster-notification__avatar farcaster-notification__avatar--fallback">
              {(item.user.displayName || item.user.username || '?').slice(0, 1).toUpperCase()}
            </span>
          )}
        </button>

        <div className="farcaster-notification__byline">
          <button
            type="button"
            className="farcaster-notification__name-btn"
            onClick={(e) => {
              e.stopPropagation();
              onOpenProfile(item.user.fid);
            }}
          >
            <strong>{item.user.displayName || item.user.username}</strong>
            <span className="farcaster-notification__handle">@{item.user.username}</span>
          </button>
          <span className="farcaster-notification__action">{actionText}</span>
        </div>

        <span className="farcaster-notification__time">
          {formatNotificationTimestamp(item.timestamp)}
        </span>
      </div>

      {item.cast && (
        <div className="farcaster-notification__body">
          <div className="farcaster-notification__cast-preview">
            <p className="farcaster-notification__cast-text">{item.cast.text}</p>
          </div>
        </div>
      )}

      {isFollow && item.user.bio && (
        <div className="farcaster-notification__body">
          <div className="farcaster-notification__bio">{item.user.bio}</div>
        </div>
      )}
    </article>
  );
};

export const FarcasterNotificationsView: React.FC<{
  account: DesktopFarcasterAccount | null;
  onClosePanel: () => void;
}> = ({ account, onClosePanel }) => {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const notificationsQuery = useFarcasterNotifications(account?.fid, Boolean(account?.fid));
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const onOpenProfile = (fid: number) => {
    onClosePanel();
    navigate(`/farcaster?profile=${fid}`);
  };

  const onOpenThread = (hash: string) => {
    onClosePanel();
    navigate(`/farcaster?thread=${encodeURIComponent(hash)}`);
  };

  const rawNotifications =
    notificationsQuery.data?.pages.flatMap((page) => page.notifications) ?? [];

  const filteredNotifications = useMemo(() => {
    if (filter === 'mentions') {
      return rawNotifications.filter((n) => n.type === 'mention' || n.type === 'reply' || n.type === 'replies');
    }
    if (filter === 'reactions') {
      return rawNotifications.filter((n) => n.type === 'likes' || n.type === 'like' || n.type === 'recasts' || n.type === 'recast');
    }
    if (filter === 'follows') {
      return rawNotifications.filter((n) => n.type === 'follows' || n.type === 'follow');
    }
    return rawNotifications;
  }, [rawNotifications, filter]);

  if (!account) {
    return (
      <div className="farcaster-notifications-view__connect-prompt">
        <Icon name="farcaster" size="3xl" />
        <h3>{t`Connect Farcaster`}</h3>
        <p>{t`Import your Farcaster account in the Farcaster section to receive your alerts and interaction notifications here.`}</p>
        <Button
          type="primary"
          onClick={() => {
            onClosePanel();
            navigate('/farcaster');
          }}
        >
          {t`Go to Farcaster`}
        </Button>
      </div>
    );
  }

  return (
    <div className="farcaster-notifications-view">
      <div className="farcaster-notifications-view__toolbar">
        <div className="farcaster-notifications-view__filter-pills">
          <button
            type="button"
            className={`farcaster-notifications-view__pill ${filter === 'all' ? 'farcaster-notifications-view__pill--active' : ''}`}
            onClick={() => setFilter('all')}
          >
            {t`All`}
          </button>
          <button
            type="button"
            className={`farcaster-notifications-view__pill ${filter === 'mentions' ? 'farcaster-notifications-view__pill--active' : ''}`}
            onClick={() => setFilter('mentions')}
          >
            {t`Mentions & Replies`}
          </button>
          <button
            type="button"
            className={`farcaster-notifications-view__pill ${filter === 'reactions' ? 'farcaster-notifications-view__pill--active' : ''}`}
            onClick={() => setFilter('reactions')}
          >
            {t`Likes & Recasts`}
          </button>
          <button
            type="button"
            className={`farcaster-notifications-view__pill ${filter === 'follows' ? 'farcaster-notifications-view__pill--active' : ''}`}
            onClick={() => setFilter('follows')}
          >
            {t`Follows`}
          </button>
        </div>

        <Button
          type="unstyled"
          iconName="refresh"
          iconOnly
          ariaLabel={t`Refresh notifications`}
          onClick={() => void notificationsQuery.refetch()}
        />
      </div>

      <div className="farcaster-notifications-list">
        {notificationsQuery.isLoading && rawNotifications.length === 0 && (
          <Flex direction="column" justify="center" align="center" className="notification-loading-state">
            <Icon name="spinner" className="loading-icon icon-spin" />
            <span className="loading-message">{t`Loading notifications...`}</span>
          </Flex>
        )}
        {notificationsQuery.error && rawNotifications.length === 0 && (
          <Flex direction="column" justify="center" align="center" className="notification-empty-state">
            <Icon name="warning" size="3xl" className="empty-icon" />
            <span className="empty-message">{t`Farcaster could not be reached.`}</span>
            <Button type="secondary" size="small" onClick={() => void notificationsQuery.refetch()}>{t`Retry`}</Button>
          </Flex>
        )}
        {!notificationsQuery.isLoading && filteredNotifications.length === 0 && (
          <Flex direction="column" justify="center" align="center" className="notification-empty-state">
            <Icon name="bell" size="3xl" className="empty-icon" />
            <span className="empty-message">{t`No notifications yet`}</span>
            <span className="empty-hint">{t`You're all caught up on Farcaster!`}</span>
          </Flex>
        )}
        {filteredNotifications.map((item) => (
          <FarcasterNotificationCard
            key={item.id}
            item={item}
            onOpenProfile={onOpenProfile}
            onOpenThread={onOpenThread}
          />
        ))}
        {filteredNotifications.length > 0 && (
          <div ref={sentinelRef} className="farcaster-feed__sentinel" aria-hidden="true" />
        )}
        {filteredNotifications.length > 0 && notificationsQuery.hasNextPage && (
          <Button
            type="secondary"
            disabled={notificationsQuery.isFetchingNextPage}
            onClick={() => void notificationsQuery.fetchNextPage()}
          >
            {notificationsQuery.isFetchingNextPage ? t`Loading...` : t`Load more`}
          </Button>
        )}
      </div>
    </div>
  );
};
