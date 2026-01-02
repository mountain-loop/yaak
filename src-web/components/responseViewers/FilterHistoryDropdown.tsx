import { useMemo } from 'react';
import type { HistoryItem } from '../../hooks/useInputHistory';
import { CountBadge } from '../core/CountBadge';
import type { DropdownItem } from '../core/Dropdown';
import { Dropdown } from '../core/Dropdown';
import { Icon } from '../core/Icon';
import { IconButton } from '../core/IconButton';

interface Props {
  history: HistoryItem[];
  currentValue: string | null;
  onSelect: (value: string) => void;
  onRemove: (value: string) => void;
  onClearAll: () => void;
}

export function FilterHistoryDropdown({
  history,
  currentValue,
  onSelect,
  onRemove,
  onClearAll,
}: Props) {
  const groupedHistory = useMemo(() => {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    const today: typeof history = [];
    const yesterday: typeof history = [];
    const older: typeof history = [];

    for (const item of history) {
      const age = now - item.timestamp;
      if (age < oneDayMs) {
        today.push(item);
      } else if (age < 2 * oneDayMs) {
        yesterday.push(item);
      } else {
        older.push(item);
      }
    }

    return { today, yesterday, older };
  }, [history]);

  const historyItems = useMemo<DropdownItem[]>(() => {
    const items: DropdownItem[] = [];

    if (history.length === 0) {
      return items;
    }

    // Actions
    items.push({
      type: 'default',
      label: 'Clear All History',
      leftSlot: <Icon icon="trash" />,
      color: 'danger',
      onSelect: onClearAll,
    });

    // Helper to create history item
    const createHistoryItem = (item: (typeof history)[0], showDate = false) => {
      const dateStr = showDate
        ? new Date(item.timestamp).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year:
              new Date(item.timestamp).getFullYear() !== new Date().getFullYear()
                ? 'numeric'
                : undefined,
          })
        : null;

      const isSelected = item.value === currentValue;

      // Truncate long filter expressions
      const MAX_DISPLAY_LENGTH = 80;
      const displayValue =
        item.value.length > MAX_DISPLAY_LENGTH
          ? `${item.value.slice(0, MAX_DISPLAY_LENGTH)}...`
          : item.value;

      return {
        type: 'default' as const,
        label: (
          <div className="flex items-center justify-between w-full gap-1 group/item">
            <div className="flex-1 min-w-0">
              <div
                className="font-mono text-sm truncate max-w-md leading-relaxed"
                title={item.value}
              >
                {displayValue}
              </div>
              {dateStr && <div className="text-xs text-text-subtlest mt-0.5">{dateStr}</div>}
            </div>
            <div className="flex items-center gap-0.5 flex-shrink-0">
              {/* biome-ignore lint/a11y/noStaticElementInteractions: Delete action within dropdown menu item
              TODO: need to refactor the dropdown components should not render the item as button */}
              <span
                className="flex items-center justify-center w-5 h-5 rounded text-text-subtlest group-hover/item:text-danger hover:!text-danger hover:bg-danger/10 cursor-pointer opacity-0 group-hover/item:opacity-100 transition-all duration-150"
                title="Remove from history"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(item.value);
                }}
              >
                <Icon icon="trash" size="xs" />
              </span>
              {isSelected ? <Icon icon="check" className="text-primary" /> : <Icon icon="empty" />}
            </div>
          </div>
        ),
        onSelect: () => onSelect(item.value),
      };
    };

    // Add grouped items
    const groups = [
      { label: 'Today', items: groupedHistory.today, showDate: false },
      { label: 'Yesterday', items: groupedHistory.yesterday, showDate: false },
      { label: 'Older', items: groupedHistory.older, showDate: true },
    ];

    for (const group of groups) {
      if (group.items.length > 0) {
        items.push({ type: 'separator', label: group.label });
        for (const item of group.items) {
          items.push(createHistoryItem(item, group.showDate));
        }
      }
    }

    return items;
  }, [history, currentValue, onSelect, onRemove, onClearAll, groupedHistory]);

  if (history.length === 0) {
    return null;
  }

  return (
    <Dropdown items={historyItems}>
      <div className="relative">
        <IconButton
          size="sm"
          icon="history"
          title="Show filter history"
          className="text-text-subtle"
          aria-label={`Show ${history.length} filter history items`}
        />
        <CountBadge
          count={history.length}
          className="absolute -top-0.5 -right-0.5 pointer-events-none"
        />
      </div>
    </Dropdown>
  );
}
