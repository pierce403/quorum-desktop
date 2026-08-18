import { useMemo } from 'react';
import { isDesktop } from '../../../utils/platform';

interface UseElectronDetectionReturn {
  isElectron: boolean;
  isDesktop: boolean;
}

export const useElectronDetection = (): UseElectronDetectionReturn => {
  const isDesktopEnv = useMemo(() => {
    return isDesktop();
  }, []);

  return {
    isElectron: isDesktopEnv,
    isDesktop: isDesktopEnv,
  };
};
