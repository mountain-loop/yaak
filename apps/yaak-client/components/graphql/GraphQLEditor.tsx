import type { HttpRequest } from "@yaakapp-internal/models";
import { platform } from "@yaakapp-internal/platform";

import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";
import { useLocalStorage } from "react-use";
import { useIntrospectGraphQL } from "../../hooks/useIntrospectGraphQL";
import { useStateWithDeps } from "../../hooks/useStateWithDeps";
import { showDialog } from "../../lib/dialog";
import { Button } from "../core/Button";
import type { DropdownItem } from "../core/Dropdown";
import { Dropdown } from "../core/Dropdown";
import type { EditorProps } from "../core/Editor/Editor";
import { Editor } from "../core/Editor/LazyEditor";
import { IconButton } from "../core/IconButton";
import type { RadioDropdownItem } from "../core/RadioDropdown";
import { RadioDropdown } from "../core/RadioDropdown";
import { Banner, FormattedError, Icon } from "@yaakapp-internal/ui";
import { Separator } from "../core/Separator";
import { tryFormatGraphql } from "../../lib/formatters";
import { parseGraphQLOperationNames } from "../../lib/graphqlOperationNames";
import { normalizeGraphQLBody } from "../../lib/requestBodyConversion";
import { revealInFinderText } from "../../lib/reveal";
import { showGraphQLDocExplorerAtom } from "./graphqlAtoms";

type Props = Pick<EditorProps, "heightMode" | "className" | "forceUpdateKey"> & {
  baseRequest: HttpRequest;
  onChange: (body: HttpRequest["body"]) => void;
  request: HttpRequest;
};

const OPERATION_NAME_NOT_SPECIFIED = "";

// How much of the end of a schema filename is pinned when middle-truncating it.
// Enough to keep the extension and a little of the name before it.
const FILE_NAME_TAIL_CHARS = 12;

export function GraphQLEditor(props: Props) {
  // There's some weirdness with stale onChange being called when switching requests, so we'll
  // key on the request ID as a workaround for now.
  return <GraphQLEditorInner key={props.request.id} {...props} />;
}

