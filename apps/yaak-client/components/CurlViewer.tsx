import { useQuery } from "@tanstack/react-query";
import type { HttpRequest } from "@yaakapp-internal/models";
import type { CSSProperties } from "react";
import { requestToCurl } from "../lib/curl";
import { CopyIconButton } from "./CopyIconButton";
import { Editor } from "./core/Editor/LazyEditor";

interface Props {
  request: HttpRequest;
  style?: CSSProperties;
}

export function CurlViewer({ request, style }: Props) {
  const curl = useQuery({
    queryKey: ["request_curl", request.id, request.updatedAt],
    queryFn: () => requestToCurl(request, "send"),
  });

  const value = curl.data ?? "";

  return (
    <div
      style={style}
      className="x-theme-responsePane relative h-full max-h-full min-w-0 overflow-hidden rounded-md border border-border-subtle bg-surface"
    >
      {curl.isError ? (
        <div className="p-3 text-sm text-danger">Failed to render curl command.</div>
      ) : (
        <>
          <div className="absolute inset-0">
            <Editor
              readOnly
              forceUpdateKey={value}
              stateKey={`curl.${request.id}`}
              defaultValue={curl.isPending ? "Rendering curl..." : value}
              language="shell"
              heightMode="full"
              wrapLines
            />
          </div>
          <div className="pointer-events-none absolute right-2 top-2 z-20">
            <CopyIconButton
              text={value}
              size="xs"
              title="Copy Curl command"
              disabled={!value}
              className="pointer-events-auto bg-surface/80 opacity-75 shadow-sm backdrop-blur-sm hover:!opacity-100 focus-visible:!opacity-100"
            />
          </div>
        </>
      )}
    </div>
  );
}
