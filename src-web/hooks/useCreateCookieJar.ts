import { createWorkspaceModel } from "@yaakapp-internal/models";
import { jotaiStore } from "../lib/jotai";
import { showPrompt } from "../lib/prompt";
import { setWorkspaceSearchParams } from "../lib/setWorkspaceSearchParams";
import { activeWorkspaceIdAtom } from "./useActiveWorkspace";
import { useFastMutation } from "./useFastMutation";

export function useCreateCookieJar() {
  return useFastMutation({
    mutationKey: ["create_cookie_jar"],
    mutationFn: async () => {
      const workspaceId = jotaiStore.get(activeWorkspaceIdAtom);
      if (workspaceId == null) {
        throw new Error("Невозможно создать CookieJar без активного рабочего пространства");
      }

      const name = await showPrompt({
        id: "new-cookie-jar",
        title: "Новый CookieJar",
        placeholder: "Мой jar",
        confirmText: "Создать",
        label: "Название",
        defaultValue: "Мой jar",
      });
      if (name == null) return null;

      return createWorkspaceModel({ model: "cookie_jar", workspaceId, name });
    },
    onSuccess: async (cookieJarId) => {
      setWorkspaceSearchParams({ cookie_jar_id: cookieJarId });
    },
  });
}
