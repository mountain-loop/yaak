import type { Completion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { GenericCompletionOption } from "@yaakapp-internal/plugins";
import type { ComponentType, ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import type { SetStoredValue, StoredValue, UseStoredValue } from "../hooks/useStoredValue";
import { useInMemoryStoredValue } from "../hooks/useStoredValue";
import type { HttpBodyLoader } from "./http/types";
import type { MultipartViewerProps } from "./viewers/MultipartViewer";
import { MultipartViewer } from "./viewers/MultipartViewer";
import type { TextViewerProps } from "./viewers/TextViewer";
import { TextViewer } from "./viewers/TextViewer";
import type { ButtonProps } from "./Button";
import type { DialogProps } from "./Dialog";
import type { CodeEditorProps } from "./editor/CodeEditor";
import { ErrorBoundary } from "./ErrorBoundary";
import { LazyCodeEditor } from "./editor/LazyCodeEditor";
import type { InputProps } from "./Input";
import { Input } from "./Input";
import type { SelectProps } from "./Select";
import { Select } from "./Select";

export type GenericCompletion = GenericCompletionOption & {
  apply?: Completion["apply"];
};

export interface GenericCompletionConfig {
  minMatch?: number;
  options: GenericCompletion[];
}

/** A template variable, as far as shared components need to know one */
export interface TemplateVariableRef {
  variable: { name: string };
}

/**
 * What a host's editor adds on top of `CodeEditor`, like the client's template tags and
 * environment variables. Shared components pass these through; a host without templating
 * ignores them.
 */
export interface TemplatingProps {
  autocomplete?: GenericCompletionConfig;
  autocompleteFunctions?: boolean;
  autocompleteVariables?: boolean | ((v: TemplateVariableRef) => boolean);
  forcedEnvironmentId?: string;
  extraExtensions?: Extension[] | Extension;
}

/** `CodeEditor`'s languages, plus the host-only ones it may know (the client's URL and pairs) */
export type HostEditorLanguage = CodeEditorProps["language"] | "pairs" | "url";

export type HostEditorProps = Omit<CodeEditorProps, "language" | "extensions" | "keymap"> &
  TemplatingProps & { language?: HostEditorLanguage };

export type HostInputProps = Omit<
  InputProps,
  "language" | "extensions" | "renderEditor" | "renderOptionsPicker"
> &
  TemplatingProps & {
    language?: HostEditorLanguage;
    /** Show a chevron that opens the `autocomplete` options as a menu */
    showOptionsPicker?: boolean;
  };

/** A select of string values, as the shared components draw one */
export type HostSelectProps = SelectProps<string>;

export type SelectFileProps = Omit<ButtonProps, "type" | "onChange"> & {
  onChange: (value: { filePath: string | null; contentType: string | null }) => void;
  filePath: string | null;
  nameOverride?: string | null;
  inline?: boolean;
};

export interface HostPromptArgs {
  id: string;
  title: ReactNode;
  label: string;
  description?: ReactNode;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  required?: boolean;
}

export type HostDialogArgs = {
  id: string;
  render: ComponentType<{ hide: () => void }>;
} & Omit<DialogProps, "open" | "children" | "onClose">;

export type StoredValueNamespace = "global" | "no_sync";

/** Like `UseStoredValue`, but told whether the value is a synced preference or local state */
export type UseHostStoredValue = <T extends StoredValue>(
  key: string | string[] | null,
  fallback: T,
  namespace?: StoredValueNamespace,
) => readonly [T, SetStoredValue<T>];

/**
 * What shared editing components get from the app they run in. The client provides its
 * templated editor, file picker, dialogs and key-value store; anything else (the proxy) gets
 * plain `CodeEditor`s, in-memory state, and no dialogs.
 */
export interface EditorHost {
  Editor: ComponentType<HostEditorProps>;
  Input: ComponentType<HostInputProps>;
  /** A select, as the app draws them (the client uses the system's own on macOS) */
  Select: ComponentType<HostSelectProps>;
  SelectFile: ComponentType<SelectFileProps> | null;
  showDialog: ((args: HostDialogArgs) => void) | null;
  showPrompt: ((args: HostPromptArgs) => Promise<string | null>) | null;
  basename: (path: string) => Promise<string | null>;
  useStoredValue: UseHostStoredValue;
  /** Where a `DetailsBanner` with a `storageKey` keeps whether it's open */
  useDetailsBannerStoredValue: UseStoredValue;
  ErrorBoundary: ComponentType<{ name: string; children: ReactNode }>;
  /** The text viewer, with whatever the app adds to it (formatting, links) */
  TextViewer: ComponentType<TextViewerProps>;
  /** The multipart viewer, with whatever the app adds to it (a PDF viewer) */
  MultipartViewer: ComponentType<MultipartViewerProps>;
  /** Viewers only the app has, like the client's PDF viewer; null to use the shared ones */
  renderBodyViewer?: (args: HostBodyViewerArgs) => ReactNode | null;
  /** Open a URL outside the app */
  openUrl: ((url: string) => void) | null;
  /** Copy text to the clipboard, quietly, as rows of values do */
  copy: (text: string) => void;
}

export interface HostBodyViewerArgs {
  /** Which body: a response's, or the request body it was sent with */
  source: "response" | "request";
  /** The media type, without parameters */
  mimeType: string | null;
  viewMode: "pretty" | "raw";
  body: HttpBodyLoader;
  /** Whether the whole body has arrived */
  complete: boolean;
}

const defaultEditorHost: EditorHost = {
  ErrorBoundary,
  useDetailsBannerStoredValue: useInMemoryStoredValue,
  TextViewer,
  MultipartViewer,
  openUrl: null,
  copy: (text) => {
    navigator.clipboard.writeText(text).catch(console.error);
  },
  Editor: PlainEditor,
  Input: PlainInputEditor,
  Select,
  SelectFile: null,
  showDialog: null,
  showPrompt: null,
  basename: async (path) => path.split(/[\\/]/).pop() ?? null,
  useStoredValue: useInMemoryStoredValue,
};

const EditorHostContext = createContext<EditorHost>(defaultEditorHost);

export function EditorHostProvider({
  value,
  children,
}: {
  value: Partial<EditorHost>;
  children: ReactNode;
}) {
  const parent = useContext(EditorHostContext);
  const merged = useMemo(() => ({ ...parent, ...value }), [parent, value]);
  return <EditorHostContext.Provider value={merged}>{children}</EditorHostContext.Provider>;
}

export function useEditorHost(): EditorHost {
  return useContext(EditorHostContext);
}

/** Drops what only a host's editor understands, leaving what `CodeEditor` does */
function stripTemplating<T extends TemplatingProps & { language?: HostEditorLanguage }>({
  autocomplete: _autocomplete,
  autocompleteFunctions: _autocompleteFunctions,
  autocompleteVariables: _autocompleteVariables,
  forcedEnvironmentId: _forcedEnvironmentId,
  extraExtensions,
  language,
  ...props
}: T) {
  return {
    ...props,
    extensions: extraExtensions,
    language: language === "pairs" || language === "url" ? null : language,
  };
}

function PlainEditor(props: HostEditorProps) {
  return <LazyCodeEditor {...stripTemplating(props)} />;
}

function PlainInputEditor({ showOptionsPicker: _showOptionsPicker, ...props }: HostInputProps) {
  return <Input {...stripTemplating(props)} />;
}
