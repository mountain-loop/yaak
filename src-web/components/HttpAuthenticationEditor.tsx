import type { GrpcRequest, HttpRequest } from '@yaakapp-internal/models';
import React, { useCallback } from 'react';
import { useHttpAuthenticationConfig } from '../hooks/useHttpAuthenticationConfig';
import { useUpdateAnyGrpcRequest } from '../hooks/useUpdateAnyGrpcRequest';
import { useUpdateAnyHttpRequest } from '../hooks/useUpdateAnyHttpRequest';
import { Checkbox } from './core/Checkbox';
import { IconButton } from './core/IconButton';
import { HStack, VStack } from './core/Stacks';
import { DynamicForm } from './DynamicForm';
import { EmptyStateText } from './EmptyStateText';
import { Dropdown } from './core/Dropdown';

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
    <VStack space={2}>
      <HStack space={2} className="mb-1" alignItems="center">
        <Checkbox
          className="w-full"
          checked={!request.authentication.disabled}
          onChange={(disabled) => handleChange({ ...request.authentication, disabled: !disabled })}
          title="Enabled"
        />
        <Dropdown
          items={[
            {
              key: '',
              label: 'hello',
              onSelect: () => {},
            },
          ]}
        >
          <IconButton title="Authentication Actions" icon="settings" size="xs">
            Action
          </IconButton>
        </Dropdown>
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
    </VStack>
  );
}
