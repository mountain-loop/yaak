import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import type { LanguageSupport } from '@codemirror/language';
import {
  codeFolding,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { lintKeymap } from '@codemirror/lint';

import { searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import type { EnvironmentVariable } from '@yaakapp-internal/models';
import { graphql } from 'cm6-graphql';
import { EditorView } from 'codemirror';
import { pluralizeCount } from '../../../lib/pluralize';
import type { EditorProps } from './Editor';
import { pairs } from './pairs/extension';
import { text } from './text/extension';
import type { TwigCompletionOption } from './twig/completion';
import { twig } from './twig/extension';
import { pathParametersPlugin } from './twig/pathParameters';
import { url } from './url/extension';

export const syntaxHighlightStyle = HighlightStyle.define([
  {
    tag: [t.documentMeta, t.blockComment, t.lineComment, t.docComment, t.comment],
    color: 'var(--textSubtlest)',
    fontStyle: 'italic',
  },
  {
    tag: [t.emphasis],
    textDecoration: 'underline',
  },
  {
    tag: [t.paren, t.bracket, t.squareBracket, t.brace, t.separator],
    color: 'var(--textSubtle)',
  },
  {
    tag: [t.link, t.name, t.tagName, t.angleBracket, t.docString, t.number],
    color: 'var(--info)',
  },
  { tag: [t.variableName], color: 'var(--success)' },
  { tag: [t.bool], color: 'var(--warning)' },
  { tag: [t.attributeName, t.propertyName], color: 'var(--primary)' },
  { tag: [t.attributeValue], color: 'var(--warning)' },
  { tag: [t.string], color: 'var(--notice)' },
  { tag: [t.atom, t.meta, t.operator, t.bool, t.null, t.keyword], color: 'var(--danger)' },
]);

const syntaxTheme = EditorView.theme({}, { dark: true });

const syntaxExtensions: Record<NonNullable<EditorProps['language']>, LanguageSupport | null> = {
  graphql: null,
  json: json(),
  javascript: javascript(),
  html: xml(), // HTML as XML because HTML is oddly slow
  xml: xml(),
  url: url(),
  pairs: pairs(),
  text: text(),
  markdown: markdown(),
};

export function getLanguageExtension({
  language,
  useTemplating = false,
  environmentVariables,
  autocomplete,
  onClickVariable,
  onClickMissingVariable,
  onClickPathParameter,
  completionOptions,
}: {
  environmentVariables: EnvironmentVariable[];
  onClickVariable: (option: EnvironmentVariable, tagValue: string, startPos: number) => void;
  onClickMissingVariable: (name: string, tagValue: string, startPos: number) => void;
  onClickPathParameter: (name: string) => void;
  completionOptions: TwigCompletionOption[];
} & Pick<EditorProps, 'language' | 'useTemplating' | 'autocomplete'>) {
  if (language === 'graphql') {
    return graphql();
  }

  const base = syntaxExtensions[language ?? 'text'] ?? text();
  if (!useTemplating) {
    return base;
  }

  const extraExtensions = language === 'url' ? [pathParametersPlugin(onClickPathParameter)] : [];

  return twig({
    base,
    environmentVariables,
    completionOptions,
    autocomplete,
    onClickVariable,
    onClickMissingVariable,
    onClickPathParameter,
    extraExtensions,
  });
}

export const baseExtensions = [
  highlightSpecialChars(),
  history(),
  dropCursor(),
  drawSelection(),
  autocompletion({
    tooltipClass: () => 'x-theme-menu',
    closeOnBlur: true, // Set to `false` for debugging in devtools without closing it
    compareCompletions: (a, b) => {
      // Don't sort completions at all, only on boost
      return (a.boost ?? 0) - (b.boost ?? 0);
    },
  }),
  syntaxHighlighting(syntaxHighlightStyle),
  syntaxTheme,
  keymap.of([...historyKeymap, ...completionKeymap]),
];

export const multiLineExtensions = ({ hideGutter }: { hideGutter?: boolean }) => [
  hideGutter
    ? []
    : [
        lineNumbers(),
        foldGutter({
          markerDOM: (open) => {
            const el = document.createElement('div');
            el.classList.add('fold-gutter-icon');
            el.tabIndex = -1;
            if (open) {
              el.setAttribute('data-open', '');
            }
            return el;
          },
        }),
      ],
  codeFolding({
    placeholderDOM(_view, onclick, prepared) {
      const el = document.createElement('span');
      el.onclick = onclick;
      el.className = 'cm-foldPlaceholder';
      el.innerText = prepared || '…';
      el.title = 'unfold';
      el.ariaLabel = 'folded code';
      return el;
    },
    /**
     * Show the number of items when code folded. NOTE: this doesn't get called when restoring
     * a previous serialized editor state, which is a bummer
     */
    preparePlaceholder(state, range) {
      let count: number | undefined;
      let startToken = '{';
      let endToken = '}';

      const prevLine = state.doc.lineAt(range.from).text;
      const isArray = prevLine.lastIndexOf('[') > prevLine.lastIndexOf('{');

      if (isArray) {
        startToken = '[';
        endToken = ']';
      }

      const internal = state.sliceDoc(range.from, range.to);
      const toParse = startToken + internal + endToken;

      try {
        const parsed = JSON.parse(toParse);
        count = Object.keys(parsed).length;
      } catch {
        /* empty */
      }

      if (count !== undefined) {
        const label = isArray ? 'item' : 'key';
        return pluralizeCount(label, count);
      }
    },
  }),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  closeBrackets(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLineGutter(),
  keymap.of([indentWithTab, ...closeBracketsKeymap, ...searchKeymap, ...foldKeymap, ...lintKeymap]),
];
