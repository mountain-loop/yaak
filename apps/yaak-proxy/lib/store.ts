import { createModelStore } from "@yaakapp-internal/model-store";
import type { Flow } from "@yaakapp-internal/proxy-lib";

type ProxyModels = {
  flow: Flow;
};

export const { dataAtom, applyChange, replaceAll, listAtom, orderedListAtom } =
  createModelStore<ProxyModels>(["flow"]);

export const flowsAtom = orderedListAtom("flow", "startedAt", "desc");
