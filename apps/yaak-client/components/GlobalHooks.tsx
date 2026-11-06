import type { NavigateWorkspace } from "@yaakapp-internal/tauri-client";
import { activeRequestAtom } from "../hooks/useActiveRequest";
import { useSubscribeActiveWorkspaceId } from "../hooks/useActiveWorkspace";
import { useActiveWorkspaceChangedToast } from "../hooks/useActiveWorkspaceChangedToast";
import { useHotKey, useSubscribeHotKeys } from "../hooks/useHotKey";
import { useSubscribeHttpAuthentication } from "../hooks/useHttpAuthentication";
import { useSyncFontSizeSetting } from "../hooks/useSyncFontSizeSetting";
import { useSyncWorkspaceChildModels } from "../hooks/useSyncWorkspaceChildModels";
import { usePlatformEvent } from "../hooks/usePlatformEvent";
import { useSyncZoomSetting } from "../hooks/useSyncZoomSetting";
import { useSubscribeTemplateFunctions } from "../hooks/useTemplateFunctions";
import { fireAndForget } from "../lib/fireAndForget";
import { jotaiStore } from "../lib/jotai";
import { renameModelWithPrompt } from "../lib/renameModelWithPrompt";
import { router } from "../lib/router";

export function GlobalHooks() {
  useSyncZoomSetting();
  useSyncFontSizeSetting();

  useSubscribeActiveWorkspaceId();

  useSyncWorkspaceChildModels();
  useSubscribeTemplateFunctions();
  useSubscribeHttpAuthentication();

  // Other useful things
  useActiveWorkspaceChangedToast();
  useSubscribeHotKeys();

  usePlatformEvent("show_home", () => {
    fireAndForget(router.navigate({ to: "/", search: { home: true } }));
  });

  usePlatformEvent<NavigateWorkspace>("navigate_workspace", ({ workspaceId, environmentId }) => {
    fireAndForget(
      router.navigate({
        to: "/workspaces/$workspaceId",
        params: { workspaceId },
        search: { environment_id: environmentId },
      }),
    );
  });

  useHotKey(
    "request.rename",
    async () => {
      const model = jotaiStore.get(activeRequestAtom);
      if (model == null) return;
      await renameModelWithPrompt(model);
    },
    { allowDefault: true },
  );

  return null;
}
