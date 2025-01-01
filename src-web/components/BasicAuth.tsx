import { useUpdateAnyGrpcRequest } from '../hooks/useUpdateAnyGrpcRequest';
import { useUpdateAnyHttpRequest } from '../hooks/useUpdateAnyHttpRequest';
import type { GrpcRequest, HttpRequest } from '@yaakapp-internal/models';
import { Input } from './core/Input';
import { VStack } from './core/Stacks';

interface Props<T> {
  request: T;
}

export function BasicAuth<T extends HttpRequest | GrpcRequest>({ request }: Props<T>) {
  const updateHttpRequest = useUpdateAnyHttpRequest();
  const updateGrpcRequest = useUpdateAnyGrpcRequest();

  return (
    <VStack className="py-2 overflow-y-auto h-full" space={2}>
      <Input
        useTemplating
        autocompleteVariables
        stateKey={`basic.username.${request.id}`}
        forceUpdateKey={request.id}
        placeholder="username"
        label="Username"
        name="username"
        size="sm"
        defaultValue={`${request.authentication.username}`}
        onChange={(username: string) => {
          if (request.model === 'http_request') {
            updateHttpRequest.mutate({
              id: request.id,
              update: (r: HttpRequest) => ({
                ...r,
                authentication: { password: r.authentication.password, username },
              }),
            });
          } else {
            updateGrpcRequest.mutate({
              id: request.id,
              update: (r: GrpcRequest) => ({
                ...r,
                authentication: { password: r.authentication.password, username },
              }),
            });
          }
        }}
      />
      <Input
        useTemplating
        autocompleteVariables
        forceUpdateKey={request?.id}
        stateKey={`basic.password.${request.id}`}
        placeholder="password"
        label="Password"
        name="password"
        size="sm"
        type="password"
        defaultValue={`${request.authentication.password}`}
        onChange={(password: string) => {
          if (request.model === 'http_request') {
            updateHttpRequest.mutate({
              id: request.id,
              update: (r: HttpRequest) => ({
                ...r,
                authentication: { username: r.authentication.username, password },
              }),
            });
          } else {
            updateGrpcRequest.mutate({
              id: request.id,
              update: (r: GrpcRequest) => ({
                ...r,
                authentication: { username: r.authentication.username, password },
              }),
            });
          }
        }}
      />
    </VStack>
  );
}
