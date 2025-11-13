import { AuthenticationPlugin } from './AuthenticationPlugin';

import type { Context } from './Context';
import type { FilterPlugin } from './FilterPlugin';
import { GrpcRequestActionPlugin } from './GrpcRequestActionPlugin';
import type { HttpRequestActionPlugin } from './HttpRequestActionPlugin';
import type { ImporterPlugin } from './ImporterPlugin';
import type { TemplateFunctionPlugin } from './TemplateFunctionPlugin';
import type { ThemePlugin } from './ThemePlugin';

export type { Context };
export type { DynamicTemplateFunctionArg } from './TemplateFunctionPlugin';
export type { DynamicAuthenticationArg } from './AuthenticationPlugin';
export type { TemplateFunctionPlugin };

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
  grpcRequestActions?: GrpcRequestActionPlugin[];
  templateFunctions?: TemplateFunctionPlugin[];
};
