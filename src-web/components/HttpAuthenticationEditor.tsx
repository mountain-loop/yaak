import type { GrpcRequest, HttpRequest, WebsocketRequest } from '@yaakapp-internal/models';
import React, { useCallback } from 'react';
import { upsertWebsocketRequest } from '../commands/upsertWebsocketRequest';
import { useHttpAuthenticationConfig } from '../hooks/useHttpAuthenticationConfig';
import { useUpdateAnyGrpcRequest } from '../hooks/useUpdateAnyGrpcRequest';
import { useUpdateAnyHttpRequest } from '../hooks/useUpdateAnyHttpRequest';
import { Checkbox } from './core/Checkbox';
import type { DropdownItem } from './core/Dropdown';
import { Dropdown } from './core/Dropdown';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { HStack } from './core/Stacks';
import { DynamicForm } from './DynamicForm';
import { EmptyStateText } from './EmptyStateText';

interface Props {
  request: HttpRequest | GrpcRequest | WebsocketRequest;
}

export function HttpAuthenticationEditor({ request }: Props) {
  const updateHttpRequest = useUpdateAnyHttpRequest();
  const updateGrpcRequest = useUpdateAnyGrpcRequest();
  const authConfig = useHttpAuthenticationConfig(
    request.authenticationType,
    request.authentication,
    request.id,
  );

  const handleChange = useCallback(
    (authentication: Record<string, boolean>) => {
      if (request.model === 'http_request') {
        updateHttpRequest.mutate({
          id: request.id,
          update: (r) => ({ ...r, authentication }),
        });
      } else if (request.model === 'websocket_request') {
        upsertWebsocketRequest.mutate({ ...request, authentication });
      } else {
        updateGrpcRequest.mutate({
          id: request.id,
          update: (r) => ({ ...r, authentication }),
        });
      }
    },
    [request, updateGrpcRequest, updateHttpRequest],
  );

  if (authConfig.data == null) {
    return <EmptyStateText>No Authentication {request.authenticationType}</EmptyStateText>;
  }

  return (
    <div className="h-full grid grid-rows-[auto_minmax(0,1fr)]">
      <HStack space={2} className="mb-2" alignItems="center">
        <Checkbox
          className="w-full"
          checked={!request.authentication.disabled}
          onChange={(disabled) => handleChange({ ...request.authentication, disabled: !disabled })}
          title="Enabled"
        />
        {authConfig.data.actions && (
          <Dropdown
            items={authConfig.data.actions.map(
              (a): DropdownItem => ({
                label: a.label,
                leftSlot: a.icon ? <Icon icon={a.icon} /> : null,
                onSelect: () => a.call(request),
              }),
            )}
          >
            <IconButton title="Authentication Actions" icon="settings" size="xs" />
          </Dropdown>
        )}
      </HStack>
      <DynamicForm
        disabled={request.authentication.disabled}
        autocompleteVariables
        useTemplating
        stateKey={`auth.${request.id}.${request.authenticationType}`}
        inputs={authConfig.data.args}
        data={request.authentication}
        onChange={handleChange}
      />
    </div>
  );
}
