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

export type ImporterPlugin = {
  name: string;
  description?: string;
  onImport(
    ctx: Context,
    args: { text: string },
  ): MaybePromise<ImportPluginResponse | null | undefined>;
};
