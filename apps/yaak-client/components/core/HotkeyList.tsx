import classNames from "classnames";
import type { ReactNode } from "react";
import { Fragment } from "react";
import type { HotkeyAction } from "../../hooks/useHotKey";
import { Hotkey } from "./Hotkey";
import { HotkeyLabel } from "./HotkeyLabel";

interface Props {
  hotkeys: HotkeyAction[];
  bottomSlot?: ReactNode;
  className?: string;
}

export const HotkeyList = ({ hotkeys, bottomSlot, className }: Props) => {
  return (
    <div className={classNames(className, "h-full flex items-center justify-center")}>
      <div className="grid gap-2 grid-cols-[auto_auto]">
        {hotkeys.map((hotkey) => (
          <Fragment key={hotkey}>
            <HotkeyLabel className="truncate" action={hotkey} />
            {/* Keep this grid cell when Hotkey renders nothing so later rows stay aligned. */}
            <div className="ml-4">
              <Hotkey action={hotkey} />
            </div>
          </Fragment>
        ))}
        {bottomSlot}
      </div>
    </div>
  );
};
