import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  HypersnapClient,
  LegacyFarcasterClient,
  fromHypersnapCast,
  fromHypersnapUser,
  fromLegacyFeedItem,
  type HypersnapConversationCast,
  type NormalizedCast,
} from '@quilibrium/quorum-shared';
import { nativeFetch } from '@/utils/nativeFetch';

const client = new HypersnapClient({ timeoutMs: 60_000, fetchImpl: nativeFetch as typeof fetch });
const legacyClient = new LegacyFarcasterClient({ timeoutMs: 60_000, fetchImpl: nativeFetch as typeof fetch });
const PAGE_SIZE = 25;
const SCAM_DOMAIN_RE = /(?:^|[^a-z0-9])hyrpia\.xyz(?:[/?#]|$|[^a-z0-9.])/i;

export function isSafeFarcasterCast(cast: NormalizedCast): boolean {
  const values = [
    cast.text,
    ...cast.embeds.flatMap((embed) => [
      embed.url,
      embed.openGraph?.sourceUrl,
      embed.openGraph?.domain,
      embed.openGraph?.title,
      embed.openGraph?.description,
    ]),
  ];
  return !values.some((value) => typeof value === 'string' && SCAM_DOMAIN_RE.test(value));
}

function safeCasts(casts: NormalizedCast[]): NormalizedCast[] {
  return casts.filter(isSafeFarcasterCast);
}

export function useTrendingFeed(enabled = true) {
  return useInfiniteQuery({
    queryKey: ['farcaster', 'desktop', 'trending'],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const response = await client.getTrendingFeed({
        cursor: pageParam,
        limit: PAGE_SIZE,
        timeoutMs: 75_000,
      });
      return {
        casts: safeCasts(response.casts.map(fromHypersnapCast)),
        cursor: response.next.cursor,
      };
    },
    getNextPageParam: (page) => page.cursor ?? undefined,
    staleTime: 2 * 60_000,
  });
}

export interface ChannelInfo {
  key: string;
  name: string;
  description?: string;
  imageUrl?: string;
  headerImageUrl?: string;
  followerCount?: number;
}

export function useDesktopChannelInfo(channel: string | null) {
  return useQuery({
    queryKey: ['farcaster', 'desktop', 'channel-info', channel],
    enabled: Boolean(channel),
    queryFn: async (): Promise<ChannelInfo | null> => {
      if (!channel) return null;
      try {
        const res = await nativeFetch(
          `https://farcaster.xyz/~api/v2/channel?key=${encodeURIComponent(channel)}`,
          {
            headers: {
              accept: 'application/json',
              origin: 'https://farcaster.xyz',
              referer: 'https://farcaster.xyz/',
            },
          }
        );
        if (!res.ok) return null;
        const data = (await res.json()) as {
          result?: {
            channel?: {
              key: string;
              name: string;
              description?: string;
              imageUrl?: string;
              headerImageUrl?: string;
              followerCount?: number;
            };
          };
        };
        const ch = data.result?.channel;
        if (!ch) return null;
        return {
          key: ch.key,
          name: ch.name,
          description: ch.description,
          imageUrl: ch.imageUrl,
          headerImageUrl: ch.headerImageUrl,
          followerCount: ch.followerCount,
        };
      } catch {
        return null;
      }
    },
    staleTime: 10 * 60_000,
  });
}

interface ChannelFeedCursor {
  olderThan?: number;
  latestMainCastTimestamp?: number;
  excludeItemIdPrefixes?: string[];
  hypersnapCursor?: string | null;
}

export function useDesktopChannelFeed(channel: string | null, token?: string) {
  return useInfiniteQuery({
    queryKey: ['farcaster', 'desktop', 'channel', channel, token],
    enabled: Boolean(channel),
    initialPageParam: undefined as ChannelFeedCursor | undefined,
    queryFn: async ({ pageParam }) => {
      if (!channel) return { casts: [], nextCursor: undefined };
      if (token) {
        try {
          const res = await legacyClient.getFeedItems(
            {
              feedKey: channel,
              feedType: 'default',
              olderThan: pageParam?.olderThan,
              latestMainCastTimestamp: pageParam?.latestMainCastTimestamp,
              excludeItemIdPrefixes: pageParam?.excludeItemIdPrefixes,
            },
            token
          );
          const casts = safeCasts(res.items.map(fromLegacyFeedItem));
          const lastItem = res.items[res.items.length - 1];
          const nextTimestamp =
            res.latestMainCastTimestamp ?? (lastItem ? lastItem.timestamp : null);
          const nextCursor: ChannelFeedCursor | undefined =
            nextTimestamp && res.items.length > 0
              ? {
                  olderThan: nextTimestamp,
                  latestMainCastTimestamp: res.latestMainCastTimestamp,
                  excludeItemIdPrefixes: res.items.map((it) => it.id.slice(2, 10)),
                }
              : undefined;
          return { casts, nextCursor };
        } catch {
          // Fall through to hypersnap
        }
      }

      const response = await client.getChannelFeed([channel], {
        cursor: pageParam?.hypersnapCursor ?? undefined,
        limit: PAGE_SIZE,
      });
      const casts = safeCasts(response.casts.map(fromHypersnapCast));
      const nextCursor: ChannelFeedCursor | undefined =
        response.next.cursor && casts.length > 0
          ? { hypersnapCursor: response.next.cursor }
          : undefined;
      return { casts, nextCursor };
    },
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 2 * 60_000,
  });
}

export function useFarcasterProfile(fid: number | null) {
  const user = useQuery({
    queryKey: ['farcaster', 'desktop', 'profile', fid],
    enabled: fid !== null,
    queryFn: async () => fromHypersnapUser(await client.getUserByFid(fid as number)),
    staleTime: 5 * 60_000,
  });

  const casts = useInfiniteQuery({
    queryKey: ['farcaster', 'desktop', 'profile-casts', fid],
    enabled: fid !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const response = await client.getUserCasts(fid as number, {
        cursor: pageParam,
        limit: PAGE_SIZE,
      });
      return {
        casts: safeCasts(response.casts.map(fromHypersnapCast)),
        cursor: response.next.cursor,
      };
    },
    getNextPageParam: (page) => page.cursor ?? undefined,
    staleTime: 2 * 60_000,
  });

  const replies = useInfiniteQuery({
    queryKey: ['farcaster', 'desktop', 'profile-replies', fid],
    enabled: fid !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const response = await client.getUserReplies(fid as number, {
        cursor: pageParam,
        limit: PAGE_SIZE,
      });
      return {
        casts: safeCasts(response.casts.map(fromHypersnapCast)),
        cursor: response.next.cursor,
      };
    },
    getNextPageParam: (page) => page.cursor ?? undefined,
    staleTime: 2 * 60_000,
  });

  return { user, casts, replies };
}

