import { formatDistanceToNowStrict } from 'date-fns';
import { useDeleteGrpcConnection } from '../hooks/useDeleteGrpcConnection';
import { useDeleteGrpcConnections } from '../hooks/useDeleteGrpcConnections';
import type { GrpcConnection } from '@yaakapp-internal/models';
import { pluralizeCount } from '../lib/pluralize';
import { Dropdown } from './core/Dropdown';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { HStack } from './core/Stacks';

interface Props {
  connections: GrpcConnection[];
  activeConnection: GrpcConnection;
  onPinnedConnectionId: (id: string) => void;
}

export function RecentConnectionsDropdown({
  activeConnection,
  connections,
  onPinnedConnectionId,
}: Props) {
  const deleteConnection = useDeleteGrpcConnection(activeConnection?.id ?? null);
  const deleteAllConnections = useDeleteGrpcConnections(activeConnection?.requestId);
  const latestConnectionId = connections[0]?.id ?? 'n/a';

  return (
    <Dropdown
      items={[
        {
          key: 'clear-single',
          label: 'Clear Connection',
          onSelect: deleteConnection.mutate,
          disabled: connections.length === 0,
        },
        {
          key: 'clear-all',
          label: `Clear ${pluralizeCount('Connection', connections.length)}`,
          onSelect: deleteAllConnections.mutate,
          hidden: connections.length <= 1,
          disabled: connections.length === 0,
        },
        { type: 'separator', label: 'History' },
        ...connections.slice(0, 20).map((c) => ({
          key: c.id,
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
        className="ml-auto"
        size="sm"
        iconSize="md"
      />
    </Dropdown>
  );
}
