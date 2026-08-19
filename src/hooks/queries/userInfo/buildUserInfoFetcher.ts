import { MessageDB } from '../../../db/messages';
import { t } from '@lingui/core/macro';

const buildUserInfoFetcher =
  ({ messageDB, address }: { messageDB: MessageDB; address: string }) =>
  async () => {
    try {
      const response = await messageDB.getUser({ address });
      if (!response?.userProfile) {
        return { address, display_name: t`Unknown User` };
      }

      return {
        address,
        ...response.userProfile,
      };
    } catch (_e) {
      return { address, display_name: t`Unknown User` };
    }
  };

export { buildUserInfoFetcher };
