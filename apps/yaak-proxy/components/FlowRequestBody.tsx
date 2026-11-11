import { formatSize } from "@yaakapp-internal/lib/formatSize";
import { Banner, EmptyStateText, IconTooltip, LoadingIcon } from "@yaakapp-internal/ui";
import type { HttpBodyResult } from "@yaakapp-internal/ui/httpTypes";
import type { ReactNode } from "react";
import type { FlowBodyData } from "../lib/flowViews";

interface Props {
  /** The request body as the engine's body RPC returned it */
  body: HttpBodyResult<FlowBodyData | null>;
  /** The body in the viewer for its type, formatted or raw */
  viewer: ReactNode;
  /** Bytes of the request body on the wire */
  requestSize: number;
}

/**
 * The request half's Body tab: the body in its viewer, or why it isn't there yet. A body that
 * failed to load says why, as the response's viewer does, rather than reading as no body.
 */
export function FlowRequestBody({ body, viewer, requestSize }: Props) {
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
  if (body.data?.truncated) {
    return (
      <div className="h-full grid grid-rows-[auto_minmax(0,1fr)]">
        <Banner color="notice" className="text-sm mb-2">
          <span className="flex items-center gap-1.5">
            The first {formatSize(body.data.storedSize)} of {formatSize(requestSize)} is shown.
            <IconTooltip
              iconSize="sm"
              content="The body was truncated at the capture limit. The app sent all of it."
            />
          </span>
        </Banner>
        <div className="min-h-0">{viewer}</div>
      </div>
    );
  }
  return viewer;
}
