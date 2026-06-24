import { useEffect, useState } from "react";
import type { Appearance } from "@yaakapp-internal/theme";
import { getCSSAppearance, subscribeToPreferredAppearance } from "@yaakapp-internal/theme";

export function usePreferredAppearance() {
  const [preferredAppearance, setPreferredAppearance] = useState<Appearance>(getCSSAppearance());
  useEffect(() => subscribeToPreferredAppearance(setPreferredAppearance), []);
  return preferredAppearance;
}