function GraphQLEditorInner({ request, onChange, baseRequest, ...extraEditorProps }: Props) {
  const [autoIntrospectDisabled, setAutoIntrospectDisabled] = useLocalStorage<
    Record<string, boolean>
  >("graphQLAutoIntrospectDisabled", {});
  const {
    schema,
    isLoading,
    error,
    refetch,
    clear,
    loadFromFile,
    reloadFromFile,
    removeSchemaFile,
    filePath,
  } = useIntrospectGraphQL(baseRequest, {
    disabled: autoIntrospectDisabled?.[baseRequest.id],
  });

  // Last path segment, for display only. The host owns real path semantics; this
  // just needs something short enough to label the divider with.
  const fileName = useMemo(() => filePath?.split(/[/\\]/).pop() || filePath, [filePath]);

  // Selecting a file is all it takes — the request's source becomes that file,
  // which is what keeps automatic introspection from overwriting it.
  const handleLoadFromFile = useCallback(async () => {
    const selected = await platform.dialog.open({
      title: "Load GraphQL Schema",
      multiple: false,
      filters: [
        {
          name: "GraphQL Schema",
          extensions: ["graphql", "graphqls", "gql", "json"],
        },
      ],
    });
    if (selected == null) return;

    await loadFromFile(selected);
  }, [loadFromFile]);
  const [currentBody, setCurrentBody] = useStateWithDeps<{
    query: string;
    variables: string | undefined;
    operationName?: string;
  }>(() => {
    // Migrate text bodies to GraphQL format
    // NOTE: This is how GraphQL used to be stored
    return normalizeGraphQLBody(request.body);
  }, [extraEditorProps.forceUpdateKey]);

  const [isDocOpenRecord, setGraphqlDocStateAtomValue] = useAtom(showGraphQLDocExplorerAtom);
  const isDocOpen = isDocOpenRecord[request.id] !== undefined;
  const parsedOperationNames = useMemo(
    () => parseGraphQLOperationNames(currentBody.query),
    [currentBody.query],
  );
  const operationNames = useMemo(() => parsedOperationNames ?? [], [parsedOperationNames]);

  const handleChangeQuery = useCallback(
    (query: string) => {
      setCurrentBody(({ variables, operationName }) => {
        const newBody = buildGraphQLBody({ query, variables, operationName });
        onChange(newBody);
        return newBody;
      });
    },
    [onChange, setCurrentBody],
  );

  const handleChangeVariables = useCallback(
    (variables: string) => {
      setCurrentBody(({ query, operationName }) => {
        const newBody = buildGraphQLBody({ query, variables, operationName });
        onChange(newBody);
        return newBody;
      });
    },
    [onChange, setCurrentBody],
  );

  const handleChangeOperationName = useCallback(
    (operationName: string) => {
      setCurrentBody(({ query, variables }) => {
        const newBody = buildGraphQLBody({ query, variables, operationName });
        onChange(newBody);
        return newBody;
      });
    },
    [onChange, setCurrentBody],
  );

  useEffect(() => {
    if (parsedOperationNames == null) {
      return;
    }

    if (currentBody.operationName === OPERATION_NAME_NOT_SPECIFIED) {
      return;
    }

    if (currentBody.operationName && operationNames.includes(currentBody.operationName)) {
      return;
    }

    // Keep the saved body aligned with the visible default, so send/copy use the selected operation.
    const operationName = operationNames[0];
    if (currentBody.operationName === operationName) {
      return;
    }

    setCurrentBody(({ query, variables }) => {
      const newBody = buildGraphQLBody({ query, variables, operationName });
      onChange(newBody);
      return newBody;
    });
  }, [
    currentBody.operationName,
    onChange,
    operationNames,
    parsedOperationNames,
    setCurrentBody,
  ]);

  const actions = useMemo<EditorProps["actions"]>(
    () => [
      operationNames.length > 0 ? (
        <div key="operation" className="opacity-100!">
          <RadioDropdown
            value={currentBody.operationName ?? operationNames[0] ?? OPERATION_NAME_NOT_SPECIFIED}
            onChange={handleChangeOperationName}
            items={[
              { type: "separator", label: "Operation Name" },
              {
                label: <span className="text-text-subtle italic">Not specified</span>,
                value: OPERATION_NAME_NOT_SPECIFIED,
              },
              ...operationNames.map((operationName) => ({
                label: operationName,
                value: operationName,
              })),
            ] satisfies RadioDropdownItem<string>[]}
          >
            <Button size="sm" variant="border" title="Select Operation" forDropdown>
              {currentBody.operationName === OPERATION_NAME_NOT_SPECIFIED ? (
                <span className="text-text-subtle italic">Not specified</span>
              ) : (
                currentBody.operationName ?? operationNames[0]
              )}
            </Button>
          </RadioDropdown>
        </div>
      ) : null,
      <div key="introspection" className="opacity-100!">
        {schema === undefined ? null /* Initializing */ : (
          <Dropdown
            items={[
              ...((schema != null
                ? [
                    {
                      label: "Clear Schema",
                      onSelect: clear,
                      color: "danger",
                      leftSlot: <Icon icon="trash" />,
                    },
                  ]
                : []) satisfies DropdownItem[]),
              {
                // Labels the source actions below it, so the menu says where the
                // schema came from without spending a row on it.
                type: "separator",
                hidden: schema == null && filePath == null,
                label:
                  fileName == null || filePath == null ? undefined : (
                    // Middle truncation: the head shrinks and ellipsizes while the
                    // tail is pinned, so the extension always survives. Full path
                    // on hover.
                    <div className="flex min-w-0 max-w-[16rem] font-mono text-xs" title={filePath}>
                      <span className="truncate">{fileName.slice(0, -FILE_NAME_TAIL_CHARS)}</span>
                      <span className="shrink-0">{fileName.slice(-FILE_NAME_TAIL_CHARS)}</span>
                    </div>
                  ),
                action:
                  filePath == null
                    ? undefined
                    : {
                        icon: "folder_symlink",
                        title: revealInFinderText,
                        onClick: () => platform.revealItemInDir(filePath),
                      },
              },
              {
                hidden: !error,
                label: (
                  <Banner color="danger">
                    <p className="mb-1">Schema introspection failed</p>
                    <Button
                      size="xs"
                      color="danger"
                      variant="border"
                      onClick={() => {
                        showDialog({
                          title: "Introspection Failed",
                          size: "sm",
                          id: "introspection-failed",
                          render: ({ hide }) => (
                            <>
                              <FormattedError>{error ?? "unknown"}</FormattedError>
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
                                  Retry Request
                                </Button>
                              </div>
                            </>
                          ),
                        });
                      }}
                    >
                      View Error
                    </Button>
                  </Banner>
                ),
                type: "content",
              },
              {
                // One refresh action for either source: re-read the file, or
                // re-introspect the server.
                label: "Reload Schema",
                leftSlot: <Icon icon="refresh" spin={isLoading} />,
                keepOpenOnSelect: true,
                // Failures surface through the hook's error state either way.
                onSelect: async () => {
                  if (filePath != null) await reloadFromFile();
                  else await refetch();
                },
              },
              {
                label: filePath == null ? "Load Schema from File…" : "Load a Different File…",
                leftSlot: <Icon icon="import" />,
                onSelect: handleLoadFromFile,
              },
              {
                hidden: filePath == null,
                label: "Stop Using File",
                leftSlot: <Icon icon="x" />,
                onSelect: removeSchemaFile,
              },
              { type: "separator", label: "Settings" },
              {
                // Governs both sources: re-introspecting the server, and
                // re-reading the file when the request is opened.
                label: filePath == null ? "Automatic Introspection" : "Automatic Reload",
                keepOpenOnSelect: true,
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
                        ? "check_square_unchecked"
                        : "check_square_checked"
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
              color={error ? "danger" : "default"}
              forDropdown
            >
              {error ? "Introspection Failed" : schema ? "Schema" : "No Schema"}
            </Button>
          </Dropdown>
        )}
      </div>,
      // Sits after the schema control it depends on. Always rendered, disabled
      // without a schema, so the row never changes shape.
      <div key="documentation" className="opacity-100!">
          <IconButton
            size="sm"
            variant="border"
            icon="book_open_text"
            disabled={schema == null}
            title={
              schema == null
                ? "Documentation unavailable without a schema"
                : isDocOpen
                  ? "Hide Documentation"
                  : "Show Documentation"
            }
            onClick={() => {
              setGraphqlDocStateAtomValue((v) => ({
                ...v,
                [request.id]: isDocOpen ? undefined : null,
              }));
            }}
          />
      </div>,
    ],
    [
      schema,
      clear,
      error,
      currentBody.operationName,
      handleChangeOperationName,
      isDocOpen,
      isLoading,
      operationNames,
      refetch,
      handleLoadFromFile,
      reloadFromFile,
      removeSchemaFile,
      filePath,
      fileName,
      autoIntrospectDisabled,
      baseRequest.id,
      setGraphqlDocStateAtomValue,
      request.id,
      setAutoIntrospectDisabled,
    ],
  );

  return (
    <div className="h-full w-full grid grid-cols-1 grid-rows-[minmax(0,100%)_auto]">
      <Editor
        language="graphql"
        heightMode="auto"
        graphQLSchema={schema}
        format={tryFormatGraphql}
        defaultValue={currentBody.query}
        onChange={handleChangeQuery}
        placeholder="..."
        actions={actions}
        stateKey={`graphql_body.${request.id}`}
        {...extraEditorProps}
      />
      <div className="grid grid-rows-[auto_minmax(0,1fr)] grid-cols-1 min-h-20">
        <Separator dashed className="pb-1">
          Variables
        </Separator>
        <Editor
          language="json"
          heightMode="auto"
          defaultValue={currentBody.variables}
          onChange={handleChangeVariables}
          placeholder="{}"
          stateKey={`graphql_vars.${request.id}`}
          autocompleteFunctions
          autocompleteVariables
          {...extraEditorProps}
        />
      </div>
    </div>
  );
}

function buildGraphQLBody(body: {
  query: string;
  variables: string | undefined;
  operationName?: string;
}) {
  const result: {
    query: string;
    variables: string | undefined;
    operationName?: string;
  } = {
    query: body.query,
    variables: body.variables || undefined,
  };

  if (typeof body.operationName === "string") {
    result.operationName = body.operationName;
  }

  return result;
}
