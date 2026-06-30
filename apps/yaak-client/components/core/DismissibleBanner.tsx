import type { Color } from "@yaakapp-internal/plugins";
import type { BannerProps } from "@yaakapp-internal/ui";
import { Banner } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useEffect } from "react";
import { useKeyValue } from "../../hooks/useKeyValue";
import type { ButtonProps } from "./Button";
import { Button } from "./Button";

export function DismissibleBanner({
  children,
  className,
  id,
  onDismiss,
  onShow,
  actions,
  ...props
}: BannerProps & {
  id: string;
  onDismiss?: () => void | Promise<void>;
  onShow?: () => void | Promise<void>;
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
  } = useKeyValue<boolean>({
    namespace: "global",
    key: ["dismiss-banner", id],
    fallback: false,
  });

  const shouldShow = !isLoading && !dismissed;

  useEffect(() => {
    if (shouldShow) {
      Promise.resolve(onShow?.()).catch(console.error);
    }
  }, [onShow, shouldShow]);

  if (!shouldShow) return null;

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
              onClick={() => {
                setDismissed(true).catch(console.error);
                Promise.resolve(onDismiss?.()).catch(console.error);
              }}
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
