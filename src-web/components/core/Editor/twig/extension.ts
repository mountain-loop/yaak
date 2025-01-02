import type { LanguageSupport } from '@codemirror/language';
import { LRLanguage } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { parseMixed } from '@lezer/common';
import type { EnvironmentVariable } from '@yaakapp-internal/models';
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
  completionOptions,
  autocomplete,
  onClickVariable,
  onClickMissingVariable,
  extraExtensions,
}: {
  base: LanguageSupport;
  environmentVariables: EnvironmentVariable[];
  completionOptions: TwigCompletionOption[];
  autocomplete?: GenericCompletionConfig;
  onClickVariable: (option: EnvironmentVariable, tagValue: string, startPos: number) => void;
  onClickMissingVariable: (name: string, tagValue: string, startPos: number) => void;
  onClickPathParameter: (name: string) => void;
  extraExtensions: Extension[];
}) {
  const language = mixLanguage(base);

  const variableOptions: TwigCompletionOption[] =
    environmentVariables.map((v) => ({
      ...v,
      type: 'variable',
      label: v.name,
      onClick: (rawTag: string, startPos: number) => onClickVariable(v, rawTag, startPos),
    })) ?? [];

  const options = [...variableOptions, ...completionOptions];
  const completions = twigCompletion({ options });

  return [
    language,
    base.support,
    language.data.of({ autocomplete: completions }),
    base.language.data.of({ autocomplete: completions }),
    language.data.of({ autocomplete: genericCompletion(autocomplete) }),
    base.language.data.of({ autocomplete: genericCompletion(autocomplete) }),
    templateTagsPlugin(options, onClickMissingVariable),
    ...extraExtensions,
  ];
}

const mixedLanguagesCache: Record<string, LRLanguage> = {};

function mixLanguage(base: LanguageSupport): LRLanguage {
  // It can be slow to mix languages when there are hundreds of editors, so we'll cache them to speed it up
  const cached = mixedLanguagesCache[base.language.name];
  if (cached != null) {
    return cached;
  }

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

  const language = LRLanguage.define({ name, parser });
  mixedLanguagesCache[base.language.name] = language;
  return language;
}
