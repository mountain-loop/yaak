import type { HttpResponse } from '@yaakapp-internal/models';
import { useCopyHttpResponse } from '../hooks/useCopyHttpResponse';
import { useDeleteHttpResponse } from '../hooks/useDeleteHttpResponse';
import { useDeleteHttpResponses } from '../hooks/useDeleteHttpResponses';
import { useSaveResponse } from '../hooks/useSaveResponse';
import { pluralize } from '../lib/pluralize';
import { Dropdown } from './core/Dropdown';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { HStack } from './core/Stacks';
import { StatusTag } from './core/StatusTag';

interface Props {
  responses: HttpResponse[];
  activeResponse: HttpResponse;
  onPinnedResponseId: (id: string) => void;
  className?: string;
}

export const RecentResponsesDropdown = function ResponsePane({
  activeResponse,
  responses,
  onPinnedResponseId,
}: Props) {
  const deleteResponse = useDeleteHttpResponse(activeResponse?.id ?? null);
  const deleteAllResponses = useDeleteHttpResponses(activeResponse?.requestId);
  const latestResponseId = responses[0]?.id ?? 'n/a';
  const saveResponse = useSaveResponse(activeResponse);
  const copyResponse = useCopyHttpResponse(activeResponse);

  return (
    <Dropdown
      items={[
        {
          key: 'save',
          label: 'Save to File',
          onSelect: saveResponse.mutate,
          leftSlot: <Icon icon="save" />,
          hidden: responses.length === 0,
          disabled: activeResponse.state !== 'closed' && activeResponse.status >= 100,
        },
        {
          key: 'copy',
          label: 'Copy Body',
          onSelect: copyResponse.mutate,
          leftSlot: <Icon icon="copy" />,
          hidden: responses.length === 0,
          disabled: activeResponse.state !== 'closed' && activeResponse.status >= 100,
        },
        {
          key: 'clear-single',
          label: 'Delete',
          leftSlot: <Icon icon="trash" />,
          onSelect: deleteResponse.mutate,
          disabled: activeResponse.state !== 'closed',
        },
        {
          key: 'unpin',
          label: 'Unpin Response',
          onSelect: () => onPinnedResponseId(activeResponse.id),
          leftSlot: <Icon icon="unpin" />,
          hidden: latestResponseId === activeResponse.id,
          disabled: responses.length === 0,
        },
        { type: 'separator', label: 'History' },
        {
          key: 'clear-all',
          label: `Delete ${responses.length} ${pluralize('Response', responses.length)}`,
          onSelect: deleteAllResponses.mutate,
          hidden: responses.length === 0,
          disabled: responses.length === 0,
        },
        { type: 'separator' },
        ...responses.slice(0, 20).map((r: HttpResponse) => ({
          key: r.id,
          label: (
            <HStack space={2}>
              <StatusTag className="text-sm" response={r} />
              <span className="text-text-subtle">&rarr;</span>{' '}
              <span className="font-mono text-sm">{r.elapsed >= 0 ? `${r.elapsed}ms` : 'n/a'}</span>
            </HStack>
          ),
          leftSlot: activeResponse?.id === r.id ? <Icon icon="check" /> : <Icon icon="empty" />,
          onSelect: () => onPinnedResponseId(r.id),
        })),
      ]}
    >
      <IconButton
        title="Show response history"
        icon={activeResponse?.id === latestResponseId ? 'chevron_down' : 'pin'}
        className="m-0.5"
        size="sm"
        iconSize="md"
      />
    </Dropdown>
  );
};
