import type { GrpcRequest, HttpRequest } from '@yaakapp-internal/models';
import React, { useCallback } from 'react';
import { useHttpAuthentication } from '../hooks/useHttpAuthentication';
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
  const auths = useHttpAuthentication();
  const auth = auths.find((a) => a.pluginName === request.authenticationType);

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

  if (auth == null) {
    return <EmptyStateText>No Authentication {request.authenticationType}</EmptyStateText>;
  }

  return (
    <DynamicForm
      stateKey={`auth.${request.id}.${request.authenticationType}`}
      config={auth.config}
      data={request.authentication}
      onChange={handleChange}
    />
  );
}
