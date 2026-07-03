import type { Color } from "@yaakapp-internal/plugins";
import type { BannerProps } from "@yaakapp-internal/ui";
import { Banner } from "@yaakapp-internal/ui";
import classNames from "classnames";
import type { MouseEvent } from "react";
import { useEffect } from "react";
import { useKeyValue } from "../../hooks/useKeyValue";
import type { ButtonProps } from "./Button";
import { Button } from "./Button";

type DismissibleBannerSize = "sm" | "xs";

export function DismissibleBanner({
  children,
  className,
  id,
  size = "sm",
  onDismiss,
  onShow,
  actions,
  ...props
}: BannerProps & {
  id: string;
  size?: DismissibleBannerSize;
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

  const actionSize: ButtonProps["size"] = size === "xs" ? "2xs" : "xs";
  const stopParentClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <Banner
      className={classNames(
        className,
        "relative",
        size === "xs" && "!px-2 !py-2 text-xs",
      )}
      {...props}
    >
      <div className="@container">
        <div
          className={classNames(
            "grid @[34rem]:grid-cols-[minmax(0,1fr)_auto] @[34rem]:items-center",
            size === "xs" ? "gap-1.5 @[34rem]:gap-2" : "gap-2 @[34rem]:gap-3",
          )}
        >
          {children}
          <div className="flex flex-wrap gap-1.5 @[34rem]:justify-end">
            <Button
              variant="border"
              color={props.color}
              size={actionSize}
              onClick={(event) => {
                stopParentClick(event);
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
                size={actionSize}
                onClick={(event) => {
                  stopParentClick(event);
                  a.onClick();
                }}
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