export interface ThreadNode {
  cast: NormalizedCast;
  depth: number;
  replies: ThreadNode[];
}

export function buildThreadTree(node: HypersnapConversationCast, depth = 0): ThreadNode | null {
  const norm = fromHypersnapCast(node);
  if (!isSafeFarcasterCast(norm)) return null;
  const replies: ThreadNode[] = [];
  for (const reply of node.direct_replies ?? []) {
    const child = buildThreadTree(reply, depth + 1);
    if (child) replies.push(child);
  }
  return {
    cast: norm,
    depth,
    replies,
  };
}

export function useFarcasterThread(hash: string | null) {
  return useQuery({
    queryKey: ['farcaster', 'desktop', 'thread-tree', hash],
    enabled: Boolean(hash),
    queryFn: async (): Promise<ThreadNode | null> => {
      if (!hash) return null;
      const response = await client.getCastConversation(hash, { replyDepth: 5 });
      return buildThreadTree(response.conversation.cast, 0);
    },
    staleTime: 60_000,
  });
}

export function useViewerReactions(fid?: number) {
  return useQuery({
    queryKey: ['farcaster', 'desktop', 'viewer-reactions', fid],
    enabled: Boolean(fid && fid > 0),
    queryFn: async () => {
      if (!fid) return { likedHashes: new Set<string>(), recastedHashes: new Set<string>() };
      const likedHashes = new Set<string>();
      const recastedHashes = new Set<string>();

      try {
        const [likesRes, recastsRes] = await Promise.all([
          nativeFetch(`https://haatz.quilibrium.com/v1/reactionsByFid?fid=${fid}&reaction_type=Like&reverse=true&pageSize=1000`),
          nativeFetch(`https://haatz.quilibrium.com/v1/reactionsByFid?fid=${fid}&reaction_type=Recast&reverse=true&pageSize=1000`),
        ]);

        if (likesRes.ok) {
          const data = (await likesRes.json()) as {
            messages?: Array<{
              data?: {
                reactionBody?: {
                  targetCastId?: { hash?: string };
                };
              };
            }>;
          };
          for (const msg of data.messages ?? []) {
            const h = msg.data?.reactionBody?.targetCastId?.hash;
            if (h) likedHashes.add(h.toLowerCase());
          }
        }

        if (recastsRes.ok) {
          const data = (await recastsRes.json()) as {
            messages?: Array<{
              data?: {
                reactionBody?: {
                  targetCastId?: { hash?: string };
                };
              };
            }>;
          };
          for (const msg of data.messages ?? []) {
            const h = msg.data?.reactionBody?.targetCastId?.hash;
            if (h) recastedHashes.add(h.toLowerCase());
          }
        }
      } catch (err) {
        console.warn('Failed to load viewer reactions:', err);
      }

      return { likedHashes, recastedHashes };
    },
    staleTime: 60_000,
  });
}

