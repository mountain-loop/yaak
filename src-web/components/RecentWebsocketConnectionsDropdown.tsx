import type { WebsocketConnection } from '@yaakapp-internal/models';
import { formatDistanceToNowStrict } from 'date-fns';
import { deleteWebsocketConnection } from '../commands/deleteWebsocketConnection';
import { deleteWebsocketConnections } from '../commands/deleteWebsocketConnections';
import { websocketRequestsAtom } from '../hooks/useWebsocketRequests';
import { jotaiStore } from '../lib/jotai';
import { pluralizeCount } from '../lib/pluralize';
import { Dropdown } from './core/Dropdown';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { HStack } from './core/Stacks';

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
  const latestConnectionId = connections[0]?.id ?? 'n/a';

  return (
    <Dropdown
      items={[
        {
          label: 'Clear Connection',
          onSelect: () => deleteWebsocketConnection.mutate(activeConnection),
          disabled: connections.length === 0,
        },
        {
          label: `Clear ${pluralizeCount('Connection', connections.length)}`,
          onSelect: () => {
            const request = jotaiStore
              .get(websocketRequestsAtom)
              .find((r) => r.id === activeConnection.requestId);
            if (request != null) {
              deleteWebsocketConnections.mutate(request);
            }
          },
          hidden: connections.length <= 1,
          disabled: connections.length === 0,
        },
        { type: 'separator', label: 'History' },
        ...connections.map((c) => ({
          label: (
            <HStack space={2}>
              {formatDistanceToNowStrict(c.createdAt + 'Z')} ago &bull;{' '}
              <span className="font-mono text-sm">{c.elapsed}ms</span>
            </HStack>
          ),
          leftSlot: activeConnection?.id === c.id ? <Icon icon="check" /> : <Icon icon="empty" />,
          onSelect: () => onPinnedConnectionId(c.id),
        })),
      ]}
    >
      <IconButton
        title="Show connection history"
        icon={activeConnection?.id === latestConnectionId ? 'chevron_down' : 'pin'}
        className="m-0.5"
        size="sm"
        iconSize="md"
      />
    </Dropdown>
  );
}
