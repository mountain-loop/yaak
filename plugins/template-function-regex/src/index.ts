import { TemplateFunction } from 'yaak-meta-node';
import { isSafe } from 'redos-detector';

const regexTemplateFunction: TemplateFunction = {
  name: 'regex',
  description: 'Executes a regular expression on a string and returns the first match.',
  example: '{{ regex(response.body, "[0-9]+") }}',
  fn: (text: unknown, ...args: unknown[]) => {
    if (typeof text !== 'string') {
      return '';
    }
    if (args.length === 0) {
      return '';
    }
    if (typeof args[0] !== 'string') {
      return '';
    }

    try {
      const pattern = args[0] as string;
      const regex = new RegExp(pattern);

      if (!isSafe(regex)) {
        // eslint-disable-next-line no-console
        console.warn(`[yaak-plugin-template-function-regex] Unsafe regex pattern detected and blocked: ${pattern}`);
        return '';
      }

      const match = text.match(regex);
      if (match) {
        return match[0];
      }
    } catch (err) {
      // do nothing
    }
    return '';
  },
};

export default regexTemplateFunction;
