import { HStack } from "@yaakapp-internal/ui";
import { useState } from "react";
import { showDialog } from "../lib/dialog";
import { CopyButton } from "./CopyButton";
import { IconButton } from "./core/IconButton";

/**
 * How much of the value to render at once. Rendering the whole thing would hit exactly the
 * layout cost this dialog exists to avoid, so it pages instead.
 */
const PAGE_CHARS = 20_000;

interface Props {
  value: string;
}

export function LargeValueDialog({ value }: Props) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(value.length / PAGE_CHARS));
  const start = page * PAGE_CHARS;
  const slice = value.slice(start, start + PAGE_CHARS);

  return (
    <div className="grid grid-rows-[auto_minmax(0,1fr)] gap-3 h-full">
      <HStack space={2} className="flex-wrap">
        <span className="text-text-subtle text-sm tabular-nums">
          {value.length.toLocaleString()} characters
        </span>
        {pageCount > 1 && (
          <HStack space={1} alignItems="center">
            <IconButton
              size="sm"
              variant="border"
              icon="chevron_left"
              title="Previous page"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            />
            <span className="text-text-subtle text-sm tabular-nums">
              {page + 1} / {pageCount}
            </span>
            <IconButton
              size="sm"
              variant="border"
              icon="chevron_right"
              title="Next page"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            />
          </HStack>
        )}
        <div className="ml-auto">
          <CopyButton size="xs" variant="border" color="secondary" text={value} />
        </div>
      </HStack>
      <div className="overflow-auto bg-surface-highlight rounded-md p-3">
        <div className="font-mono text-sm whitespace-pre-wrap break-all select-auto">{slice}</div>
      </div>
    </div>
  );
}

LargeValueDialog.show = (value: string) => {
  showDialog({
    id: "large-value",
    title: "Large Value",
    size: "lg",
    className: "h-[calc(100vh-10rem)] max-h-200!",
    render: () => <LargeValueDialog value={value} />,
  });
};
