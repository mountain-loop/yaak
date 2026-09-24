import type { ImportResources, ImportResponse } from "../bindings/gen_events";
import type { AtLeast, MaybePromise } from "../helpers";
import type { Context } from "./Context";

type RootFields = "name" | "id" | "model";
type CommonFields = RootFields | "workspaceId";

export type PartialImportResources = {
  workspaces: Array<AtLeast<ImportResources["workspaces"][0], RootFields>>;
  environments: Array<AtLeast<ImportResources["environments"][0], CommonFields>>;
  folders: Array<AtLeast<ImportResources["folders"][0], CommonFields>>;
  httpRequests: Array<AtLeast<ImportResources["httpRequests"][0], CommonFields>>;
  grpcRequests: Array<AtLeast<ImportResources["grpcRequests"][0], CommonFields>>;
  websocketRequests: Array<AtLeast<ImportResources["websocketRequests"][0], CommonFields>>;
};

/** `importer` is omitted because the host fills it in from the plugin's own name. */
export type ImportPluginResponse =
  | null
  | (Omit<ImportResponse, "importer" | "resources"> & {
      resources: PartialImportResources;
    });

/** A read-only view of a selected directory or ZIP archive. Paths are relative and use
 * forward slashes. Directory path checks are best-effort under concurrent filesystem
 * changes, not a security boundary. Valid only while onImportSource runs. */
export interface ImportFiles {
  readonly name: string;
  readonly kind: "zip" | "directory";
  /** List immediate children. The root directory is "" (the default). */
  readDir(path?: string): Promise<ImportFileEntry[]>;
  readFile(path: string): Promise<Uint8Array>;
  /** Decode UTF-8 strictly; binary or invalid UTF-8 content throws. */
  readTextFile(path: string): Promise<string>;
}

export interface ImportFileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

/** What the user chose to import: one text document, or a directory or ZIP read as a tree. */
export type ImportSource =
  | { type: "text"; name: string; text: string }
  | { type: "directory"; files: ImportFiles };

type ImportTextHandler = (
  ctx: Context,
  args: { text: string },
) => MaybePromise<ImportPluginResponse | undefined>;

export type ImportSourceHandler = (
  ctx: Context,
  args: { source: ImportSource },
) => MaybePromise<ImportPluginResponse | undefined>;

export type ImporterPlugin = {
  name: string;
  description?: string;
  /** Return null when the source isn't this importer's format. Takes precedence over onImport. */
  onImportSource?: ImportSourceHandler;
  /** @deprecated Use onImportSource. Only receives single text documents. */
  onImport?: ImportTextHandler;
};
