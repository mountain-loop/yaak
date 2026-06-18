import type { HttpRequest } from "@yaakapp-internal/models";
import type { SlotProps } from "@yaakapp-internal/ui";
import { SplitLayout } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useAtomValue } from "jotai";
import type { CSSProperties, ReactNode } from "react";
import { useCurrentGraphQLSchema } from "../hooks/useIntrospectGraphQL";
import { activeWorkspaceAtom } from "../hooks/useActiveWorkspace";
import { workspaceLayoutAtom } from "../lib/atoms";
import { curlPanelRequestIdAtom } from "../lib/curlPanel";
import { CurlViewer } from "./CurlViewer";
import { GraphQLDocsExplorer } from "./graphql/GraphQLDocsExplorer";
import { showGraphQLDocExplorerAtom } from "./graphql/graphqlAtoms";
import { HttpRequestPane } from "./HttpRequestPane";
import { HttpResponsePane } from "./HttpResponsePane";

interface Props {
  activeRequest: HttpRequest;
  style: CSSProperties;
}

export function HttpRequestLayout({ activeRequest, style }: Props) {
  const showGraphQLDocExplorer = useAtomValue(showGraphQLDocExplorerAtom);
  const graphQLSchema = useCurrentGraphQLSchema(activeRequest);
  const workspaceLayout = useAtomValue(workspaceLayoutAtom);
  const activeWorkspace = useAtomValue(activeWorkspaceAtom);
  const curlPanelRequestId = useAtomValue(curlPanelRequestIdAtom);
  const wsId = activeWorkspace?.id ?? "n/a";
  const showCurlPanelForRequest = curlPanelRequestId === activeRequest.id;

  const requestResponseSplit = ({ style }: Pick<SlotProps, "style">) => (
    <SplitLayout
      storageKey={`http_layout::${wsId}`}
      className="p-3 gap-1.5"
      style={style}
      layout={workspaceLayout}
      firstSlot={({ orientation, style }) => (
        <HttpRequestPane
          style={style}
          activeRequest={activeRequest}
          fullHeight={orientation === "horizontal"}
        />
      )}
      secondSlot={({ style }) => (
        <HttpResponsePane activeRequestId={activeRequest.id} style={style} />
      )}
    />
  );

  if (
    activeRequest.bodyType === "graphql" &&
    showGraphQLDocExplorer[activeRequest.id] !== undefined &&
    graphQLSchema != null
  ) {
    return (
      <CurlSplit
        activeRequest={activeRequest}
        style={style}
        showCurlPanel={showCurlPanelForRequest}
        workspaceId={wsId}
        mainSlot={({ style }) => (
          <SplitLayout
            storageKey={`graphql_layout::${wsId}`}
            defaultRatio={1 / 3}
            style={style}
            firstSlot={requestResponseSplit}
            secondSlot={({ style, orientation }) => (
              <GraphQLDocsExplorer
                requestId={activeRequest.id}
                schema={graphQLSchema}
                className={classNames(orientation === "horizontal" && "!ml-0")}
                style={style}
              />
            )}
          />
        )}
      />
    );
  }

  return (
    <CurlSplit
      activeRequest={activeRequest}
      style={style}
      showCurlPanel={showCurlPanelForRequest}
      workspaceId={wsId}
      mainSlot={requestResponseSplit}
    />
  );
}

function CurlSplit({
  activeRequest,
  mainSlot,
  showCurlPanel,
  style,
  workspaceId,
}: {
  activeRequest: HttpRequest;
  mainSlot: (props: Pick<SlotProps, "style">) => ReactNode;
  showCurlPanel: boolean;
  style: CSSProperties;
  workspaceId: string;
}) {
  if (!showCurlPanel) {
    return mainSlot({ style });
  }

  return (
    <SplitLayout
      storageKey={`curl_layout::${workspaceId}`}
      style={style}
      defaultRatio={0.28}
      minWidthPx={280}
      layout="horizontal"
      firstSlot={mainSlot}
      secondSlot={({ style }) => <CurlViewer request={activeRequest} style={style} />}
    />
  );
}
