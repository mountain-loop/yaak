import { linter } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { jsoncLanguage } from "@shopify/lang-jsonc";
import { type GrpcRequest, patchModel } from "@yaakapp-internal/models";
import { FormattedError, InlineCode, VStack } from "@yaakapp-internal/ui";
import classNames from "classnames";
import {
  handleRefresh,
  jsonCompletion,
  jsonSchemaLinter,
  stateExtensions,
  updateSchema,
} from "codemirror-json-schema";
import type { JSONSchema7 } from "json-schema";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReflectResponseService } from "../hooks/useGrpc";
import { wasUpdatedExternally } from "../hooks/useRequestUpdateKey";
import { showAlert } from "../lib/alert";
import { showConfirm } from "../lib/confirm";
import { showDialog } from "../lib/dialog";
import type { JsonSchema } from "../lib/jsonSchemaExample";
import { buildExampleFromSchema } from "../lib/jsonSchemaExample";
import { pluralizeCount } from "../lib/pluralize";
import { Button } from "./core/Button";
import type { EditorProps } from "./core/Editor/Editor";
import { Editor } from "./core/Editor/LazyEditor";
import { GrpcProtoSelectionDialog } from "./GrpcProtoSelectionDialog";

type Props = Pick<EditorProps, "heightMode" | "onChange" | "className" | "forceUpdateKey"> & {
  services: ReflectResponseService[] | null;
  reflectionError?: string;
  reflectionLoading?: boolean;
  request: GrpcRequest;
  protoFiles: string[];
};

type MethodSchema =
  | { type: "none" }
  | { type: "schema"; schema: JsonSchema }
  | { type: "error"; id: string; title: string; body: ReactNode; log: unknown[] };

export function GrpcEditor({
  services,
  reflectionError,
  reflectionLoading,
  request,
  protoFiles,
  ...extraEditorProps
}: Props) {
  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const handleInitEditorViewRef = useCallback((h: EditorView | null) => {
    setEditorView(h);
  }, []);

  // Find the schema for the selected service and method
  const methodSchema = useMemo<MethodSchema>(() => {
    if (services === null || request.service === null || request.method === null) {
      return { type: "none" };
    }

    const s = services.find((s) => s.name === request.service);
    if (s == null) {
      return {
        type: "error",
        id: "grpc-find-service-error",
        title: "Couldn't Find Service",
        body: (
          <>
            Failed to find service <InlineCode>{request.service}</InlineCode> in schema
          </>
        ),
        log: ["Failed to find service", { service: request.service, services }],
      };
    }

    const schema = s.methods.find((m) => m.name === request.method)?.schema;
    if (schema == null) {
      return {
        type: "error",
        id: "grpc-find-schema-error",
        title: "Couldn't Find Method",
        body: (
          <>
            Failed to find method <InlineCode>{request.method}</InlineCode> for{" "}
            <InlineCode>{request.service}</InlineCode> in schema
          </>
        ),
        log: ["Failed to find method", { method: request.method, methods: s.methods }],
      };
    }

    try {
      return { type: "schema", schema: JSON.parse(schema) as JsonSchema };
    } catch (err) {
      return {
        type: "error",
        id: "grpc-parse-schema-error",
        title: "Failed to Parse Schema",
        body: (
          <VStack space={4}>
            <p>
              For service <InlineCode>{request.service}</InlineCode> and method{" "}
              <InlineCode>{request.method}</InlineCode>
            </p>
            <FormattedError>{String(err)}</FormattedError>
          </VStack>
        ),
        log: ["Failed to parse schema", err],
      };
    }
  }, [services, request.method, request.service]);

  useEffect(() => {
    if (methodSchema.type !== "error") return;
    console.log(...methodSchema.log);
    showAlert({ id: methodSchema.id, title: methodSchema.title, body: methodSchema.body });
  }, [methodSchema]);

  // Update the editor whenever the schema changes
  useEffect(() => {
    if (editorView == null || methodSchema.type !== "schema") return;
    updateSchema(editorView, methodSchema.schema as JSONSchema7);
  }, [editorView, methodSchema]);

  const extraExtensions = useMemo(
    () => [
      linter(jsonSchemaLinter(), {
        delay: 200,
        needsRefresh: handleRefresh,
      }),
      jsoncLanguage.data.of({
        autocomplete: jsonCompletion(),
      }),
      stateExtensions({}),
    ],
    [],
  );

  const reflectionUnavailable = reflectionError?.match(/unimplemented/i);
  reflectionError = reflectionUnavailable ? undefined : reflectionError;

  const handleGenerateExample = useCallback(async () => {
    if (methodSchema.type !== "schema") return;

    if (request.message.trim() !== "") {
      const confirmed = await showConfirm({
        id: "grpc-generate-example",
        title: "Generate Example",
        description: "The current message will be replaced with an example.",
        confirmText: "Generate",
      });
      if (!confirmed) return;
    }

    const message = JSON.stringify(buildExampleFromSchema(methodSchema.schema), null, 2);
    await patchModel(request, { message });

    // Force the editor to pick up the new message
    wasUpdatedExternally(request.id);
  }, [methodSchema, request]);

  const actions = useMemo(
    () => [
      ...(methodSchema.type === "schema"
        ? [
            <Button key="example" size="xs" color="secondary" onClick={handleGenerateExample}>
              Generate Example
            </Button>,
          ]
        : []),
      <div key="reflection" className={classNames(services == null && "opacity-100!")}>
        <Button
          size="xs"
          color={
            reflectionLoading
              ? "secondary"
              : reflectionUnavailable
                ? "info"
                : reflectionError
                  ? "danger"
                  : "secondary"
          }
          isLoading={reflectionLoading}
          onClick={() => {
            showDialog({
              title: "Configure Schema",
              size: "md",
              id: "reflection-failed",
              render: ({ hide }) => <GrpcProtoSelectionDialog onDone={hide} />,
            });
          }}
        >
          {reflectionLoading
            ? "Inspecting Schema"
            : reflectionUnavailable
              ? "Select Proto Files"
              : reflectionError
                ? "Server Error"
                : protoFiles.length > 0
                  ? pluralizeCount("File", protoFiles.length)
                  : services != null && protoFiles.length === 0
                    ? "Schema Detected"
                    : "Select Schema"}
        </Button>
      </div>,
    ],
    [
      handleGenerateExample,
      methodSchema.type,
      protoFiles.length,
      reflectionError,
      reflectionLoading,
      reflectionUnavailable,
      services,
    ],
  );

  return (
    <div className="h-full w-full grid grid-cols-1 grid-rows-[minmax(0,100%)_auto_auto_minmax(0,auto)]">
      <Editor
        setRef={handleInitEditorViewRef}
        language="json"
        autocompleteFunctions
        autocompleteVariables
        defaultValue={request.message}
        heightMode="auto"
        placeholder="..."
        extraExtensions={extraExtensions}
        actions={actions}
        stateKey={`grpc_message.${request.id}`}
        {...extraEditorProps}
      />
    </div>
  );
}
