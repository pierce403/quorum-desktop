import React from 'react';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '@lingui/react';
import { i18n } from '@lingui/core';
import { messages } from '@/i18n/en/messages';
import { FarcasterPage } from '@/components/farcaster/FarcasterPage';

beforeAll(() => {
  i18n.load('en', messages);
  i18n.activate('en');
});

const renderFarcasterPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <I18nProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <FarcasterPage />
      </QueryClientProvider>
    </I18nProvider>
  );
};

describe('FarcasterPage', () => {
  it('renders header, title, search bar, and account connection bar', async () => {
    renderFarcasterPage();

    expect(screen.getByText('Farcaster')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Open @username or /channel')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Browse the public network or import your Farcaster account to post and react.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Import account' })
    ).toBeInTheDocument();
  });

  it('opens and closes the import modal when clicking Import account', async () => {
    renderFarcasterPage();

    const importButton = screen.getByRole('button', { name: 'Import account' });
    fireEvent.click(importButton);

    expect(
      screen.getByText('Import Farcaster account')
    ).toBeInTheDocument();

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(
        screen.queryByText('Import Farcaster account')
      ).not.toBeInTheDocument();
    });
  });

  it('navigates to channel view when entering a /channel search query', async () => {
    renderFarcasterPage();

    const searchInput = screen.getByPlaceholderText('Open @username or /channel');
    fireEvent.change(searchInput, { target: { value: '/ethereum' } });

    const openButton = screen.getByRole('button', { name: 'Open' });
    fireEvent.click(openButton);

    expect(screen.getByText('/ethereum')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();

    // Clicking back returns to trending
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Trending')).toBeInTheDocument();
  });
});
