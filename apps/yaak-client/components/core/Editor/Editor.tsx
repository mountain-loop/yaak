import { startCompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { settingsAtom } from "@yaakapp-internal/models";
import type { EditorLanguage, TemplateFunction } from "@yaakapp-internal/plugins";
import { CodeEditor, type CodeEditorProps } from "@yaakapp-internal/ui/editor";
import type { GraphQLSchema } from "graphql";
import { useAtomValue } from "jotai";
import { useCallback, useMemo, useRef } from "react";
import { activeEnvironmentAtom } from "../../../hooks/useActiveEnvironment";
import type { WrappedEnvironmentVariable } from "../../../hooks/useEnvironmentVariables";
import { useEnvironmentVariables } from "../../../hooks/useEnvironmentVariables";
import { eventMatchesHotkey } from "../../../hooks/useHotKey";
import { useRequestEditor } from "../../../hooks/useRequestEditor";
import { useTemplateFunctionCompletionOptions } from "../../../hooks/useTemplateFunctions";
import { editEnvironment } from "../../../lib/editEnvironment";
import { tryFormatJson, tryFormatXml } from "../../../lib/formatters";
import { jotaiStore } from "../../../lib/jotai";
import { withEncryptionEnabled } from "../../../lib/setupOrConfigureEncryption";
import { TemplateFunctionDialog } from "../../TemplateFunctionDialog";
import { getLanguageExtension } from "./extensions";
import type { GenericCompletionConfig } from "./genericCompletion";
import { largeValues, mediaValues } from "./largeValues";

export type EditorProps = Omit<CodeEditorProps, "language" | "extensions" | "keymap"> & {
  autocomplete?: GenericCompletionConfig;
  autocompleteFunctions?: boolean;
  autocompleteVariables?: boolean | ((v: WrappedEnvironmentVariable) => boolean);
  extraExtensions?: Extension[] | Extension;
  forcedEnvironmentId?: string;
  graphQLSchema?: GraphQLSchema | null;
  language?: EditorLanguage | "pairs" | "url" | "timeline" | null;
};

const emptyVariables: WrappedEnvironmentVariable[] = [];

export function Editor({
  autocomplete,
  autocompleteFunctions,
  autocompleteVariables,
  extraExtensions,
  forcedEnvironmentId,
  format,
  graphQLSchema,
  hideGutter,
  language,
  lintExtension,
  readOnly,
  wrapLines,
  ...props
}: EditorProps) {
  const settings = useAtomValue(settingsAtom);

  const allEnvironmentVariables = useEnvironmentVariables(forcedEnvironmentId ?? null);
  const useTemplating = !!(autocompleteFunctions || autocompleteVariables || autocomplete);
  const environmentVariables = useMemo(() => {
    if (!autocompleteVariables) return emptyVariables;
    return typeof autocompleteVariables === "function"
      ? allEnvironmentVariables.filter(autocompleteVariables)
      : allEnvironmentVariables;
  }, [allEnvironmentVariables, autocompleteVariables]);

  if (settings && wrapLines === undefined) {
    wrapLines = settings.editorSoftWrap;
  }

  if (props.disabled) {
    readOnly = true;
  }

  if (format == null && !readOnly) {
    format =
      language === "json"
        ? tryFormatJson
        : language === "xml" || language === "html"
          ? tryFormatXml
          : undefined;
  }

  // Template dialogs are opened against the editor the tag was clicked in
  const viewRef = useRef<EditorView | null>(null);
  const { setRef } = props;
  const handleSetRef = useCallback(
    (view: EditorView | null) => {
      viewRef.current = view;
      setRef?.(view);
    },
    [setRef],
  );

  const onClickFunction = useCallback(
    async (fn: TemplateFunction, tagValue: string, startPos: number) => {
      const show = () => {
        if (viewRef.current === null) return;
        TemplateFunctionDialog.show(fn, tagValue, startPos, viewRef.current);
      };

      if (fn.name === "secure") {
        withEncryptionEnabled(show);
      } else {
        show();
      }
    },
    [],
  );

  const onClickVariable = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async (v: WrappedEnvironmentVariable, _tagValue: string, _startPos: number) => {
      await editEnvironment(v.environment, { addOrFocusVariable: v.variable });
    },
    [],
  );

  const onClickMissingVariable = useCallback(async (name: string) => {
    const activeEnvironment = jotaiStore.get(activeEnvironmentAtom);
    await editEnvironment(activeEnvironment, {
      addOrFocusVariable: { name, value: "", enabled: true },
    });
  }, []);

  const [, { focusParamValue }] = useRequestEditor();
  const onClickPathParameter = useCallback(
    async (name: string) => {
      focusParamValue(name);
    },
    [focusParamValue],
  );

  const completionOptions = useTemplateFunctionCompletionOptions(
    onClickFunction,
    !!autocompleteFunctions,
  );

  const languageExtension = useMemo(
    () =>
      getLanguageExtension({
        useTemplating,
        language,
        lintExtension,
        hideGutter,
        environmentVariables,
        autocomplete,
        completionOptions,
        onClickVariable,
        onClickMissingVariable,
        onClickPathParameter,
        graphQLSchema: graphQLSchema ?? null,
      }),
    [
      language,
      lintExtension,
      autocomplete,
      environmentVariables,
      onClickVariable,
      onClickMissingVariable,
      onClickPathParameter,
      completionOptions,
      useTemplating,
      graphQLSchema,
      hideGutter,
    ],
  );

  return (
    <CodeEditor
      {...props}
      editableExtensions={mediaValues}
      extensions={extraExtensions}
      format={format}
      hideGutter={hideGutter}
      keyDownHandler={startCompletionOnHotkey}
      keymap={settings.editorKeymap}
      language={codeEditorLanguage(language)}
      languageExtension={languageExtension}
      lintExtension={lintExtension}
      readOnly={readOnly}
      readOnlyExtensions={largeValues}
      setRef={handleSetRef}
      wrapLines={wrapLines}
    />
  );
}

/** The client's own languages bring their extension along, so CodeEditor needn't know them */
function codeEditorLanguage(language: EditorProps["language"]): CodeEditorProps["language"] {
  return language === "url" || language === "pairs" || language === "timeline" ? null : language;
}

function startCompletionOnHotkey(e: KeyboardEvent, view: EditorView): boolean {
  if (!eventMatchesHotkey(e, "editor.autocomplete")) return false;
  e.preventDefault();
  startCompletion(view);
  return true;
}
