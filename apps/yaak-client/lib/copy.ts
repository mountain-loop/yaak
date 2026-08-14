import { showToast } from "./toast";
import { platform } from "@yaakapp-internal/platform";

export function copyToClipboard(
  text: string | null,
  { disableToast }: { disableToast?: boolean } = {},
) {
  if (text == null) {
    platform.clipboard.clear().catch(console.error);
  } else {
    platform.clipboard.writeText(text).catch(console.error);
  }

  if (text !== "" && !disableToast) {
    showToast({
      id: "copied",
      color: "success",
      icon: "copy",
      message: "Copied to clipboard",
    });
  }
}
