import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider } from '@lingui/react';
import { i18n } from '@lingui/core';
import { messages } from '@/i18n/en/messages';
import { FarcasterCastCard } from '@/components/farcaster/FarcasterCastCard';
import type { NormalizedCast } from '@quilibrium/quorum-shared';

beforeAll(() => {
  i18n.load('en', messages);
  i18n.activate('en');
});

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

    render(
      <I18nProvider i18n={i18n}>
        <FarcasterCastCard
          cast={mockCast}
          onOpenProfile={onOpenProfile}
          onOpenThread={onOpenThread}
          onOpenChannel={onOpenChannel}
          onOpenUsername={onOpenUsername}
        />
      </I18nProvider>
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

    render(
      <I18nProvider i18n={i18n}>
        <FarcasterCastCard
          cast={mockCast}
          onOpenProfile={onOpenProfile}
          onOpenThread={onOpenThread}
          onOpenChannel={onOpenChannel}
          onOpenUsername={onOpenUsername}
        />
      </I18nProvider>
    );

    fireEvent.click(screen.getByText('Alice In Chains'));
    expect(onOpenProfile).toHaveBeenCalledWith(123);
  });

  it('triggers onOpenUsername and onOpenChannel when clicking parsed tokens', () => {
    const onOpenProfile = vi.fn();
    const onOpenThread = vi.fn();
    const onOpenChannel = vi.fn();
    const onOpenUsername = vi.fn();

    render(
      <I18nProvider i18n={i18n}>
        <FarcasterCastCard
          cast={mockCast}
          onOpenProfile={onOpenProfile}
          onOpenThread={onOpenThread}
          onOpenChannel={onOpenChannel}
          onOpenUsername={onOpenUsername}
        />
      </I18nProvider>
    );

    fireEvent.click(screen.getByText('@bob'));
    expect(onOpenUsername).toHaveBeenCalledWith('bob');

    fireEvent.click(screen.getByText('/farcaster'));
    expect(onOpenChannel).toHaveBeenCalledWith('farcaster');
  });

  it('triggers onOpenThread when clicking replies button', () => {
    const onOpenProfile = vi.fn();
    const onOpenThread = vi.fn();
    const onOpenChannel = vi.fn();
    const onOpenUsername = vi.fn();

    render(
      <I18nProvider i18n={i18n}>
        <FarcasterCastCard
          cast={mockCast}
          onOpenProfile={onOpenProfile}
          onOpenThread={onOpenThread}
          onOpenChannel={onOpenChannel}
          onOpenUsername={onOpenUsername}
        />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open cast thread' }));
    expect(onOpenThread).toHaveBeenCalledWith('0x1234567890abcdef');
  });
});
