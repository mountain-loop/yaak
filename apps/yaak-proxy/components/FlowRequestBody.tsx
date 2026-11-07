import { formatSize } from "@yaakapp-internal/lib/formatSize";
import { Banner, EmptyStateText, LoadingIcon } from "@yaakapp-internal/ui";
import type { HttpBodyResult } from "@yaakapp-internal/ui/httpTypes";
import type { ReactNode } from "react";
import type { FlowBodyData } from "../lib/flowViews";

interface Props {
  /** The request body as the engine's body RPC returned it */
  body: HttpBodyResult<FlowBodyData | null>;
  /** The shared editor for the body's type */
  editor: ReactNode;
  /** The proxy's own viewer, for a body that isn't text; null for one that is */
  binaryViewer: ReactNode | null;
  /** Bytes of the request body on the wire */
  requestSize: number;
}

/**
 * The request half's Body tab: the body in its editor, or why it isn't there yet. A body that
 * failed to load says why, as the response's viewer does, rather than reading as no body.
 */
export function FlowRequestBody({ body, editor, binaryViewer, requestSize }: Props) {
  if (body.error != null) {
    return (
      <Banner color="danger" className="text-sm">
        {body.error.message}
      </Banner>
    );
  }
  if (body.isLoading) {
    return (
      <EmptyStateText>
        <LoadingIcon />
      </EmptyStateText>
    );
  }
  if (binaryViewer != null) return binaryViewer;
  if (body.data?.truncated) {
    return (
      <div className="h-full grid grid-rows-[auto_minmax(0,1fr)]">
        <Banner color="notice" className="text-sm mb-2">
          <span title="The app sent all of it">
            First {formatSize(body.data.storedSize)} of {formatSize(requestSize)} kept
          </span>
        </Banner>
        <div className="min-h-0">{editor}</div>
      </div>
    );
  }
  return editor;
}
