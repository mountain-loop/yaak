import { useTimedBoolean } from "../hooks/useTimedBoolean";
import { IconButton, type IconButtonProps } from "./IconButton";

export interface CopyIconButtonProps extends Omit<IconButtonProps, "onClick" | "icon"> {
  text: string | (() => Promise<string | null>);
  copy: (text: string) => void;
  /** Called when `text` resolves to nothing */
  onCopyFailed?: () => void;
}

export function CopyIconButton({ text, copy, onCopyFailed, ...props }: CopyIconButtonProps) {
  const [copied, setCopied] = useTimedBoolean();
  return (
    <IconButton
      {...props}
      icon={copied ? "check" : "copy"}
      showConfirm
      onClick={async () => {
        const content = typeof text === "function" ? await text() : text;
        if (content == null) {
          onCopyFailed?.();
        } else {
          copy(content);
          setCopied();
        }
      }}
    />
  );
}
