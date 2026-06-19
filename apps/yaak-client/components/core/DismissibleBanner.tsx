import type { Color } from "@yaakapp-internal/plugins";
import type { BannerProps } from "@yaakapp-internal/ui";
import { Banner } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useKeyValue } from "../../hooks/useKeyValue";
import type { ButtonProps } from "./Button";
import { Button } from "./Button";

export function DismissibleBanner({
  children,
  className,
  dismissForDays,
  id,
  actions,
  ...props
}: BannerProps & {
  id: string;
  dismissForDays?: number;
  actions?: {
    label: string;
    onClick: () => void;
    color?: Color;
    variant?: ButtonProps["variant"];
  }[];
}) {
  const {
    isLoading,
    set: setDismissed,
    value: dismissed,
  } = useKeyValue<boolean | string>({
    namespace: "global",
    key: ["dismiss-banner", id],
    fallback: false,
  });

  if (isLoading || isDismissed(dismissed, dismissForDays)) return null;

  return (
    <Banner className={classNames(className, "relative")} {...props}>
      <div className="@container">
        <div className="grid gap-2 @[34rem]:grid-cols-[minmax(0,1fr)_auto] @[34rem]:items-center @[34rem]:gap-3">
          {children}
          <div className="flex flex-wrap gap-1.5 @[34rem]:justify-end">
            <Button
              variant="border"
              color={props.color}
              size="xs"
              onClick={() => setDismissed(dismissForDays == null ? true : new Date().toISOString())}
              title="Dismiss message"
            >
              Dismiss
            </Button>
            {actions?.map((a) => (
              <Button
                key={a.label}
                variant={a.variant ?? "border"}
                color={a.color ?? props.color}
                size="xs"
                onClick={a.onClick}
                title={a.label}
              >
                {a.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </Banner>
  );
}

function isDismissed(
  dismissed: boolean | string | null,
  dismissForDays: number | undefined,
): boolean {
  if (dismissed === false || dismissed == null) return false;
  if (dismissed === true) return true;
  if (dismissForDays == null) return dismissed.length > 0;

  const dismissedAt = new Date(dismissed).getTime();
  if (Number.isNaN(dismissedAt)) return false;

  return Date.now() - dismissedAt < dismissForDays * 24 * 60 * 60 * 1000;
}
