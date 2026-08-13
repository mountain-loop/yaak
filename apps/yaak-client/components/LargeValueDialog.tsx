import { formatSize } from "@yaakapp-internal/lib/formatSize";
import { Banner, Button, HStack, LoadingIcon } from "@yaakapp-internal/ui";
import type { ReactNode } from "react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { SniffedValue } from "./core/Editor/sniffValue";
import { showDialog } from "../lib/dialog";
import { decodeValue, largeValueActions } from "../lib/largeValue";
import { Dropdown } from "./core/Dropdown";
import { AudioViewer } from "./responseViewers/AudioViewer";
import { ImageViewer } from "./responseViewers/ImageViewer";
import { SvgViewer } from "./responseViewers/SvgViewer";
import { VideoViewer } from "./responseViewers/VideoViewer";

const PdfViewer = lazy(() =>
  import("./responseViewers/PdfViewer").then((m) => ({ default: m.PdfViewer })),
);

interface Props {
  /** The whole value, exactly as it reads in the document */
  text: string;
  sniffed: SniffedValue | null;
}

/**
 * Shows a value the editor collapsed, in whatever viewer its type calls for.
 *
 * The editor only ever read the value's head, so this is where it is decoded in full — on an
 * explicit click, behind a spinner, rather than during layout.
 */
export function LargeValueDialog({ text, sniffed }: Props) {
  const viewer = sniffed == null ? null : viewerFor(sniffed.mime);
  const decoded = useDecoded(text, viewer == null ? null : sniffed);

  // Nothing recognised it, so there is nothing to decode it into
  if (sniffed == null || viewer == null) {
    return (
      <PagedText text={text}>
        {sniffed != null && (
          <Banner color="info" className="mb-3">
            {sniffed.label} content cannot be previewed, so it is shown as it appears in the
            response.
          </Banner>
        )}
      </PagedText>
    );
  }

  if (decoded == null) {
    return (
      <HStack className="h-full" alignItems="center" justifyContent="center">
        <LoadingIcon />
      </HStack>
    );
  }

  if ("error" in decoded) {
    return (
      <PagedText text={text}>
        <Banner color="danger" className="mb-3">
          Failed to decode this {sniffed.label} value: {decoded.error}
        </Banner>
      </PagedText>
    );
  }

  const { bytes } = decoded;

  switch (viewer) {
    case "svg":
      return <DecodedSvg bytes={bytes} />;
    case "image":
      return (
        <div className="h-full overflow-auto flex items-center justify-center">
          <ImageViewer data={toArrayBuffer(bytes)} mimeType={sniffed.mime} />
        </div>
      );
    case "audio":
      return <AudioViewer data={bytes} mimeType={sniffed.mime} />;
    case "video":
      return <VideoViewer data={bytes} mimeType={sniffed.mime} />;
    case "pdf":
      return (
        <Suspense fallback={<LoadingIcon />}>
          <PdfViewer data={bytes} />
        </Suspense>
      );
    case "text":
      return <DecodedText bytes={bytes} />;
  }
}

/**
 * Decoding megabytes is worth doing once, not on every render — and the viewers below key their
 * blob URLs off the string, so a fresh one each time would rebuild them for nothing.
 */
function DecodedSvg({ bytes }: { bytes: Uint8Array }) {
  const text = useMemo(() => new TextDecoder().decode(bytes), [bytes]);
  return <SvgViewer text={text} />;
}

function DecodedText({ bytes }: { bytes: Uint8Array }) {
  const text = useMemo(() => new TextDecoder().decode(bytes), [bytes]);
  return <PagedText text={text} />;
}

/**
 * The same menu the tag in the editor carries, minus the one entry that would only reopen this.
 *
 * It lives in the dialog's title rather than above the content, which would cost a band of
 * whitespace the width of the dialog to hold one small button.
 */
function LargeValueActions({ text, sniffed }: Props) {
  const items = useMemo(
    () =>
      largeValueActions({
        value: () => text,
        sniffed,
        // The tag copies only what it hides; in here, what you see is the whole value
        copyText: () => text,
      }),
    [text, sniffed],
  );

  return (
    <Dropdown items={items}>
      <Button size="xs" variant="border" forDropdown>
        Actions
      </Button>
    </Dropdown>
  );
}

