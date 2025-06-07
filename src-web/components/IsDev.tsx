import type { ReactNode } from 'react';
import { appInfo } from '../lib/appInfo';

interface Props {
  children: ReactNode;
}

export function IsDev({ children }: Props) {
  if (!appInfo.isDev) {
    return null;
  }

  return <>{children}</>;
}
