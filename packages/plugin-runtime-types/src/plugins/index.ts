import { AuthenticationPlugin } from './AuthenticationPlugin';
import type { FilterPlugin } from './FilterPlugin';
import { GrpcRequestActionPlugin } from './GrpcRequestActionPlugin';
import type { HttpRequestActionPlugin } from './HttpRequestActionPlugin';
import type { ImporterPlugin } from './ImporterPlugin';
import type { TemplateFunctionPlugin } from './TemplateFunctionPlugin';
import type { ThemePlugin } from './ThemePlugin';

import type { Context } from './Context';

export type { Context };

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
