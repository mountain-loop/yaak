import classNames from "classnames";
import type { HTMLAttributes, ReactNode } from "react";
import { useInMemoryStoredValue, type UseStoredValue } from "../hooks/useStoredValue";
import type { BannerProps } from "./Banner";
import { Banner } from "./Banner";

export interface DetailsBannerProps extends HTMLAttributes<HTMLDetailsElement> {
  summary: ReactNode;
  color?: BannerProps["color"];
  defaultOpen?: boolean;
  storageKey?: string;
  /** Where the open state of a banner with a `storageKey` is kept */
  useStoredValue?: UseStoredValue;
}

export function DetailsBanner({
  className,
  color,
  summary,
  children,
  defaultOpen,
  storageKey,
  useStoredValue = useInMemoryStoredValue,
  ...extraProps
}: DetailsBannerProps) {
  const [isOpen, setIsOpen] = useStoredValue<boolean>(storageKey || null, defaultOpen ?? false);

  const handleToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (storageKey) {
      void setIsOpen(e.currentTarget.open);
    }
  };

  return (
    <Banner color={color} className={className}>
      <details className="group list-none" open={isOpen} onToggle={handleToggle} {...extraProps}>
        <summary className="cursor-default! select-none! list-none flex items-center gap-3 focus:outline-hidden opacity-70">
          <div
            className={classNames(
              "transition-transform",
              "group-open:rotate-90",
              "w-0 h-0 border-t-[0.3em] border-b-[0.3em] border-l-[0.5em] border-r-0",
              "border-t-transparent border-b-transparent border-l-text-subtle",
            )}
          />
          {summary}
        </summary>
        <div className="mt-1.5 pb-2">{children}</div>
      </details>
    </Banner>
  );
}
