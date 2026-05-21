import classNames from "classnames";
import type { HTMLAttributes, ReactElement, ReactNode } from "react";
import { CopyIconButton } from "../CopyIconButton";

interface Props {
  children:
    | ReactElement<HTMLAttributes<HTMLTableColElement>>
    | (ReactElement<HTMLAttributes<HTMLTableColElement>> | null)[];
  selectable?: boolean;
}

export function KeyValueRows({ children, selectable }: Props) {
  const childArray = Array.isArray(children) ? children.filter(Boolean) : [children];
  return (
    <table
      className={classNames(
        "text-editor font-mono min-w-0 w-full mb-auto",
        selectable &&
          "[&_td]:select-auto [&_td]:cursor-auto [&_td_*]:select-auto [&_td_*]:cursor-auto",
      )}
    >
      <tbody className="divide-y divide-surface-highlight">
        {childArray.map((child, i) => (
          // oxlint-disable-next-line react/no-array-index-key
          <tr key={i}>{child}</tr>
        ))}
      </tbody>
    </table>
  );
}

interface KeyValueRowProps {
  label: ReactNode;
  children: ReactNode;
  rightSlot?: ReactNode;
  leftSlot?: ReactNode;
  align?: "top" | "middle";
  labelClassName?: string;
  labelColor?: "secondary" | "primary" | "info";
  enableCopy?: boolean;
  copyText?: string;
}

export function KeyValueRow({
  label,
  children,
  rightSlot,
  leftSlot,
  align = "top",
  labelColor = "secondary",
  labelClassName,
  enableCopy,
  copyText,
}: KeyValueRowProps) {
  const textToCopy =
    copyText ??
    (typeof children === "string" || typeof children === "number" ? `${children}` : null);
  const resolvedRightSlot =
    rightSlot ??
    (enableCopy && textToCopy != null ? (
      <CopyIconButton
        text={textToCopy}
        className="text-text-subtle"
        size="2xs"
        title={`Copy ${label}`}
        iconSize="sm"
      />
    ) : null);

  return (
    <>
      <td
        className={classNames(
          "select-none py-0.5 pr-2 h-full max-w-[10rem]",
          align === "top" && "align-top",
          align === "middle" && "align-middle",
          labelClassName,
          labelColor === "primary" && "text-primary",
          labelColor === "secondary" && "text-text-subtle",
          labelColor === "info" && "text-info",
        )}
      >
        <span className="select-text cursor-text">{label}</span>
      </td>
      <td
        className={classNames(
          "select-none py-0.5 break-all max-w-[15rem]",
          align === "top" && "align-top",
          align === "middle" && "align-middle",
        )}
      >
        <div className="select-text cursor-text max-h-[12rem] overflow-y-auto grid grid-cols-[auto_minmax(0,1fr)_auto]">
          {leftSlot ?? <span aria-hidden />}
          {children}
          {resolvedRightSlot ? (
            <div className="ml-1.5">{resolvedRightSlot}</div>
          ) : (
            <span aria-hidden />
          )}
        </div>
      </td>
    </>
  );
}
