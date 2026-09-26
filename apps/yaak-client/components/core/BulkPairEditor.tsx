import { useCallback, useMemo } from "react";
import { generateId } from "../../lib/generateId";
import { Editor } from "./Editor/LazyEditor";
import type { Pair, PairEditorProps, PairWithId } from "./PairEditor";

type Props = PairEditorProps;

export function BulkPairEditor({
  pairs,
  onChange,
  namePlaceholder,
  valuePlaceholder,
  forceUpdateKey,
  forcedEnvironmentId,
  stateKey,
}: Props) {
  const pairsText = useMemo(() => formatBulkPairs(pairs), [pairs]);

  const handleChange = useCallback(
    (text: string) => {
      onChange(parseBulkPairs(text));
    },
    [onChange],
  );

  return (
    <Editor
      autocompleteFunctions
      autocompleteVariables
      stateKey={`bulk_pair.${stateKey}`}
      forcedEnvironmentId={forcedEnvironmentId}
      forceUpdateKey={forceUpdateKey}
      placeholder={`${namePlaceholder ?? "name"}: ${valuePlaceholder ?? "value"}`}
      defaultValue={pairsText}
      language="pairs"
      onChange={handleChange}
    />
  );
}

export function formatBulkPairs(pairs: Pair[]): string {
  return pairs
    .filter((p) => !(p.name.trim() === "" && p.value.trim() === ""))
    .map(formatBulkPairLine)
    .join("\n");
}

export function parseBulkPairs(text: string): PairWithId[] {
  return text
    .split("\n")
    .filter((l: string) => l.trim())
    .map(parseBulkPairLine)
    .filter((p) => p != null);
}

/**
 * Format a pair as a `name: value` line. Disabled pairs are commented out dotenv-style, as
 * `# name: value`, so the enabled state survives a round trip through {@link parseBulkPairLine}.
 */
export function formatBulkPairLine(pair: Pair) {
  const value = pair.value.replaceAll("\n", "\\n");
  const line = `${pair.name}: ${value}`;
  return pair.enabled === false ? `# ${line}` : line;
}

const PAIR_REGEX = /^([^:]+):\s+(.*)$/;
// A # only marks a comment when followed by whitespace (or nothing), so `#foo: bar` stays an
// enabled pair named `#foo`
const COMMENT_PREFIX_REGEX = /^\s*#(?:\s+|$)/;

/**
 * Parse a `name: value` line into an enabled pair. A line starting with `# ` is a disabled pair
 * if the rest of it parses as `name: value`, otherwise it's a free-text comment and `null` is
 * returned so it can be dropped.
 */
export function parseBulkPairLine(line: string): PairWithId | null {
  const commentPrefix = line.match(COMMENT_PREFIX_REGEX);
  if (commentPrefix != null) {
    const uncommented = line.slice(commentPrefix[0].length);
    if (!PAIR_REGEX.test(uncommented)) return null;
    return { ...parsePairLine(uncommented), enabled: false };
  }

  return parsePairLine(line);
}

function parsePairLine(line: string): PairWithId {
  const [, name, value] = line.match(PAIR_REGEX) ?? [];
  return {
    enabled: true,
    name: (name ?? line).trim(),
    value: (value ?? "").replaceAll("\\n", "\n").trim(),
    id: generateId(),
  };
}
