import type { Folder, GrpcRequest, HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';
import { foldersAtom } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import type { CSSProperties } from 'react';
import { useCallback, useMemo } from 'react';
import { allRequestsAtom } from '../hooks/useAllRequests';
import { useLatestHttpResponse } from '../hooks/useLatestHttpResponse';
import { sendAnyHttpRequest } from '../hooks/useSendAnyHttpRequest';
import { showDialog } from '../lib/dialog';
import { resolvedModelName } from '../lib/resolvedModelName';
import { router } from '../lib/router';
import { Button } from './core/Button';
import { Heading } from './core/Heading';
import { HttpResponseDurationTag } from './core/HttpResponseDurationTag';
import { HttpStatusTag } from './core/HttpStatusTag';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { LoadingIcon } from './core/LoadingIcon';
import { Separator } from './core/Separator';
import { SizeTag } from './core/SizeTag';
import { HStack } from './core/Stacks';
import { HttpResponsePane } from './HttpResponsePane';

interface Props {
  folder: Folder;
  style: CSSProperties;
}

export function FolderLayout({ folder, style }: Props) {
  const folders = useAtomValue(foldersAtom);
  const requests = useAtomValue(allRequestsAtom);
  const children = useMemo(() => {
    return [
      ...folders.filter((f) => f.folderId === folder.id),
      ...requests.filter((r) => r.folderId === folder.id),
    ];
  }, [folder.id, folders, requests]);

  return (
    <div style={style} className="p-6 pt-4 overflow-y-auto @container">
      <HStack space={2} alignItems="center">
        <Icon icon="folder" size="xl" color="secondary" />
        <Heading level={1}>{resolvedModelName(folder)}</Heading>
        <HStack className="ml-auto" alignItems="center">
          <Button rightSlot={<Icon icon="send_horizontal" />} color="secondary" size="sm" variant="border">Send All</Button>
        </HStack>
      </HStack>
      <Separator className="mt-3 mb-8" />
      <div className="grid grid-cols-1 @lg:grid-cols-2 @4xl:grid-cols-3 gap-4 min-w-0">
        {children.map((child) => (
          <ChildCard key={child.id} child={child} />
        ))}
      </div>
    </div>
  );
}

function ChildCard({ child }: { child: Folder | HttpRequest | GrpcRequest | WebsocketRequest }) {
  let card;
  if (child.model === 'folder') {
    card = <FolderCard folder={child} />;
  } else if (child.model === 'http_request') {
    card = <HttpRequestCard request={child} />;
  } else if (child.model === 'grpc_request') {
    card = <RequestCard request={child} />;
  } else if (child.model === 'websocket_request') {
    card = <RequestCard request={child} />;
  } else {
    card = <div>Unknown model {child['model']}</div>;
  }

  const navigate = useCallback(async () => {
    await router.navigate({
      to: '/workspaces/$workspaceId',
      params: { workspaceId: child.workspaceId },
      search: (prev) => ({ ...prev, request_id: child.id }),
    });
  }, [child.id, child.workspaceId]);

  return (
    <div
      className={classNames(
        'rounded-lg bg-surface-highlight p-3 pt-1 border border-border',
        'flex flex-col gap-3',
      )}
    >
      <HStack space={2}>
        {child.model === 'folder' && <Icon icon="folder" size="lg" />}
        <Heading className="truncate" level={2}>
          {resolvedModelName(child)}
        </Heading>
        <HStack space={0.5} className="ml-auto -mr-1.5">
          <IconButton
            color="custom"
            title="Send Request"
            size="sm"
            icon="external_link"
            className="opacity-70 hover:opacity-100"
            onClick={navigate}
          />
          <IconButton
            color="custom"
            title="Send Request"
            size="sm"
            icon="send_horizontal"
            className="opacity-70 hover:opacity-100"
            onClick={() => {
              sendAnyHttpRequest.mutate(child.id);
            }}
          />
        </HStack>
      </HStack>
      <div className="text-text-subtle">{card}</div>
    </div>
  );
}

function FolderCard({ folder }: { folder: Folder }) {
  return (
    <div>
      <Button
        color="primary"
        onClick={async () => {
          await router.navigate({
            to: '/workspaces/$workspaceId',
            params: { workspaceId: folder.workspaceId },
            search: (prev) => {
              return { ...prev, request_id: null, folder_id: folder.id };
            },
          });
        }}
      >
        Open
      </Button>
    </div>
  );
}

function RequestCard({ request }: { request: HttpRequest | GrpcRequest | WebsocketRequest }) {
  return <div>TODO {request.id}</div>;
}

function HttpRequestCard({ request }: { request: HttpRequest }) {
  const latestResponse = useLatestHttpResponse(request.id);

  return (
    <div className="grid grid-rows-2 grid-cols-[minmax(0,1fr)] gap-2 overflow-hidden">
      <code className="font-mono text-editor text-info border border-info rounded px-2.5 py-0.5 truncate w-full min-w-0">
        {request.method} {request.url}
      </code>
      {latestResponse ? (
        <button
          className="block mr-auto"
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            showDialog({
              id: 'response-preview',
              title: 'Response Preview',
              size: 'md',
              className: 'h-full',
              render: () => {
                return <HttpResponsePane activeRequestId={request.id} />;
              },
            });
          }}
        >
          <HStack
            space={2}
            alignItems="center"
            className={classNames(
              'cursor-default select-none',
              'whitespace-nowrap w-full pl-3 overflow-x-auto font-mono text-sm hide-scrollbars',
              'font-mono text-editor border rounded px-1.5 py-0.5 truncate w-full',
            )}
          >
            {latestResponse.state !== 'closed' && <LoadingIcon size="sm" />}
            <HttpStatusTag showReason response={latestResponse} />
            <span>&bull;</span>
            <HttpResponseDurationTag response={latestResponse} />
            <span>&bull;</span>
            <SizeTag contentLength={latestResponse.contentLength ?? 0} />
          </HStack>
        </button>
      ) : (
        <div>No Responses</div>
      )}
    </div>
  );
}
