import { Icon } from "@yaakapp-internal/ui";
import type { RecentFilter } from "../../hooks/useRecentFilters";
import { Dropdown, type DropdownItem } from "../core/Dropdown";
import { IconButton } from "../core/IconButton";

interface Props {
  recentFilters: RecentFilter[];
  activeFilter: string | null;
  onSelect: (value: string) => void;
  onRemove: (value: string) => void;
  onTogglePin: (value: string) => void;
  onClear: () => void;
}

export function RecentFiltersDropdown({
  recentFilters,
  activeFilter,
  onSelect,
  onRemove,
  onTogglePin,
  onClear,
}: Props) {
  const pinned = recentFilters.filter((f) => f.pinned);
  const unpinned = recentFilters.filter((f) => !f.pinned);

  const toItem = (filter: RecentFilter): DropdownItem => ({
    label: (
      <div className="font-mono text-sm truncate max-w-sm" title={filter.value}>
        {filter.value}
      </div>
    ),
    leftSlot: <Icon icon={filter.value === activeFilter ? "check" : "empty"} />,
    onSelect: () => onSelect(filter.value),
    submenuTrigger: "button",
    submenu: [
      {
        label: filter.pinned ? "Unpin" : "Pin",
        icon: filter.pinned ? "unpin" : "pin",
        keepOpenOnSelect: true,
        onSelect: () => onTogglePin(filter.value),
      },
      {
        label: "Remove",
        icon: "trash",
        color: "danger",
        keepOpenOnSelect: true,
        onSelect: () => onRemove(filter.value),
      },
    ],
  });

  const items: DropdownItem[] = [];

  if (recentFilters.length === 0) {
    items.push({
      type: "content",
      label: (
        <span className="block px-4 py-1 text-sm text-text-subtle">
          Filters you use are remembered here
        </span>
      ),
    });
  }

  if (pinned.length > 0) {
    items.push({ type: "separator", label: "Pinned" }, ...pinned.map(toItem));
  }

  if (unpinned.length > 0) {
    items.push({ type: "separator", label: "Recent" }, ...unpinned.map(toItem));
  }

  if (recentFilters.length > 0) {
    items.push(
      { type: "separator" },
      {
        label: "Clear All",
        leftSlot: <Icon icon="trash" />,
        color: "danger",
        onSelect: onClear,
      },
    );
  }

  return (
    <Dropdown items={items}>
      <IconButton
        size="xs"
        icon="filter"
        title="Recent filters"
        iconColor="secondary"
        className="w-8 ml-0.5 mr-1 h-auto!"
      />
    </Dropdown>
  );
}
