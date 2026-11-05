import { UrlBar as BaseUrlBar, type UrlBarProps } from "@yaakapp-internal/ui";
import { memo } from "react";

type Props = Omit<UrlBarProps, "sendHotkeyAction" | "focusHotkeyAction" | "readOnly"> & {
  onSend: () => void;
  onUrlChange: (url: string) => void;
  onCancel: () => void;
  isLoading: boolean;
};

/** The shared URL bar, sending and focusing on the client's hotkeys */
export const UrlBar = memo(function UrlBar(props: Props) {
  return <BaseUrlBar {...props} sendHotkeyAction="request.send" focusHotkeyAction="url_bar.focus" />;
});
