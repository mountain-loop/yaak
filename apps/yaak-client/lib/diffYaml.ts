import type { SyncModel } from "@yaakapp-internal/git";
import { stringify } from "yaml";

/**
 * Convert a SyncModel to a YAML string for diffing.
 */
export function modelToYaml(model: SyncModel | null): string {
  if (!model) return "";

  return stringify(model, {
    indent: 2,
    lineWidth: 0,
  });
}
