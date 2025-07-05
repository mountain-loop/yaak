import { ImportResources } from '../bindings/gen_events';
import { AtLeast, MaybePromise } from '../helpers';
import type { Context } from './Context';

type RootFields = 'name' | 'id' | 'model';
type CommonFields = RootFields | 'workspaceId';

export type PartialImportResources = {
  workspaces: Array<AtLeast<ImportResources['workspaces'][0], RootFields>>;
  environments: Array<AtLeast<ImportResources['environments'][0], CommonFields>>;
  folders: Array<AtLeast<ImportResources['folders'][0], CommonFields>>;
  httpRequests: Array<AtLeast<ImportResources['httpRequests'][0], CommonFields>>;
  grpcRequests: Array<AtLeast<ImportResources['grpcRequests'][0], CommonFields>>;
  websocketRequests: Array<AtLeast<ImportResources['websocketRequests'][0], CommonFields>>;
};

export type ImportPluginResponse = null | {
  resources: PartialImportResources;
};

export type ImporterPlugin = {
  name: string;
  description?: string;
  onImport(
    ctx: Context,
    args: { text: string },
  ): MaybePromise<ImportPluginResponse | null | undefined>;
};
