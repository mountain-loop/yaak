import type { ReactNode } from 'react';
import { appInfo } from '../lib/appInfo';

interface Props {
  children: ReactNode;
  feature: 'updater' | 'license';
}

const featureMap: Record<Props['feature'], boolean> = {
  updater: appInfo.featureUpdater,
  license: appInfo.featureLicense,
};

export function CargoFeature({ children, feature }: Props) {
  if (featureMap[feature]) {
    return <>{children}</>;
  } else {
    return null;
  }
}
