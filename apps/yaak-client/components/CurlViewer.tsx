import { useQuery } from "@tanstack/react-query";
import type { HttpRequest } from "@yaakapp-internal/models";
import { Icon } from "@yaakapp-internal/ui";
import type { CSSProperties } from "react";
import { copyToClipboard } from "../lib/copy";
import { requestToCurl } from "../lib/curl";
import { hideCurlPanel } from "../lib/curlPanel";
import { Button } from "./core/Button";
import { Editor } from "./core/Editor/LazyEditor";
import { IconButton } from "./core/IconButton";

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
    <div style={style} className="h-full min-w-0 grid grid-rows-[auto_minmax(0,1fr)] bg-surface">
      <div className="h-9 flex items-center gap-1.5 border-b border-border-subtle pl-3 pr-1.5">
        <Icon icon="square_terminal" size="sm" className="text-text-subtle" />
        <div className="text-sm font-medium truncate">Curl</div>
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="xs"
            variant="border"
            leftSlot={<Icon icon="copy" />}
            disabled={!value}
            onClick={() => copyToClipboard(value)}
          >
            Copy
          </Button>
          <IconButton size="xs" icon="x" title="Close Curl panel" onClick={hideCurlPanel} />
        </div>
      </div>
      {curl.isError ? (
        <div className="p-3 text-sm text-danger">Failed to render curl command.</div>
      ) : (
        <Editor
          readOnly
          forceUpdateKey={value}
          stateKey={`curl.${request.id}`}
          defaultValue={curl.isPending ? "Rendering curl..." : value}
          language="shell"
          heightMode="full"
          wrapLines
        />
      )}
    </div>
  );
}
