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

export async function resolveFarcasterUsername(username: string): Promise<number | null> {
  try {
    const user = await client.getUserByUsername(username.replace(/^@/, '').trim());
    return user.fid;
  } catch {
    return null;
  }
}

const channelUrls = new Map<string, string>();

export async function resolveChannelParentUrl(channel: string): Promise<string> {
  const cached = channelUrls.get(channel);
  if (cached) return cached;
  try {
    const response = await fetch(`https://api.farcaster.xyz/v1/channel?channelId=${encodeURIComponent(channel)}`);
    if (response.ok) {
      const data = await response.json() as { result?: { channel?: { url?: string } } };
      const url = data.result?.channel?.url;
      if (url) {
        channelUrls.set(channel, url);
        return url;
      }
    }
  } catch { /* use the canonical legacy-channel fallback */ }
  return `https://warpcast.com/~/channel/${channel}`;
}

export function useDesktopUserAppContext(token?: string) {
  return useQuery({
    queryKey: ['farcaster', 'desktop', 'user-app-context', token],
    queryFn: async () => {
      if (!token) return null;
      try {
        const res = await fetch('https://client.farcaster.xyz/v2/user-app-context', {
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${token}`,
            origin: 'https://farcaster.xyz',
            referer: 'https://farcaster.xyz/',
          },
        });
        if (!res.ok) return null;
        const data = (await res.json()) as {
          result?: {
            context?: {
              regularCastByteLimit?: number;
              longCastByteLimit?: number;
              castEmbedLimit?: number;
              isAdmin?: boolean;
              canUploadVideo?: boolean;
            };
          };
        };
        return data.result?.context ?? null;
      } catch {
        return null;
      }
    },
    enabled: Boolean(token),
    staleTime: 1000 * 60 * 60 * 24,
  });
}
