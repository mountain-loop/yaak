import type { FilterPlugin } from './FilterPlugin';
import type { HttpRequestActionPlugin } from './HttpRequestActionPlugin';
import type { ImporterPlugin } from './ImporterPlugin';
import type { TemplateFunctionPlugin } from './TemplateFunctionPlugin';
import type { ThemePlugin } from './ThemePlugin';

export type { Context } from './Context';

/**
 * The global structure of a Yaak plugin
 */
export type PluginDefinition = {
  importer?: ImporterPlugin;
  theme?: ThemePlugin;
  filter?: FilterPlugin;
  httpRequestActions?: HttpRequestActionPlugin[];
  templateFunctions?: TemplateFunctionPlugin[];
};
