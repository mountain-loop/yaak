import { Button, type ButtonProps } from "@yaakapp-internal/ui";
import { useCallback, useState } from "react";
import type { ActionInvocation } from "@yaakapp-internal/proxy-lib";
import { useActionMetadata } from "./hooks";
import { rpc } from "./rpc";

type ActionButtonProps = Omit<ButtonProps, "onClick" | "children"> & {
  action: ActionInvocation;
  /** Override the label from metadata */
  children?: React.ReactNode;
};

export function ActionButton({ action, children, ...props }: ActionButtonProps) {
  const meta = useActionMetadata(action);
  const [busy, setBusy] = useState(false);

  const onClick = useCallback(async () => {
    setBusy(true);
    try {
      await rpc("execute_action", action);
    } finally {
      setBusy(false);
    }
  }, [action]);

  return (
    <Button {...props} disabled={props.disabled || busy} isLoading={busy} onClick={onClick}>
      {children ?? meta?.label ?? "…"}
    </Button>
  );
}
