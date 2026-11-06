import { KeyValueRow as BaseKeyValueRow, type KeyValueRowProps } from "@yaakapp-internal/ui";
import { copyToClipboard } from "../../lib/copy";

export function KeyValueRow(props: Omit<KeyValueRowProps, "copy">) {
  return <BaseKeyValueRow {...props} copy={copy} />;
}

function copy(text: string) {
  copyToClipboard(text, { disableToast: true });
}
