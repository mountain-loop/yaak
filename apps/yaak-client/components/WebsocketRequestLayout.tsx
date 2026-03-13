import type { WebsocketRequest } from "@yaakapp-internal/models";
import classNames from "classnames";
import { useAtomValue } from "jotai";
import type { CSSProperties } from "react";

import { SplitLayout } from "@yaakapp-internal/ui";
import { activeWorkspaceAtom } from "../hooks/useActiveWorkspace";
import { workspaceLayoutAtom } from "../lib/atoms";
import { WebsocketRequestPane } from "./WebsocketRequestPane";
import { WebsocketResponsePane } from "./WebsocketResponsePane";

interface Props {
  activeRequest: WebsocketRequest;
  style: CSSProperties;
}

export function WebsocketRequestLayout({ activeRequest, style }: Props) {
  const workspaceLayout = useAtomValue(workspaceLayoutAtom);
  const activeWorkspace = useAtomValue(activeWorkspaceAtom);
  const wsId = activeWorkspace?.id ?? "n/a";
  return (
    <SplitLayout
      storageKey={`websocket_layout::${wsId}`}
      className="p-3 gap-1.5"
      layout={workspaceLayout}
      style={style}
      firstSlot={({ orientation, style }) => (
        <WebsocketRequestPane
          style={style}
          activeRequest={activeRequest}
          fullHeight={orientation === "horizontal"}
        />
      )}
      secondSlot={({ style }) => (
        <div
          style={style}
          className={classNames(
            "x-theme-responsePane",
            "max-h-full h-full grid grid-rows-[minmax(0,1fr)] grid-cols-1",
            "bg-surface rounded-md border border-border-subtle",
            "shadow relative",
          )}
        >
          <WebsocketResponsePane activeRequest={activeRequest} />
        </div>
      )}
    />
  );
}
