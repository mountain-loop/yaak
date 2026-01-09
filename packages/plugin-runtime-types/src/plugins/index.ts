import type { AuthenticationPlugin } from './AuthenticationPlugin';

import type { Context } from './Context';
import type { FilterPlugin } from './FilterPlugin';
import type { GrpcRequestActionPlugin } from './GrpcRequestActionPlugin';
import type { HttpRequestActionPlugin } from './HttpRequestActionPlugin';
import type { WebsocketRequestActionPlugin } from './WebsocketRequestActionPlugin';
import type { WorkspaceActionPlugin } from './WorkspaceActionPlugin';
import type { FolderActionPlugin } from './FolderActionPlugin';
import type { ImporterPlugin } from './ImporterPlugin';
import type { TemplateFunctionPlugin } from './TemplateFunctionPlugin';
import type { ThemePlugin } from './ThemePlugin';

export type { Context };
export type { DynamicTemplateFunctionArg } from './TemplateFunctionPlugin';
export type { DynamicAuthenticationArg } from './AuthenticationPlugin';
export type { TemplateFunctionPlugin };
export type { WorkspaceActionPlugin } from './WorkspaceActionPlugin';
export type { FolderActionPlugin } from './FolderActionPlugin';

/**
 * The global structure of a Yaak plugin
 */
export type PluginDefinition = {
  init?: (ctx: Context) => void | Promise<void>;
  dispose?: () => void | Promise<void>;
  importer?: ImporterPlugin;
  themes?: ThemePlugin[];
  filter?: FilterPlugin;
  authentication?: AuthenticationPlugin;
  httpRequestActions?: HttpRequestActionPlugin[];
  websocketRequestActions?: WebsocketRequestActionPlugin[];
  workspaceActions?: WorkspaceActionPlugin[];
  folderActions?: FolderActionPlugin[];
  grpcRequestActions?: GrpcRequestActionPlugin[];
  templateFunctions?: TemplateFunctionPlugin[];
};
