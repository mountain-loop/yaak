import type { HttpRequest } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { useAtomValue } from 'jotai';
import type { CSSProperties } from 'react';
import React from 'react';
import { useCurrentGraphQLSchema } from '../hooks/useIntrospectGraphQL';
import { workspaceLayoutAtom } from '../lib/atoms';
import type { SlotProps } from './core/SplitLayout';
import { SplitLayout } from './core/SplitLayout';
import { GraphQLDocsExplorer } from './graphql/GraphQLDocsExplorer';
import { showGraphQLDocExplorerAtom } from './graphql/graphqlAtoms';
import { HttpRequestPane } from './HttpRequestPane';
import { HttpResponsePane } from './HttpResponsePane';

interface Props {
  activeRequest: HttpRequest;
  style: CSSProperties;
}


export function HttpRequestLayout({ activeRequest, style }: Props) {
  const showGraphQLDocExplorer = useAtomValue(showGraphQLDocExplorerAtom);
  const graphQLSchema = useCurrentGraphQLSchema(activeRequest);
  const workspaceLayout = useAtomValue(workspaceLayoutAtom);

  const requestResponseSplit = ({ style }: Pick<SlotProps, 'style'>) => (
    <SplitLayout
      name="http_layout"
      className="p-3 gap-1.5"
      style={style}
      layout={workspaceLayout}
      firstSlot={({ orientation, style }) => (
        <HttpRequestPane
          style={style}
          activeRequest={activeRequest}
          fullHeight={orientation === 'horizontal'}
        />
      )}
      secondSlot={({ style }) => (
        <HttpResponsePane activeRequestId={activeRequest.id} style={style} />
      )}
    />
  );

  if (
    activeRequest.bodyType === 'graphql' &&
    showGraphQLDocExplorer[activeRequest.id] !== undefined &&
    graphQLSchema != null
  ) {
    return (
      <SplitLayout
        name="graphql_layout"
        defaultRatio={1 / 3}
        firstSlot={requestResponseSplit}
        secondSlot={({ style, orientation }) => (
          <GraphQLDocsExplorer
            requestId={activeRequest.id}
            schema={graphQLSchema}
            className={classNames(orientation == 'horizontal' && '!ml-0')}
            style={style}
          />
        )}
      />
    );
  }

  return requestResponseSplit({ style });
}
