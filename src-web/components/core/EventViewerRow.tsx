import classNames from 'classnames';
import { format } from 'date-fns';
import type { ReactNode } from 'react';

interface EventViewerRowProps {
  isActive: boolean;
  onClick: () => void;
  icon: ReactNode;
  content: ReactNode;
  timestamp?: string;
}

export function EventViewerRow({
  isActive,
  onClick,
  icon,
  content,
  timestamp,
}: EventViewerRowProps) {
  return (
    <div className="px-1">
      <button
        type="button"
        onClick={onClick}
        className={classNames(
          'w-full grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2 items-center text-left',
          'px-1.5 h-xs font-mono text-editor cursor-default group focus:outline-none focus:text-text rounded',
          isActive && 'bg-surface-active !text-text',
          'text-text-subtle hover:text',
        )}
      >
        {icon}
        <div className="w-full truncate">{content}</div>
        {timestamp && <div className="opacity-50">{format(`${timestamp}Z`, 'HH:mm:ss.SSS')}</div>}
      </button>
    </div>
  );
}