type Viewer = "image" | "svg" | "audio" | "video" | "pdf" | "text";

/** Which viewer a media type calls for, or null if none of them can show it. */
function viewerFor(mime: string): Viewer | null {
  if (mime.startsWith("image/svg")) return "svg";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/") || /\b(json|xml|javascript|csv)\b/.test(mime)) return "text";
  return null;
}

type Decoded = { bytes: Uint8Array } | { error: string };

/**
 * The value's bytes, once they exist.
 *
 * Decoding a few megabytes takes long enough to be seen, so it happens in an effect rather than
 * during render — the dialog paints with a spinner first, instead of opening late.
 */
function useDecoded(text: string, sniffed: SniffedValue | null): Decoded | null {
  const [decoded, setDecoded] = useState<Decoded | null>(null);

  useEffect(() => {
    if (sniffed == null) return;

    setDecoded(null);
    let cancelled = false;
    const timer = setTimeout(() => {
      let result: Decoded;
      try {
        result = { bytes: decodeValue(text, sniffed) };
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      if (!cancelled) setDecoded(result);
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, sniffed]);

  return decoded;
}

/** A copy, since a `Uint8Array` may be a view onto a larger buffer */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

/** Characters shown at once. A page this size lays out instantly once its lines are short. */
const PAGE_CHARS = 50_000;

/** Where a line is broken. The long-line cost this whole feature avoids is per line. */
const WRAP_CHARS = 120;

/**
 * The raw text, in pages of short lines.
 *
 * What is left when nothing can render the value. Handing it to an editor whole would walk
 * straight back into the layout stall that collapsed it in the first place, so it is paged and
 * hard-wrapped instead: no line is ever long, and no page is ever big.
 */
function PagedText({ text, children }: { text: string; children?: ReactNode }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(text.length / PAGE_CHARS));
  const from = page * PAGE_CHARS;
  const to = Math.min(from + PAGE_CHARS, text.length);
  const body = useMemo(() => wrap(text.slice(from, to)), [text, from, to]);

  return (
    <div className="h-full grid grid-rows-[auto_minmax(0,1fr)_auto] gap-3">
      <div>{children}</div>
      <pre className="overflow-auto font-mono text-sm text-text-subtle select-text">{body}</pre>
      <HStack space={2} alignItems="center" className="text-sm text-text-subtle">
        <span>
          {(to - from).toLocaleString()} of {text.length.toLocaleString()} characters
        </span>
        {pages > 1 && (
          <HStack space={2} alignItems="center" className="ml-auto">
            <Button
              size="xs"
              variant="border"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span>
              Page {page + 1} of {pages.toLocaleString()}
            </span>
            <Button
              size="xs"
              variant="border"
              disabled={page >= pages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </HStack>
        )}
      </HStack>
    </div>
  );
}

/** Breaks every line at {@link WRAP_CHARS}, leaving the ones already shorter alone. */
function wrap(text: string): string {
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    if (line.length <= WRAP_CHARS) {
      lines.push(line);
      continue;
    }
    for (let i = 0; i < line.length; i += WRAP_CHARS) {
      lines.push(line.slice(i, i + WRAP_CHARS));
    }
  }
  return lines.join("\n");
}

export function showLargeValueDialog({ text, sniffed }: Props) {
  showDialog({
    id: "large-value",
    size: "lg",
    className: "h-[calc(100vh-10rem)]",
    // Everything in one line: the same words the tag uses, and the same menu it carries. A
    // separate description and a row of its own for the button cost three bands to say this.
    title: (
      <HStack space={3} alignItems="center">
        <span>
          {sniffed == null ? "Hidden Value" : sniffed.label} · {formatSize(text.length)}
        </span>
        <LargeValueActions text={text} sniffed={sniffed} />
      </HStack>
    ),
    render: () => <LargeValueDialog text={text} sniffed={sniffed} />,
  });
}
