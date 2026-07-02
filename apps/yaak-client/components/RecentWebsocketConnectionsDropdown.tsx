import type { WebsocketConnection } from "@yaakapp-internal/models";
import { deleteModel, getModel } from "@yaakapp-internal/models";
import { HStack, Icon } from "@yaakapp-internal/ui";
import { deleteWebsocketConnections } from "../commands/deleteWebsocketConnections";
import { pluralizeCount } from "../lib/pluralize";
import { Dropdown, type DropdownItem } from "./core/Dropdown";
import { formatMillis } from "./core/HttpResponseDurationTag";
import { IconButton } from "./core/IconButton";
import { formatRelativeTimeGroup } from "./core/RelativeTime";

interface Props {
  connections: WebsocketConnection[];
  activeConnection: WebsocketConnection;
  onPinnedConnectionId: (id: string) => void;
}

export function RecentWebsocketConnectionsDropdown({
  activeConnection,
  connections,
  onPinnedConnectionId,
}: Props) {
  const latestConnectionId = connections[0]?.id ?? "n/a";
  const connectionHistoryItems: DropdownItem[] = [];
  let lastHistoryGroup: string | null = null;
  let hasRecentConnections = false;
  let hasShownRecentEmptyState = false;

  for (const c of connections) {
    const historyGroup = formatRelativeTimeGroup(c.createdAt);

    if (historyGroup === "Just now") {
      hasRecentConnections = true;
    } else if (!hasRecentConnections && !hasShownRecentEmptyState) {
      connectionHistoryItems.push({
        type: "content",
        label: <span className="block px-4 py-1 text-sm text-text-subtle">No recent connections</span>,
      });
      hasShownRecentEmptyState = true;
    }

    if (historyGroup !== "Just now" && historyGroup !== lastHistoryGroup) {
      connectionHistoryItems.push({ type: "separator", label: historyGroup });
      lastHistoryGroup = historyGroup;
    }

    connectionHistoryItems.push({
      label: (
        <HStack space={2} className="text-sm">
          <span className="font-mono">{formatMillis(c.elapsed)}</span>
        </HStack>
      ),
      leftSlot: activeConnection?.id === c.id ? <Icon icon="check" /> : <Icon icon="empty" />,
      onSelect: () => onPinnedConnectionId(c.id),
    });
  }

  if (!hasRecentConnections && !hasShownRecentEmptyState) {
    connectionHistoryItems.push({
      type: "content",
      label: <span className="block px-4 py-1 text-sm text-text-subtle">No recent connections</span>,
    });
  }

  return (
    <Dropdown
      items={[
        {
          label: "Clear Connection",
          onSelect: () => deleteModel(activeConnection),
          disabled: connections.length === 0,
        },
        {
          label: `Clear ${pluralizeCount("Connection", connections.length)}`,
          onSelect: () => {
            const request = getModel("websocket_request", activeConnection.requestId);
            if (request != null) {
              deleteWebsocketConnections.mutate(request);
            }
          },
          hidden: connections.length <= 1,
          disabled: connections.length === 0,
        },
        { type: "separator", label: "History" },
        ...connectionHistoryItems,
      ]}
    >
      <IconButton
        title="Show connection history"
        icon={activeConnection?.id === latestConnectionId ? "history" : "pin"}
        className="m-0.5 text-text-subtle"
        size="sm"
        iconSize="md"
      />
    </Dropdown>
  );
}
