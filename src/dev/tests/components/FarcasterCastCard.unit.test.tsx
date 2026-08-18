import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider } from '@lingui/react';
import { i18n } from '@lingui/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { messages } from '@/i18n/en/messages';
import { FarcasterCastCard } from '@/components/farcaster/FarcasterCastCard';
import type { NormalizedCast } from '@quilibrium/quorum-shared';

beforeAll(() => {
  i18n.load('en', messages);
  i18n.activate('en');
});

const renderCard = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <I18nProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </I18nProvider>
  );
};

const mockCast: NormalizedCast = {
  hash: '0x1234567890abcdef',
  author: {
    fid: 123,
    username: 'alice',
    displayName: 'Alice In Chains',
    pfpUrl: 'https://example.com/alice.png',
  },
  text: 'Hello world @bob check /farcaster and https://example.com',
  timestamp: Date.now() - 3600_000,
  embeds: [
    {
      url: 'https://example.com/image.png',
      image: { url: 'https://example.com/image.png' },
    },
  ],
  reactions: {
    likesCount: 10,
    recastsCount: 5,
    repliesCount: 3,
    viewerLiked: false,
    viewerRecasted: false,
  },
  channel: {
    key: 'farcaster',
    name: 'Farcaster',
  },
  source: 'hypersnap',
};

