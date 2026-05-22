export interface SseSummary {
  fragmentCount: number;
  summary: string;
}

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

    if (looksLikeJson(trimmedBlock) && isParsableJson(trimmedBlock)) {
      candidates.push(trimmedBlock);
      continue;
    }

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (
        !trimmedLine ||
        trimmedLine.startsWith(":") ||
        STANDARD_SSE_FIELD.test(trimmedLine) ||
        !looksLikeJson(trimmedLine)
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }

    const fragment = stringifySummaryValue(extractValueAtPath(parsed, keyPath));
    if (fragment != null) {
      fragments.push(fragment);
    }
  }

  return {
    fragmentCount: fragments.length,
    summary: fragments.join(""),
  };
}

function extractValueAtPath(value: unknown, keyPath: string): unknown {
  const segments = parseResultPath(keyPath);

  if (segments == null) {
    return undefined;
  }
  if (segments.length === 0) {
    return value;
  }

  let current = value;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    if (
      current == null ||
      typeof current !== "object" ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function parseResultPath(keyPath: string): string[] | null {
  let path = keyPath.trim();
  if (!path) {
    return null;
  }

  if (path === "$") {
    return [];
  }

  if (path.startsWith("$")) {
    path = path.slice(1);
    if (path.startsWith(".")) {
      path = path.slice(1);
    } else if (!path.startsWith("[")) {
      return null;
    }
  }

  const segments: string[] = [];
  let index = 0;

  while (index < path.length) {
    const char = path[index];

    if (char === ".") {
      index += 1;
      continue;
    }

    if (char === "[") {
      const end = path.indexOf("]", index + 1);
      if (end < 0) {
        return null;
      }

      const segment = parseBracketSegment(path.slice(index + 1, end));
      if (!segment) {
        return null;
      }
      segments.push(segment);
      index = end + 1;
      continue;
    }

    const nextDot = path.indexOf(".", index);
    const nextBracket = path.indexOf("[", index);
    const endCandidates = [nextDot, nextBracket].filter((i) => i >= 0);
    const end = endCandidates.length > 0 ? Math.min(...endCandidates) : path.length;
    const segment = path.slice(index, end).trim();
    if (!segment) {
      return null;
    }
    segments.push(segment);
    index = end;
  }

  return segments.length > 0 ? segments : null;
}

function parseBracketSegment(segment: string): string | null {
  const trimmed = segment.trim();
  if (!trimmed) {
    return null;
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
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

function looksLikeJson(value: string): boolean {
  return /^[{["0-9tfn-]/.test(value);
}

function isParsableJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}
