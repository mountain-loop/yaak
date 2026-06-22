import { settingsAtom } from "@yaakapp-internal/models";
import { resolveAppearance } from "@yaakapp-internal/theme";
import { useAtomValue } from "jotai";
import { usePreferredAppearance } from "./usePreferredAppearance";

export function useResolvedAppearance() {
  const preferredAppearance = usePreferredAppearance();
  const settings = useAtomValue(settingsAtom);
  return resolveAppearance(preferredAppearance, settings.appearance);
}
