import type { UncommittedChangesStrategy } from "@yaakapp-internal/git";
import { showConfirm } from "../../lib/confirm";

export async function promptUncommittedChangesStrategy(): Promise<UncommittedChangesStrategy> {
  const confirmed = await showConfirm({
    id: "git-uncommitted-changes",
    title: "Незафиксированные изменения",
    description: "У вас есть незафиксированные изменения. Зафиксируйте или сбросьте изменения перед pull.",
    confirmText: "Сбросить и выполнить pull",
    color: "danger",
  });
  return confirmed ? "reset" : "cancel";
}
