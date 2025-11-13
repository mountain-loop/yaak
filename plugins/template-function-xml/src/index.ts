import { DOMParser } from '@xmldom/xmldom';
import type { CallTemplateFunctionArgs, Context, PluginDefinition } from '@yaakapp/api';
import xpath from 'xpath';

const RETURN_FIRST = 'first';
const RETURN_ALL = 'all';
const RETURN_JOIN = 'join';

export const plugin: PluginDefinition = {
  templateFunctions: [
    {
      name: 'xml.xpath',
      description: 'Filter XML-formatted text using XPath syntax',
      args: [
        {
          type: 'text',
          name: 'input',
          label: 'Input',
          multiLine: true,
          placeholder: '<foo></foo>',
        },
        {
          type: 'h_stack',
          inputs: [
            {
              type: 'select',
              name: 'result',
              label: 'Return Format',
              defaultValue: RETURN_FIRST,
              options: [
                { label: 'First result', value: RETURN_FIRST },
                { label: 'All results', value: RETURN_ALL },
                { label: 'Join with separator', value: RETURN_JOIN },
              ],
            },
            {
              name: 'join',
              type: 'text',
              label: 'Separator',
              optional: true,
              defaultValue: ', ',
              dynamic(_ctx, args) {
                return { hidden: args.values.result !== RETURN_JOIN };
              },
            },
          ],
        },
        { type: 'text', name: 'query', label: 'Query', placeholder: '//foo' },
      ],
      async onRender(_ctx: Context, args: CallTemplateFunctionArgs): Promise<string | null> {
        try {
          const result = (args.values.result || RETURN_FIRST) as XPathResult;
          const join = args.values.join == null ? null : String(args.values.join);
          return filterXPath(String(args.values.input), String(args.values.query), result, join);
        } catch {
          return null;
        }
      },
    },
  ],
};

export type XPathResult = 'first' | 'join' | 'all';
export function filterXPath(
  body: string,
  path: string,
  result: XPathResult,
  join: string | null,
): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc: any = new DOMParser().parseFromString(body, 'text/xml');
  const items = xpath.select(path, doc, false);

  if (!Array.isArray(items)) {
    return String(items);
  } else if (!Array.isArray(items) || result === 'first') {
    return items[0] != null ? String(items[0].firstChild ?? '') : '';
  } else if (result === 'join') {
    return items.map((item) => String(item.firstChild ?? '')).join(join ?? '');
  } else {
    // Not sure what cases this happens in (?)
    return String(items);
  }
}
