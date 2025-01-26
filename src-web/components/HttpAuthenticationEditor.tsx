import type { GrpcRequest, HttpRequest } from '@yaakapp-internal/models';
import React, { useCallback } from 'react';
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
  request: HttpRequest | GrpcRequest;
}

export function HttpAuthenticationEditor({ request }: Props) {
  const updateHttpRequest = useUpdateAnyHttpRequest();
  const updateGrpcRequest = useUpdateAnyGrpcRequest();
  const auth = useHttpAuthenticationConfig(
    request.authenticationType,
    request.authentication,
    request.id,
  );

  const handleChange = useCallback(
    (authentication: Record<string, boolean>) => {
      console.log('UPDATE', authentication);
      if (request.model === 'http_request') {
        updateHttpRequest.mutate({
          id: request.id,
          update: (r) => ({ ...r, authentication }),
        });
      } else {
        updateGrpcRequest.mutate({
          id: request.id,
          update: (r) => ({ ...r, authentication }),
        });
      }
    },
    [request.id, request.model, updateGrpcRequest, updateHttpRequest],
  );

  if (auth.data == null) {
    return <EmptyStateText>No Authentication {request.authenticationType}</EmptyStateText>;
  }

  return (
    <div className="h-full grid grid-rows-[auto_minmax(0,1fr)]">
      <HStack space={2} className="mb-1" alignItems="center">
        <Checkbox
          className="w-full"
          checked={!request.authentication.disabled}
          onChange={(disabled) => handleChange({ ...request.authentication, disabled: !disabled })}
          title="Enabled"
        />
        {auth.data.actions && (
          <Dropdown
            items={auth.data.actions.map(
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
        inputs={auth.data.args}
        data={request.authentication}
        onChange={handleChange}
      />
    </div>
  );
}
