import { useQuery } from '@tanstack/react-query';
import type {
  Folder,
  GrpcRequest,
  HttpRequest,
  WebsocketRequest,
  Workspace,
} from '@yaakapp-internal/models';
import { httpResponsesAtom } from '@yaakapp-internal/models';
import type { GetTemplateFunctionConfigResponse, JsonPrimitive } from '@yaakapp-internal/plugins';
import { useAtomValue } from 'jotai';
import { md5 } from 'js-md5';
import { invokeCmd } from '../lib/tauri';
import { activeEnvironmentIdAtom } from './useActiveEnvironment';
import { activeWorkspaceIdAtom } from './useActiveWorkspace';

export function useTemplateFunctionConfig(
  functionName: string | null,
  values: Record<string, JsonPrimitive>,
  model: HttpRequest | GrpcRequest | WebsocketRequest | Folder | Workspace,
) {
  const workspaceId = useAtomValue(activeWorkspaceIdAtom);
  const environmentId = useAtomValue(activeEnvironmentIdAtom);
  const responses = useAtomValue(httpResponsesAtom);

  // Some auth handlers like OAuth 2.0 show the current token after a successful request. To
  // handle that, we'll force the auth to re-fetch after each new response closes
  const responseKey = md5(
    responses
      .filter((r) => r.state === 'closed')
      .map((r) => r.id)
      .join(':'),
  );

  return useQuery({
    queryKey: [
      'template_function_config',
      model,
      functionName,
      values,
      responseKey,
      workspaceId,
      environmentId,
    ],
    placeholderData: (prev) => prev, // Keep previous data on refetch
    queryFn: async () => {
      if (functionName == null) return null;
      const config = await invokeCmd<GetTemplateFunctionConfigResponse>(
        'cmd_template_function_config',
        {
          functionName: functionName,
          values,
          model,
          environmentId,
        },
      );
      return config.function;
    },
  });
}
