import type { PullResult, PushResult } from "@yaakapp-internal/git";
import { showToast } from "../../lib/toast";

export function handlePushResult(r: PushResult) {
  switch (r.type) {
    case "needs_credentials":
      showToast({ id: "push-error", message: "Учётные данные не найдены", color: "danger" });
      break;
    case "success":
      showToast({ id: "push-success", message: r.message, color: "success" });
      break;
    case "up_to_date":
      showToast({ id: "push-nothing", message: "Уже актуально", color: "info" });
      break;
  }
}

export function handlePullResult(r: PullResult) {
  switch (r.type) {
    case "needs_credentials":
      showToast({ id: "pull-error", message: "Учётные данные не найдены", color: "danger" });
      break;
    case "success":
      showToast({ id: "pull-success", message: r.message, color: "success" });
      break;
    case "up_to_date":
      showToast({ id: "pull-nothing", message: "Уже актуально", color: "info" });
      break;
    case "diverged":
      // Handled by mutation callback before reaching here
      break;
    case "uncommitted_changes":
      // Handled by mutation callback before reaching here
      break;
  }
}
