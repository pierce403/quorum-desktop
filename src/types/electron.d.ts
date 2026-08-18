export {};

declare global {
  interface Window {
    electron?: {
      platform: string;
      windowControls: {
        minimize(): void;
        maximize(): void;
        close(): void;
      };
      openLogin(): Promise<unknown>;
      clipboard: { copySecret(text: string): Promise<number> };
      secureStorage: {
        status(): Promise<{ available: boolean; backend: string }>;
        get(key: 'farcaster-account' | 'farcaster-signer'): Promise<string | null>;
        set(key: 'farcaster-account' | 'farcaster-signer', value: string): Promise<void>;
        delete(key: 'farcaster-account' | 'farcaster-signer'): Promise<void>;
      };
    };
  }
}
