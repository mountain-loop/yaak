import type { LanguageSupport } from '@codemirror/language';
import { LRLanguage } from '@codemirror/language';
import { parseMixed } from '@lezer/common';
import type { EnvironmentVariable } from '@yaakapp-internal/models';
import type { TemplateFunction } from '@yaakapp-internal/plugins';
import type { GenericCompletionConfig } from '../genericCompletion';
import { genericCompletion } from '../genericCompletion';
import { textLanguageName } from '../text/extension';
import type { TwigCompletionOption } from './completion';
import { twigCompletion } from './completion';
import { templateTagsPlugin } from './templateTags';
import { parser as twigParser } from './twig';

export function twig({
  base,
  environmentVariables,
  templateFunctions,
  autocomplete,
  onClickFunction,
  onClickVariable,
  onClickMissingVariable,
  onClickPathParameter,
}: {
  base: LanguageSupport;
  environmentVariables: EnvironmentVariable[];
  templateFunctions: TemplateFunction[];
  autocomplete?: GenericCompletionConfig;
  onClickFunction: (option: TemplateFunction, tagValue: string, startPos: number) => void;
  onClickVariable: (option: EnvironmentVariable, tagValue: string, startPos: number) => void;
  onClickMissingVariable: (name: string, tagValue: string, startPos: number) => void;
  onClickPathParameter: (name: string) => void;
}) {
  const language = mixLanguage(base);

  const variableOptions: TwigCompletionOption[] =
    environmentVariables.map((v) => ({
      ...v,
      type: 'variable',
      label: v.name,
      onClick: (rawTag: string, startPos: number) => onClickVariable(v, rawTag, startPos),
    })) ?? [];

  const functionOptions: TwigCompletionOption[] =
    templateFunctions.map((fn) => {
      const NUM_ARGS = 2;
      const shortArgs =
        fn.args
          .slice(0, NUM_ARGS)
          .map((a) => a.name)
          .join(', ') + (fn.args.length > NUM_ARGS ? ', …' : '');
      return {
        name: fn.name,
        aliases: fn.aliases,
        type: 'function',
        description: fn.description,
        args: fn.args.map((a) => ({ name: a.name })),
        value: null,
        label: `${fn.name}(${shortArgs})`,
        onClick: (rawTag: string, startPos: number) => onClickFunction(fn, rawTag, startPos),
      };
    }) ?? [];

  const options = [...variableOptions, ...functionOptions];

  const completions = twigCompletion({ options });

  return [
    language,
    base.support,
    language.data.of({ autocomplete: completions }),
    base.language.data.of({ autocomplete: completions }),
    language.data.of({ autocomplete: genericCompletion(autocomplete) }),
    base.language.data.of({ autocomplete: genericCompletion(autocomplete) }),
    templateTagsPlugin(options, onClickMissingVariable, onClickPathParameter),
  ];
}

function mixLanguage(base: LanguageSupport): LRLanguage {
  const name = 'twig';

  const parser = twigParser.configure({
    wrap: parseMixed((node) => {
      // If the base language is text, we can overwrite at the top
      if (base.language.name !== textLanguageName && !node.type.isTop) {
        return null;
      }

      return {
        parser: base.language.parser,
        overlay: (node) => node.type.name === 'Text',
      };
    }),
  });

  return LRLanguage.define({ name, parser });
}
