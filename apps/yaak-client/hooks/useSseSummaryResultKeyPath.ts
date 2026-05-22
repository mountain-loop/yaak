import { useLocalStorage } from "react-use";
import { useKeyValue } from "./useKeyValue";

export const sseSummaryProviderOptions = [
  {
    label: "ChatGPT (OpenAI)",
    resultKeyPath: "$.choices[0].delta.content",
    value: "openai",
  },
  {
    label: "Claude (Anthropic)",
    resultKeyPath: "$.delta.text",
    value: "anthropic",
  },
  {
    label: "Gemini (Google)",
    resultKeyPath: "$.candidates[0].content.parts[0].text",
    value: "google",
  },
  {
    label: "Custom",
    resultKeyPath: null,
    value: "custom",
  },
] as const;

export type SseSummaryProvider = (typeof sseSummaryProviderOptions)[number]["value"];

const DEFAULT_SSE_SUMMARY_PROVIDER = "openai";
const DEFAULT_CUSTOM_SSE_SUMMARY_RESULT_KEY_PATH = "result";

export function useSseSummaryResultKeyPath({
  requestId,
  workspaceId,
}: {
  requestId?: string;
  workspaceId?: string;
}) {
  const [rawProvider, setProvider] = useLocalStorage<SseSummaryProvider>(
    `sse_summary_provider::${requestId}`,
    DEFAULT_SSE_SUMMARY_PROVIDER,
  );
  const customKeyPath = useKeyValue<string>({
    key: ["sse_summary_custom_result_key_path", workspaceId ?? "n/a"],
    fallback: DEFAULT_CUSTOM_SSE_SUMMARY_RESULT_KEY_PATH,
  });
  const provider = isSseSummaryProvider(rawProvider) ? rawProvider : DEFAULT_SSE_SUMMARY_PROVIDER;
  const preset = sseSummaryProviderOptions.find((option) => option.value === provider);
  const resultKeyPath =
    preset?.resultKeyPath ?? customKeyPath.value ?? DEFAULT_CUSTOM_SSE_SUMMARY_RESULT_KEY_PATH;

  return {
    customResultKeyPath: customKeyPath.value ?? DEFAULT_CUSTOM_SSE_SUMMARY_RESULT_KEY_PATH,
    isLoading: customKeyPath.isLoading,
    provider,
    resultKeyPath,
    setCustomResultKeyPath: customKeyPath.set,
    setProvider,
  };
}

function isSseSummaryProvider(value: unknown): value is SseSummaryProvider {
  return sseSummaryProviderOptions.some((option) => option.value === value);
}
