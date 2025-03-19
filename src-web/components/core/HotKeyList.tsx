import classNames from 'classnames';
import React, { Fragment } from 'react';
import type { HotkeyAction } from '../../hooks/useHotKey';
import { HotKey } from './HotKey';
import { HotKeyLabel } from './HotKeyLabel';

interface Props {
  hotkeys: HotkeyAction[];
  bottomSlot?: React.ReactNode;
  className?: string;
}

export const HotKeyList = ({ hotkeys, bottomSlot, className }: Props) => {
  return (
    <div className={classNames(className, 'h-full flex items-center justify-center')}>
      <div className="grid gap-2 grid-cols-[auto_auto]">
        {hotkeys.map((hotkey) => (
          <Fragment key={hotkey}>
            <HotKeyLabel className="truncate" action={hotkey} />
            <HotKey className="ml-4" action={hotkey} />
          </Fragment>
        ))}
        {bottomSlot}
      </div>
    </div>
  );
};
