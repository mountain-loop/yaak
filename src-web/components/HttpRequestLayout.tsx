import type { CSSProperties } from 'react';
import React from 'react';
import type { HttpRequest } from '@yaakapp-internal/models';
import { SplitLayout } from './core/SplitLayout';
import { HttpRequestPane } from './HttpRequestPane';
import { HttpResponsePane } from './HttpResponsePane';
import { GraphQLDocsExplorer } from "./GraphQLDocsExplorer";

interface Props {
  activeRequest: HttpRequest;
  style: CSSProperties;
}

export function HttpRequestLayout({ activeRequest, style }: Props) {
  return (
    <SplitLayout
      name="http_layout"
      className="p-3 gap-1.5"
      style={style}
      firstSlot={({ orientation, style }) => (
        <HttpRequestPane
          style={style}
          activeRequest={activeRequest}
          fullHeight={orientation === 'horizontal'}
        />
      )}
      secondSlot={
        () => <>
            <SplitLayout
                name="http_response_layout"
                className="gap-1.5"
                firstSlot={
                    ({ style }) => <HttpResponsePane activeRequestId={activeRequest.id} style={style} />
                }
                secondSlot={
                    () => <GraphQLDocsExplorer />
                }
            />
        </>
    }
    />
  );
}
