import {
  CopyIconButton as BaseCopyIconButton,
  type CopyIconButtonProps,
} from "@yaakapp-internal/ui";
import { copyToClipboard } from "../lib/copy";
import { showToast } from "../lib/toast";

export function CopyIconButton(props: Omit<CopyIconButtonProps, "copy" | "onCopyFailed">) {
  return <BaseCopyIconButton {...props} copy={copy} onCopyFailed={showCopyFailed} />;
}

function copy(text: string) {
  copyToClipboard(text, { disableToast: true });
}

function showCopyFailed() {
  showToast({
    id: "failed-to-copy",
    color: "danger",
    message: "Failed to copy",
  });
}
