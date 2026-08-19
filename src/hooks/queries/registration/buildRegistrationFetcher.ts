import { QuorumApiClient } from '../../../api/baseTypes';

const buildRegistrationFetcher =
  ({ apiClient, address }: { apiClient: QuorumApiClient; address: string }) =>
  async () => {
    try {
      const response = await apiClient.getUser(address);

      return {
        registration: response.data,
        registered: true,
      };
    } catch (e: unknown) {
      const err = e as Record<string, unknown> | undefined;
      const message = typeof err?.message === 'string' ? err.message.toLowerCase() : '';
      if (
        err?.status === 404 ||
        message.includes('404') ||
        message.includes('not found') ||
        message.includes('failed to fetch') ||
        message.includes('network error')
      ) {
        return { registered: false };
      } else {
        return { registered: false };
      }
    }
  };

export { buildRegistrationFetcher };