export function useViewerReactionOverlay(casts: NormalizedCast[], fid?: number): NormalizedCast[] {
  const viewerReactions = useViewerReactions(fid);
  const reactionsData = viewerReactions.data;

  if (!fid || !reactionsData) return casts;
  const { likedHashes, recastedHashes } = reactionsData;

  return casts.map((cast) => {
    const hashLower = cast.hash.toLowerCase();
    const viewerLiked = Boolean(cast.reactions.viewerLiked || likedHashes.has(hashLower));
    const viewerRecasted = Boolean(cast.reactions.viewerRecasted || recastedHashes.has(hashLower));

    if (viewerLiked === cast.reactions.viewerLiked && viewerRecasted === cast.reactions.viewerRecasted) {
      return cast;
    }

    return {
      ...cast,
      reactions: {
        ...cast.reactions,
        viewerLiked,
        viewerRecasted,
      },
    };
  });
}

export function applyOverlayToThreadTree(
  node: ThreadNode | null,
  reactionsData?: { likedHashes: Set<string>; recastedHashes: Set<string> }
): ThreadNode | null {
  if (!node) return null;
  const hashLower = node.cast.hash.toLowerCase();
  const viewerLiked = Boolean(node.cast.reactions.viewerLiked || reactionsData?.likedHashes.has(hashLower));
  const viewerRecasted = Boolean(node.cast.reactions.viewerRecasted || reactionsData?.recastedHashes.has(hashLower));

  const cast = {
    ...node.cast,
    reactions: {
      ...node.cast.reactions,
      viewerLiked,
      viewerRecasted,
    },
  };

  const replies: ThreadNode[] = [];
  for (const child of node.replies) {
    const overlaidChild = applyOverlayToThreadTree(child, reactionsData);
    if (overlaidChild) replies.push(overlaidChild);
  }

  return {
    ...node,
    cast,
    replies,
  };
}

export async function resolveFarcasterUsername(username: string): Promise<number | null> {
  try {
    const user = await client.getUserByUsername(username.replace(/^@/, '').trim());
    return user.fid;
  } catch {
    return null;
  }
}

export async function resolveChannelParentUrl(channel: string): Promise<string | undefined> {
  try {
    const res = await nativeFetch(
      `https://farcaster.xyz/~api/v2/channel?key=${encodeURIComponent(channel)}`
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      result?: {
        channel?: {
          parentUrl?: string;
          url?: string;
        };
      };
    };
    return data.result?.channel?.parentUrl || data.result?.channel?.url;
  } catch {
    return undefined;
  }
}

export function useDesktopUserAppContext(token?: string) {
  return useQuery({
    queryKey: ['farcaster', 'desktop', 'user-app-context', token],
    enabled: Boolean(token),
    queryFn: async () => {
      if (!token) return null;
      try {
        const res = await nativeFetch('https://client.farcaster.xyz/v2/user-app-context', {
          headers: {
            authorization: `Bearer ${token}`,
          },
        });
        if (!res.ok) return null;
        const data = (await res.json()) as {
          result?: {
            userAppContext?: {
              longCastByteLimit?: number;
              regularCastByteLimit?: number;
            };
          };
        };
        return data.result?.userAppContext ?? null;
      } catch {
        return null;
      }
    },
    staleTime: 1000 * 60 * 60 * 24,
  });
}

export interface RawFarcasterNotification {
  object: 'notification';
  type: 'likes' | 'recasts' | 'reply' | 'mention' | 'follows' | string;
  user: any;
  cast?: any | null;
}

export interface FarcasterNotificationItem {
  id: string;
  type: 'likes' | 'recasts' | 'reply' | 'mention' | 'follows' | string;
  user: ReturnType<typeof fromHypersnapUser>;
  cast?: NormalizedCast | null;
  timestamp: number;
}

export interface FarcasterNotificationsResponse {
  notifications: FarcasterNotificationItem[];
  nextCursor?: string | null;
}

export function useFarcasterNotifications(fid?: number, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['farcaster', 'desktop', 'notifications', fid],
    enabled: Boolean(enabled && fid && fid > 0),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<FarcasterNotificationsResponse> => {
      if (!fid) return { notifications: [], nextCursor: null };
      const params = new URLSearchParams({
        fid: String(fid),
        limit: String(PAGE_SIZE),
      });
      if (pageParam) params.set('cursor', pageParam);

      const res = await nativeFetch(
        `https://haatz.quilibrium.com/v2/farcaster/notifications?${params.toString()}`
      );
      if (!res.ok) {
        throw new Error(`Failed to fetch notifications: HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        notifications?: RawFarcasterNotification[];
        next?: { cursor?: string | null };
      };

      const notifications: FarcasterNotificationItem[] = (data.notifications ?? []).map((n, idx) => {
        const user = fromHypersnapUser(n.user);
        const cast = n.cast ? fromHypersnapCast(n.cast) : null;
        const ts = cast
          ? cast.timestamp
          : n.user.registered_at
            ? new Date(n.user.registered_at).getTime()
            : Date.now();
        const id = `${n.type}-${user.fid}-${cast?.hash || idx}-${ts}`;

        return {
          id,
          type: n.type,
          user,
          cast: cast ? (isSafeFarcasterCast(cast) ? cast : null) : null,
          timestamp: ts,
        };
      });

      return {
        notifications,
        nextCursor: data.next?.cursor ?? null,
      };
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}
