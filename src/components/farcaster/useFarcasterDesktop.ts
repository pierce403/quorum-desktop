import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  HypersnapClient,
  fromHypersnapCast,
  fromHypersnapUser,
  type HypersnapConversationCast,
  type NormalizedCast,
} from '@quilibrium/quorum-shared';

const client = new HypersnapClient({ timeoutMs: 60_000 });
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

export function useDesktopChannelFeed(channel: string | null) {
  return useInfiniteQuery({
    queryKey: ['farcaster', 'desktop', 'channel', channel],
    enabled: channel !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const response = await client.getChannelFeed([channel as string], {
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

  return { user, casts };
}

function flattenConversation(root: HypersnapConversationCast): NormalizedCast[] {
  const result: NormalizedCast[] = [];
  const visit = (cast: HypersnapConversationCast) => {
    result.push(fromHypersnapCast(cast));
    for (const reply of cast.direct_replies ?? []) visit(reply);
  };
  visit(root);
  return result;
}

export function useFarcasterThread(hash: string | null) {
  return useQuery({
    queryKey: ['farcaster', 'desktop', 'thread', hash],
    enabled: hash !== null,
    queryFn: async () => {
      const response = await client.getCastConversation(hash as string, { replyDepth: 5 });
      return safeCasts(flattenConversation(response.conversation.cast));
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
