import { useEffect, useState } from 'react';
import type { Appearance } from '../lib/theme/appearance';
import { getCSSAppearance, subscribeToPreferredAppearance } from '../lib/theme/appearance';

export function usePreferredAppearance() {
  const [preferredAppearance, setPreferredAppearance] = useState<Appearance>(getCSSAppearance());
  useEffect(() => subscribeToPreferredAppearance(setPreferredAppearance), []);
  return preferredAppearance;
}
