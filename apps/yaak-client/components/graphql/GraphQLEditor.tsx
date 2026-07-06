import type { HttpRequest } from "@yaakapp-internal/models";

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
import type { RadioDropdownItem } from "../core/RadioDropdown";
import { RadioDropdown } from "../core/RadioDropdown";
import { Banner, FormattedError, Icon } from "@yaakapp-internal/ui";
import { Separator } from "../core/Separator";
import { tryFormatGraphql } from "../../lib/formatters";
import { parseGraphQLOperationNames } from "../../lib/graphqlOperationNames";
import { normalizeGraphQLBody } from "../../lib/requestBodyConversion";
import { showGraphQLDocExplorerAtom } from "./graphqlAtoms";

type Props = Pick<EditorProps, "heightMode" | "className" | "forceUpdateKey"> & {
  baseRequest: HttpRequest;
  onChange: (body: HttpRequest["body"]) => void;
  request: HttpRequest;
};

const OPERATION_NAME_NOT_SPECIFIED = "";

export function GraphQLEditor(props: Props) {
  // There's some weirdness with stale onChange being called when switching requests, so we'll
  // key on the request ID as a workaround for now.
  return <GraphQLEditorInner key={props.request.id} {...props} />;
}

function GraphQLEditorInner({ request, onChange, baseRequest, ...extraEditorProps }: Props) {
  const [autoIntrospectDisabled, setAutoIntrospectDisabled] = useLocalStorage<
    Record<string, boolean>
  >("graphQLAutoIntrospectDisabled", {});
  const { schema, isLoading, error, refetch, clear } = useIntrospectGraphQL(baseRequest, {
    disabled: autoIntrospectDisabled?.[baseRequest.id],
  });
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
                      label: "Clear",
                      onSelect: clear,
                      color: "danger",
                      leftSlot: <Icon icon="trash" />,
                    },
                    { type: "separator" },
                  ]
                : []) satisfies DropdownItem[]),
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
                hidden: schema == null,
                label: `${isDocOpen ? "Hide" : "Show"} Documentation`,
                leftSlot: <Icon icon="book_open_text" />,
                onSelect: () => {
                  setGraphqlDocStateAtomValue((v) => ({
                    ...v,
                    [request.id]: isDocOpen ? undefined : null,
                  }));
                },
              },
              {
                label: "Introspect Schema",
                leftSlot: <Icon icon="refresh" spin={isLoading} />,
                keepOpenOnSelect: true,
                onSelect: refetch,
              },
              { type: "separator", label: "Setting" },
              {
                label: "Automatic Introspection",
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
