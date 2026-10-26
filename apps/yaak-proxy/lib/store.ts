import { createModelStore } from "@yaakapp-internal/model-store";
import type { Flow } from "@yaakapp-internal/proxy-lib";

type ProxyModels = {
  flow: Flow;
};

export const { dataAtom, applyChange, replaceAll, listAtom, orderedListAtom } =
  createModelStore<ProxyModels>(["flow"]);

/** Oldest first, so new traffic arrives at the end of the list */
export const flowsAtom = orderedListAtom("flow", "startedAt", "asc");
