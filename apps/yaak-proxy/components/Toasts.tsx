import { Button, Icon, IconButton } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useAtom } from "jotai";
import { toastsAtom } from "../lib/toast";

/** The client's toasts: bottom right, newest last */
export function Toasts() {
  const [toasts, setToasts] = useAtom(toastsAtom);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[24rem] max-w-[calc(100vw-2rem)]">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={classNames(
            "x-theme-toast grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2.5 items-start",
            "bg-surface border border-border rounded-md shadow-lg px-3 py-2.5 text-sm",
          )}
        >
          <Icon
            icon={
              toast.color === "danger"
                ? "circle_alert"
                : toast.color === "info"
                  ? "info"
                  : "check_circle"
            }
            color={toast.color ?? "success"}
            className="mt-0.5"
          />
          <div className="min-w-0 text-text">
            <div className="break-words">{toast.message}</div>
            {toast.action != null && (
              <Button size="2xs" variant="border" className="mt-2" onClick={toast.action.onClick}>
                {toast.action.label}
              </Button>
            )}
          </div>
          <IconButton
            size="xs"
            icon="x"
            title="Dismiss"
            iconColor="secondary"
            onClick={() => setToasts((ts) => ts.filter((t) => t.id !== toast.id))}
          />
        </div>
      ))}
    </div>
  );
}
