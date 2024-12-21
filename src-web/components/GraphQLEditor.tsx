import type { HttpRequest } from '@yaakapp-internal/models';
import { updateSchema } from 'cm6-graphql';
import type { EditorView } from 'codemirror';

import { formatSdl } from 'format-graphql';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalStorage } from 'react-use';
import { useIntrospectGraphQL } from '../hooks/useIntrospectGraphQL';
import { tryFormatJson } from '../lib/formatters';
import { Button } from './core/Button';
import { Dropdown } from './core/Dropdown';
import type { EditorProps } from './core/Editor/Editor';
import { Editor } from './core/Editor/Editor';
import { FormattedError } from './core/FormattedError';
import { Icon } from './core/Icon';
import { Separator } from './core/Separator';
import { useDialog } from '../hooks/useDialog';

type Props = Pick<EditorProps, 'heightMode' | 'className' | 'forceUpdateKey'> & {
  baseRequest: HttpRequest;
  onChange: (body: HttpRequest['body']) => void;
  body: HttpRequest['body'];
};

export function GraphQLEditor({ body, onChange, baseRequest, ...extraEditorProps }: Props) {
  const editorViewRef = useRef<EditorView>(null);
  const [autoIntrospectDisabled, setAutoIntrospectDisabled] = useLocalStorage<
    Record<string, boolean>
  >('graphQLAutoIntrospectDisabled', {});
  const { schema, isLoading, error, refetch, clear } = useIntrospectGraphQL(baseRequest, {
    disabled: autoIntrospectDisabled?.[baseRequest.id],
  });
  const [currentBody, setCurrentBody] = useState<{ query: string; variables: string | undefined }>(
    () => {
      // Migrate text bodies to GraphQL format
      // NOTE: This is how GraphQL used to be stored
      if ('text' in body) {
        const b = tryParseJson(body.text, {});
        const variables = JSON.stringify(b.variables || undefined, null, 2);
        return { query: b.query ?? '', variables };
      }

      return { query: body.query ?? '', variables: body.variables ?? '' };
    },
  );

  const handleChangeQuery = (query: string) => {
    const newBody = { query, variables: currentBody.variables || undefined };
    setCurrentBody(newBody);
    onChange(newBody);
  };

  const handleChangeVariables = (variables: string) => {
    const newBody = { query: currentBody.query, variables: variables || undefined };
    setCurrentBody(newBody);
    onChange(newBody);
  };

  // Refetch the schema when the URL changes
  useEffect(() => {
    if (editorViewRef.current === null) return;
    updateSchema(editorViewRef.current, schema ?? undefined);
  }, [schema]);

  const dialog = useDialog();

  const actions = useMemo<EditorProps['actions']>(
    () => [
      <div key="introspection" className="!opacity-100">
        {schema === undefined ? null /* Initializing */ : !error ? (
          <Dropdown
            items={[
              {
                key: 'refresh',
                label: 'Refetch',
                leftSlot: <Icon icon="refresh" />,
                onSelect: refetch,
              },
              {
                key: 'clear',
                label: 'Clear',
                onSelect: clear,
                hidden: !schema,
                variant: 'danger',
                leftSlot: <Icon icon="trash" />,
              },
              { type: 'separator', label: 'Setting' },
              {
                key: 'auto_fetch',
                label: 'Automatic Introspection',
                onSelect: () => {
                  setAutoIntrospectDisabled({
                    ...autoIntrospectDisabled,
                    [baseRequest.id]: !autoIntrospectDisabled?.[baseRequest.id],
                  });
                },
                leftSlot: (
                  <Icon
                    icon={
                      autoIntrospectDisabled?.[baseRequest.id]
                        ? 'check_square_unchecked'
                        : 'check_square_checked'
                    }
                  />
                ),
              },
            ]}
          >
            <Button
              size="sm"
              variant="border"
              title="Refetch Schema"
              isLoading={isLoading}
              color={isLoading || schema ? 'default' : 'warning'}
            >
              {isLoading ? 'Introspecting' : schema ? 'Schema' : 'No Schema'}
            </Button>
          </Dropdown>
        ) : (
          <Button
            size="sm"
            color="danger"
            isLoading={isLoading}
            onClick={() => {
              dialog.show({
                title: 'Introspection Failed',
                size: 'dynamic',
                id: 'introspection-failed',
                render: ({ hide }) => (
                  <>
                    <FormattedError>{error ?? 'unknown'}</FormattedError>
                    <div className="w-full my-4">
                      <Button
                        onClick={async () => {
                          hide();
                          await refetch();
                        }}
                        className="ml-auto"
                        color="primary"
                        size="sm"
                      >
                        Try Again
                      </Button>
                    </div>
                  </>
                ),
              });
            }}
          >
            Introspection Failed
          </Button>
        )}
      </div>,
    ],
    [
      isLoading,
      refetch,
      error,
      autoIntrospectDisabled,
      baseRequest.id,
      clear,
      schema,
      setAutoIntrospectDisabled,
      dialog,
    ],
  );

  return (
    <div className="h-full w-full grid grid-cols-1 grid-rows-[minmax(0,100%)_auto]">
      <Editor
        language="graphql"
        heightMode="auto"
        format={formatSdl}
        defaultValue={currentBody.query}
        onChange={handleChangeQuery}
        placeholder="..."
        ref={editorViewRef}
        actions={actions}
        {...extraEditorProps}
      />
      <div className="grid grid-rows-[auto_minmax(0,1fr)] grid-cols-1 min-h-[5rem]">
        <Separator dashed className="pb-1">
          Variables
        </Separator>
        <Editor
          format={tryFormatJson}
          language="json"
          heightMode="auto"
          defaultValue={currentBody.variables}
          onChange={handleChangeVariables}
          placeholder="{}"
          useTemplating
          autocompleteVariables
          {...extraEditorProps}
        />
      </div>
    </div>
  );
}

function tryParseJson(text: string, fallback: unknown) {
  try {
    return JSON.parse(text);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (err) {
    return fallback;
  }
}
