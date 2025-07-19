import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { history, historyKeymap } from '@codemirror/commands';
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

import { search, searchKeymap } from '@codemirror/search';
import type { Extension } from '@codemirror/state';
import { EditorState } from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import type { EnvironmentVariable } from '@yaakapp-internal/models';
import { graphql } from 'cm6-graphql';
import { activeRequestIdAtom } from '../../../hooks/useActiveRequestId';
import { jotaiStore } from '../../../lib/jotai';
import { renderMarkdown } from '../../../lib/markdown';
import { pluralizeCount } from '../../../lib/pluralize';
import { showGraphQLDocExplorerAtom } from '../../graphql/graphqlAtoms';
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

const closeBracketsExtensions: Extension = [closeBrackets(), keymap.of([...closeBracketsKeymap])];

const syntaxExtensions: Record<
  NonNullable<EditorProps['language']>,
  null | (() => LanguageSupport)
> = {
  graphql: null,
  json: json,
  javascript: javascript,
  // HTML as XML because HTML is oddly slow
  html: xml,
  xml: xml,
  url: url,
  pairs: pairs,
  text: text,
  markdown: markdown,
};

const closeBracketsFor: (keyof typeof syntaxExtensions)[] = ['json', 'javascript', 'graphql'];

export function getLanguageExtension({
  useTemplating,
  language = 'text',
  environmentVariables,
  autocomplete,
  onClickVariable,
  onClickMissingVariable,
  onClickPathParameter,
  completionOptions,
}: {
  useTemplating: boolean;
  environmentVariables: EnvironmentVariable[];
  onClickVariable: (option: EnvironmentVariable, tagValue: string, startPos: number) => void;
  onClickMissingVariable: (name: string, tagValue: string, startPos: number) => void;
  onClickPathParameter: (name: string) => void;
  completionOptions: TwigCompletionOption[];
} & Pick<EditorProps, 'language' | 'autocomplete'>) {
  const extraExtensions: Extension[] = [];

  if (language === 'url') {
    extraExtensions.push(pathParametersPlugin(onClickPathParameter));
  }

  // Only close brackets on languages that need it
  if (language && closeBracketsFor.includes(language)) {
    extraExtensions.push(closeBracketsExtensions);
  }

  // GraphQL is a special exception
  if (language === 'graphql') {
    return [
      graphql(undefined, {
        async onCompletionInfoRender(gqlCompletionItem): Promise<Node | null> {
          if (!gqlCompletionItem.documentation) return null;
          const innerHTML = await renderMarkdown(gqlCompletionItem.documentation);
          const span = document.createElement('span');
          span.innerHTML = innerHTML;
          return span;
        },
        onShowInDocs(field, type, parentType) {
          const activeRequestId = jotaiStore.get(activeRequestIdAtom);
          if (activeRequestId == null) return;
          jotaiStore.set(showGraphQLDocExplorerAtom, (v) => ({
            ...v,
            [activeRequestId]: { field, type, parentType },
          }));
        },
      }),
      extraExtensions,
    ];
  }

  const base_ = syntaxExtensions[language ?? 'text'] ?? text();
  const base = typeof base_ === 'function' ? base_() : text();

  if (!useTemplating) {
    return [base, extraExtensions];
  }

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

export const readonlyExtensions = [
  EditorState.readOnly.of(true),
  EditorView.contentAttributes.of({ tabindex: '-1' }),
];

export const multiLineExtensions = ({ hideGutter }: { hideGutter?: boolean }) => [
  search({ top: true }),
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
  indentOnInput(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLineGutter(),
  keymap.of([...searchKeymap, ...foldKeymap, ...lintKeymap]),
];
