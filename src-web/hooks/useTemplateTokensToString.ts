import { useQuery } from '@tanstack/react-query';
import type { Tokens } from '@yaakapp-internal/templates';
import { invokeCmd } from '../lib/tauri';

export function useTemplateTokensToString(tokens: Tokens) {
  return useQuery<string>({
    placeholderData: (prev) => prev, // Keep previous data on refetch
    queryKey: ['template_tokens_to_string', tokens],
    queryFn: () => templateTokensToString(tokens),
  });
}

export async function templateTokensToString(tokens: Tokens): Promise<string> {
  return invokeCmd('cmd_template_tokens_to_string', { tokens });
}