describe('FarcasterCastCard', () => {
  it('renders author details, cast text, channel, and metrics', () => {
    const onOpenProfile = vi.fn();
    const onOpenThread = vi.fn();
    const onOpenChannel = vi.fn();
    const onOpenUsername = vi.fn();

    renderCard(
      <FarcasterCastCard
        cast={mockCast}
        onOpenProfile={onOpenProfile}
        onOpenThread={onOpenThread}
        onOpenChannel={onOpenChannel}
        onOpenUsername={onOpenUsername}
      />
    );

    expect(screen.getByText('Alice In Chains')).toBeInTheDocument();
    expect(screen.getByText('@alice')).toBeInTheDocument();
    expect(screen.getByText('/Farcaster')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('triggers onOpenProfile when clicking author name', () => {
    const onOpenProfile = vi.fn();
    const onOpenThread = vi.fn();
    const onOpenChannel = vi.fn();
    const onOpenUsername = vi.fn();

    renderCard(
      <FarcasterCastCard
        cast={mockCast}
        onOpenProfile={onOpenProfile}
        onOpenThread={onOpenThread}
        onOpenChannel={onOpenChannel}
        onOpenUsername={onOpenUsername}
      />
    );

    fireEvent.click(screen.getByText('Alice In Chains'));
    expect(onOpenProfile).toHaveBeenCalledWith(123);
  });

  it('triggers onOpenUsername and onOpenChannel when clicking parsed tokens', () => {
    const onOpenProfile = vi.fn();
    const onOpenThread = vi.fn();
    const onOpenChannel = vi.fn();
    const onOpenUsername = vi.fn();

    renderCard(
      <FarcasterCastCard
        cast={mockCast}
        onOpenProfile={onOpenProfile}
        onOpenThread={onOpenThread}
        onOpenChannel={onOpenChannel}
        onOpenUsername={onOpenUsername}
      />
    );

    fireEvent.click(screen.getByText('@bob'));
    expect(onOpenUsername).toHaveBeenCalledWith('bob');

    fireEvent.click(screen.getByText('/farcaster'));
    expect(onOpenChannel).toHaveBeenCalledWith('farcaster');
  });

  it('triggers onOpenThread when clicking the cast card body', () => {
    const onOpenProfile = vi.fn();
    const onOpenThread = vi.fn();
    const onOpenChannel = vi.fn();
    const onOpenUsername = vi.fn();

    renderCard(
      <FarcasterCastCard
        cast={mockCast}
        onOpenProfile={onOpenProfile}
        onOpenThread={onOpenThread}
        onOpenChannel={onOpenChannel}
        onOpenUsername={onOpenUsername}
      />
    );

    fireEvent.click(screen.getByText(/Hello world/));
    expect(onOpenThread).toHaveBeenCalledWith('0x1234567890abcdef');
  });

  it('triggers onReply when clicking the reply button', () => {
    const onOpenProfile = vi.fn();
    const onOpenThread = vi.fn();
    const onOpenChannel = vi.fn();
    const onOpenUsername = vi.fn();
    const onReply = vi.fn();

    renderCard(
      <FarcasterCastCard
        cast={mockCast}
        onOpenProfile={onOpenProfile}
        onOpenThread={onOpenThread}
        onOpenChannel={onOpenChannel}
        onOpenUsername={onOpenUsername}
        onReply={onReply}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reply to cast' }));
    expect(onReply).toHaveBeenCalledWith(mockCast);
  });

  it('triggers onOpenThread when clicking an in-app farcaster cast link', () => {
    const onOpenProfile = vi.fn();
    const onOpenThread = vi.fn();
    const onOpenChannel = vi.fn();
    const onOpenUsername = vi.fn();

    const castWithLink: NormalizedCast = {
      ...mockCast,
      text: 'Check this out https://farcaster.xyz/sayangel/0x71edd392',
    };

    renderCard(
      <FarcasterCastCard
        cast={castWithLink}
        onOpenProfile={onOpenProfile}
        onOpenThread={onOpenThread}
        onOpenChannel={onOpenChannel}
        onOpenUsername={onOpenUsername}
      />
    );

    fireEvent.click(
      screen.getByText('https://farcaster.xyz/sayangel/0x71edd392')
    );
    expect(onOpenThread).toHaveBeenCalledWith('0x71edd392');
  });

  it('triggers onOpenThread when clicking a quoted cast card', () => {
    const onOpenProfile = vi.fn();
    const onOpenThread = vi.fn();
    const onOpenChannel = vi.fn();
    const onOpenUsername = vi.fn();

    const castWithQuote: NormalizedCast = {
      ...mockCast,
      embeds: [{ castId: { fid: 456, hash: '0x9999999999' } }],
    };

    renderCard(
      <FarcasterCastCard
        cast={castWithQuote}
        onOpenProfile={onOpenProfile}
        onOpenThread={onOpenThread}
        onOpenChannel={onOpenChannel}
        onOpenUsername={onOpenUsername}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Quoted cast/i }));
    expect(onOpenThread).toHaveBeenCalledWith('0x9999999999');
  });

  it('renders pinned badge when cast is pinned', () => {
    const onOpenProfile = vi.fn();
    const onOpenThread = vi.fn();
    const onOpenChannel = vi.fn();
    const onOpenUsername = vi.fn();

    const pinnedCast: NormalizedCast = {
      ...mockCast,
      isPinned: true,
    };

    renderCard(
      <FarcasterCastCard
        cast={pinnedCast}
        onOpenProfile={onOpenProfile}
        onOpenThread={onOpenThread}
        onOpenChannel={onOpenChannel}
        onOpenUsername={onOpenUsername}
      />
    );

    expect(screen.getByText('Pinned')).toBeInTheDocument();
  });

  it('renders reply context when cast is a reply to another user', () => {
    const onOpenProfile = vi.fn();
    const onOpenThread = vi.fn();
    const onOpenChannel = vi.fn();
    const onOpenUsername = vi.fn();

    const replyCast: NormalizedCast = {
      ...mockCast,
      parentHash: '0xparent123',
      parentAuthor: { fid: 789, username: 'charlie' },
    };

    renderCard(
      <FarcasterCastCard
        cast={replyCast}
        onOpenProfile={onOpenProfile}
        onOpenThread={onOpenThread}
        onOpenChannel={onOpenChannel}
        onOpenUsername={onOpenUsername}
      />
    );

    expect(screen.getByText(/Replying to/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('@charlie'));
    expect(onOpenUsername).toHaveBeenCalledWith('charlie');
  });
});
