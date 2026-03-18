import { useMutation } from "@tanstack/react-query";
import { InlineCode } from "../components/core/InlineCode";
import { showAlert } from "../lib/alert";
import { appInfo } from "../lib/appInfo";
import { minPromiseMillis } from "../lib/minPromiseMillis";
import { invokeCmd } from "../lib/tauri";

export function useCheckForUpdates() {
  return useMutation({
    mutationKey: ["check_for_updates"],
    mutationFn: async () => {
      const hasUpdate: boolean = await minPromiseMillis(invokeCmd("cmd_check_for_updates"), 500);
      if (!hasUpdate) {
        showAlert({
          id: "no-updates",
          title: "Обновлений нет",
          body: (
            <>
              У вас уже установлена последняя версия <InlineCode>{appInfo.version}</InlineCode>
            </>
          ),
        });
      }
    },
  });
}
