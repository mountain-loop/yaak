import type { GrpcRequest, HttpRequest } from '@yaakapp-internal/models';
import React, { useCallback } from 'react';
import { useHttpAuthenticationConfig } from '../hooks/useHttpAuthenticationConfig';
import { useUpdateAnyGrpcRequest } from '../hooks/useUpdateAnyGrpcRequest';
import { useUpdateAnyHttpRequest } from '../hooks/useUpdateAnyHttpRequest';
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
    <DynamicForm
      autocompleteVariables
      useTemplating
      stateKey={`auth.${request.id}.${request.authenticationType}`}
      inputs={auth.data.args}
      data={request.authentication}
      onChange={handleChange}
    />
  );
}
