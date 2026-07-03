import type { HttpResponse } from "@yaakapp-internal/models";
import type { GenericCompletionOption } from "@yaakapp-internal/plugins";
import { useMemo } from "react";
import type { GenericCompletionConfig } from "../components/core/Editor/genericCompletion";
import { useKeyValue } from "./useKeyValue";

const OPENAI_CHAT_COMPLETIONS_RESULT_KEY_PATH = "$.choices[0].delta.content";
const OPENAI_RESPONSES_RESULT_KEY_PATH = "$.delta";
const ANTHROPIC_RESULT_KEY_PATH = "$.delta.text";
const GOOGLE_RESULT_KEY_PATH = "$.candidates[0].content.parts[0].text";

const sseSummaryResultKeyPathOptions: GenericCompletionOption[] = [
  {
    label: OPENAI_CHAT_COMPLETIONS_RESULT_KEY_PATH,
    detail: "ChatGPT (OpenAI)",
    type: "constant",
    boost: 1,
  },
  {
    label: OPENAI_RESPONSES_RESULT_KEY_PATH,
    detail: "Responses (OpenAI)",
    type: "constant",
    boost: 1,
  },
  {
    label: ANTHROPIC_RESULT_KEY_PATH,
    detail: "Claude (Anthropic)",
    type: "constant",
    boost: 1,
  },
  {
    label: GOOGLE_RESULT_KEY_PATH,
    detail: "Gemini (Google)",
    type: "constant",
    boost: 1,
  },
];

export const sseSummaryResultKeyPathAutocomplete: GenericCompletionConfig = {
  minMatch: 0,
  options: sseSummaryResultKeyPathOptions,
};

export function useSseSummaryResultKeyPath({ response }: { response: HttpResponse }) {
  const storedResultKeyPath = useKeyValue<string | null>({
    namespace: "no_sync",
    key: ["sse_summary_result_key_path", response.requestId],
    fallback: null,
  });
  const enabled = useKeyValue<boolean | null>({
    namespace: "no_sync",
    key: ["sse_summary_result_key_path_enabled", response.requestId],
    fallback: null,
  });
  const inferredResultKeyPath = useMemo(() => inferSseSummaryResultKeyPath(response), [response.url]);
  const resultKeyPath = storedResultKeyPath.value ?? inferredResultKeyPath;
  const trimmedResultKeyPath = resultKeyPath?.trim() ?? "";
  const isEnabled = enabled.value ?? inferredResultKeyPath != null;

  return {
    enabled: isEnabled,
    inferredResultKeyPath,
    resultKeyPath: isEnabled && trimmedResultKeyPath.length > 0 ? trimmedResultKeyPath : null,
    resultKeyPathInputValue: resultKeyPath ?? "",
    setEnabled: enabled.set,
    setResultKeyPath: storedResultKeyPath.set,
  };
}

function inferSseSummaryResultKeyPath(response: HttpResponse): string | null {
  let url: URL;
  try {
    url = new URL(response.url);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();

  if (hostname === "api.openai.com" && pathname === "/v1/chat/completions") {
    return OPENAI_CHAT_COMPLETIONS_RESULT_KEY_PATH;
  }
  if (hostname === "api.openai.com" && pathname === "/v1/responses") {
    return OPENAI_RESPONSES_RESULT_KEY_PATH;
  }
  if (hostname === "api.anthropic.com" && pathname === "/v1/messages") {
    return ANTHROPIC_RESULT_KEY_PATH;
  }
  if (
    hostname === "generativelanguage.googleapis.com" &&
    pathname.includes(":streamgeneratecontent")
  ) {
    return GOOGLE_RESULT_KEY_PATH;
  }

  return null;
}
