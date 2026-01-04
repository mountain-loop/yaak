import classNames from 'classnames';
import type { HotkeyAction } from '../../hooks/useHotKey';
import { useHotkeyLabel } from '../../hooks/useHotKey';

interface Props {
  action: HotkeyAction;
  className?: string;
}

export function HotkeyLabel({ action, className }: Props) {
  const label = useHotkeyLabel(action);
  return (
    <span className={classNames(className, 'text-text-subtle whitespace-nowrap')}>{label}</span>
  );
}
