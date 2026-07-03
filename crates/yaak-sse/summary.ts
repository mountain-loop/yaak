import { JSONPath } from "jsonpath-plus";

export interface SseSummary {
  fragmentCount: number;
  summary: string;
}

type JSONPathJson = null | boolean | number | string | object | unknown[];

const STANDARD_SSE_FIELD = /^(event|id|retry):/i;

export function candidateJsonPayloadsFromSseText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n{2,}/);
  const candidates: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    const dataLines = lines
      .map((line) => {
        const match = /^data:(?: ?)(.*)$/.exec(line);
        return match?.[1];
      })
      .filter((line): line is string => line != null);

    if (dataLines.length > 0) {
      const payload = dataLines.join("\n").trim();
      if (payload) {
        candidates.push(payload);
      }
      continue;
    }

    const trimmedBlock = block.trim();
    if (!trimmedBlock) {
      continue;
    }

    if (isParsableJson(trimmedBlock)) {
      candidates.push(trimmedBlock);
      continue;
    }

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (
        !trimmedLine ||
        trimmedLine.startsWith(":") ||
        STANDARD_SSE_FIELD.test(trimmedLine) ||
        !isParsableJson(trimmedLine)
      ) {
        continue;
      }
      candidates.push(trimmedLine);
    }
  }

  return candidates;
}

export function computeSseSummary(text: string, keyPath: string): SseSummary {
  const fragments: string[] = [];

  for (const payload of candidateJsonPayloadsFromSseText(text)) {
    const fragment = extractSseValueAtPath(payload, keyPath);
    if (fragment != null) {
      fragments.push(fragment);
    }
  }

  return {
    fragmentCount: fragments.length,
    summary: fragments.join(""),
  };
}

export function extractSseValueAtPath(payload: string, keyPath: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  const path = keyPath.trim();
  if (!path) {
    return null;
  }

  let result: unknown;
  try {
    result = JSONPath({ path, json: parsed as JSONPathJson });
  } catch {
    return null;
  }

  if (Array.isArray(result)) {
    const fragments = result
      .map((item) => stringifySummaryValue(item))
      .filter((item): item is string => item != null);
    return fragments.length > 0 ? fragments.join("") : null;
  }

  return stringifySummaryValue(result);
}

function stringifySummaryValue(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function isParsableJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}
