import type { ReactNode } from "react";
import { useMemo } from "react";
import type { UseStoredValue } from "../hooks/useStoredValue";
import { CountBadge } from "./CountBadge";
import { DetailsBanner } from "./DetailsBanner";
import { KeyValueRow, type KeyValueRowProps, KeyValueRows } from "./KeyValueRow";

export interface HeadersTableProps {
  title: ReactNode;
  headers: { name: string; value: string }[];
  labelColor?: KeyValueRowProps["labelColor"];
  defaultOpen?: boolean;
  storageKey?: string;
  useStoredValue?: UseStoredValue;
}

export function HeadersTable({
  title,
  headers,
  labelColor,
  defaultOpen,
  storageKey,
  useStoredValue,
}: HeadersTableProps) {
  const sortedHeaders = useMemo(
    () =>
      [...headers].sort((a, b) =>
        a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()),
      ),
    [headers],
  );

  return (
    <DetailsBanner
      defaultOpen={defaultOpen}
      storageKey={storageKey}
      useStoredValue={useStoredValue}
      summary={
        <h2 className="flex items-center">
          {title} <CountBadge showZero count={sortedHeaders.length} />
        </h2>
      }
    >
      {sortedHeaders.length === 0 ? (
        <span className="text-text-subtlest text-sm italic">No Headers</span>
      ) : (
        <KeyValueRows>
          {sortedHeaders.map((h, i) => (
            // oxlint-disable-next-line react/no-array-index-key
            <KeyValueRow labelColor={labelColor} key={i} label={h.name}>
              {h.value}
            </KeyValueRow>
          ))}
        </KeyValueRows>
      )}
    </DetailsBanner>
  );
}
