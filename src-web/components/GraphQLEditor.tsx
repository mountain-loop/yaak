import type { HttpRequest } from '@yaakapp-internal/models';
import { updateSchema } from 'cm6-graphql';
import type { EditorView } from 'codemirror';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useIntrospectGraphQL } from '../hooks/useIntrospectGraphQL';
import { tryFormatJson } from '../lib/formatters';
import { Button } from './core/Button';
import type { EditorProps } from './core/Editor';
import { Editor, formatGraphQL } from './core/Editor';
import { FormattedError } from './core/FormattedError';
import { Separator } from './core/Separator';
import { useDialog } from './DialogContext';

type Props = Pick<EditorProps, 'heightMode' | 'className' | 'forceUpdateKey'> & {
  baseRequest: HttpRequest;
  onChange: (body: HttpRequest['body']) => void;
  body: HttpRequest['body'];
};

export function GraphQLEditor({ body, onChange, baseRequest, ...extraEditorProps }: Props) {
  const editorViewRef = useRef<EditorView>(null);
  const { schema, isLoading, error, refetch } = useIntrospectGraphQL(baseRequest);
  const [currentBody, setCurrentBody] = useState<{ query: string; variables: string | undefined }>(() => {
    // Migrate text bodies to GraphQL format
    // NOTE: This is how GraphQL used to be stored
    if ('text' in body) {
      const b = tryParseJson(body.text, {});
      const variables = JSON.stringify(b.variables || undefined, null, 2);
      return { query: b.query ?? '', variables };
    }

    return { query: body.query ?? '', variables: body.variables ?? '' };
  });

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

  const actions = useMemo<EditorProps['actions']>(() => {
    const isValid = error || isLoading;
    if (!isValid) {
      return [];
    }

    const actions: EditorProps['actions'] = [
      <div key="introspection" className="!opacity-100">
        <Button
          key="introspection"
          size="xs"
          color={error ? 'danger' : 'secondary'}
          isLoading={isLoading}
          onClick={() => {
            dialog.show({
              title: 'Introspection Failed',
              size: 'dynamic',
              id: 'introspection-failed',
              render: () => (
                <>
                  <FormattedError>{error ?? 'unknown'}</FormattedError>
                  <div className="w-full my-4">
                    <Button
                      onClick={() => {
                        dialog.hide('introspection-failed');
                        refetch();
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
          {error ? 'Introspection Failed' : 'Introspecting'}
        </Button>
      </div>,
    ];

    return actions;
  }, [dialog, error, isLoading, refetch]);

  return (
    <div className="h-full w-full grid grid-cols-1 grid-rows-[minmax(0,100%)_auto]">
      <Editor
        language="graphql"
        heightMode="auto"
        format={formatGraphQL}
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
