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

/** A read-only view of a selected file, ZIP archive, or directory. Paths are relative,
 * use forward slashes, and cannot escape the source. Valid only during onImportFiles. */
export interface ImportFiles {
  readonly name: string;
  readonly kind: "file" | "zip" | "directory";
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

type ImportTextHandler = (
  ctx: Context,
  args: { text: string },
) => MaybePromise<ImportPluginResponse | undefined>;

export type ImportFilesHandler = (
  ctx: Context,
  args: { files: ImportFiles },
) => MaybePromise<ImportPluginResponse | undefined>;

type ImporterHandlers = {
  /** Recommended import hook for files, ZIPs, directories, and pasted text. */
  onImportFiles: ImportFilesHandler;
  /** @deprecated Use onImportFiles. Only receives text; ignored when onImportFiles is defined. */
  onImport: ImportTextHandler;
};

/** Define at least one import hook. onImportFiles always takes precedence over onImport. */
export type ImporterPlugin = {
  name: string;
  description?: string;
} & Partial<ImporterHandlers> &
  (Pick<ImporterHandlers, "onImportFiles"> | Pick<ImporterHandlers, "onImport">);
