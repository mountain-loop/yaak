import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { history, historyKeymap } from "@codemirror/commands";
import { go } from "@codemirror/lang-go";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  LanguageSupport,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { c, csharp, kotlin, objectiveC } from "@codemirror/legacy-modes/mode/clike";
import { clojure } from "@codemirror/legacy-modes/mode/clojure";
import { http } from "@codemirror/legacy-modes/mode/http";
import { oCaml } from "@codemirror/legacy-modes/mode/mllike";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { r } from "@codemirror/legacy-modes/mode/r";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { linter, lintGutter, lintKeymap } from "@codemirror/lint";
import { search, searchKeymap } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
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
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { jsonc, jsoncLanguage } from "@shopify/lang-jsonc";
import { pluralizeCount } from "@yaakapp-internal/lib/pluralize";
import type { EditorLanguage } from "@yaakapp-internal/plugins";
import { jsonParseLinter } from "./json-lint";
import { searchMatchCount } from "./searchMatchCount";
import { text } from "./text/extension";

export const syntaxHighlightStyle = HighlightStyle.define([
  {
    tag: [t.documentMeta, t.blockComment, t.lineComment, t.docComment, t.comment],
    color: "var(--textSubtlest)",
  },
  {
    tag: [t.emphasis],
    textDecoration: "underline",
  },
  {
    tag: [t.angleBracket, t.paren, t.bracket, t.squareBracket, t.brace, t.separator, t.punctuation],
    color: "var(--textSubtle)",
  },
  {
    tag: [t.link, t.name, t.tagName, t.angleBracket, t.docString, t.number],
    color: "var(--info)",
  },
  { tag: [t.variableName], color: "var(--success)" },
  { tag: [t.bool], color: "var(--warning)" },
  { tag: [t.attributeName, t.propertyName], color: "var(--primary)" },
  { tag: [t.attributeValue], color: "var(--warning)" },
  { tag: [t.string], color: "var(--notice)" },
  { tag: [t.atom, t.meta, t.operator, t.bool, t.null, t.keyword], color: "var(--danger)" },
]);

const syntaxTheme = EditorView.theme({}, { dark: true });

export const closeBracketsExtensions: Extension = [
  closeBrackets(),
  keymap.of([...closeBracketsKeymap]),
];

const legacyLang = (mode: Parameters<typeof StreamLanguage.define>[0]) => {
  return () => new LanguageSupport(StreamLanguage.define(mode));
};

export type LanguageSupports = Record<string, null | (() => LanguageSupport)>;

export const syntaxExtensions: Record<EditorLanguage, null | (() => LanguageSupport)> = {
  graphql: null,
  json: jsonc,
  javascript: javascript,
  // HTML as XML because HTML is oddly slow
  html: xml,
  xml: xml,
  text: text,
  markdown: markdown,
  c: legacyLang(c),
  clojure: legacyLang(clojure),
  csharp: legacyLang(csharp),
  go: go,
  http: legacyLang(http),
  java: java,
  kotlin: legacyLang(kotlin),
  objective_c: legacyLang(objectiveC),
  ocaml: legacyLang(oCaml),
  php: php,
  powershell: legacyLang(powerShell),
  python: python,
  r: legacyLang(r),
  ruby: legacyLang(ruby),
  shell: legacyLang(shell),
  swift: legacyLang(swift),
};

const closeBracketsFor: string[] = ["json", "javascript", "graphql"];

export function getLanguageExtension({
  language = "text",
  lintExtension,
  hideGutter,
  languages = syntaxExtensions,
  extraExtensions: hostExtensions = [],
  wrap,
}: {
  language?: string | null;
  lintExtension?: Extension;
  hideGutter?: boolean;
  /** Language supports by name, for a host with languages of its own */
  languages?: LanguageSupports;
  extraExtensions?: Extension[];
  /** Wraps the base language, as a templating language does */
  wrap?: (base: LanguageSupport, extraExtensions: Extension[]) => Extension;
}): Extension {
  const extraExtensions: Extension[] = [...hostExtensions];

  // Only close brackets on languages that need it
  if (language && closeBracketsFor.includes(language)) {
    extraExtensions.push(closeBracketsExtensions);
  }

  if (language === "json") {
    extraExtensions.push(lintExtension ?? linter(jsonParseLinter()));
    extraExtensions.push(
      jsoncLanguage.data.of({
        commentTokens: { line: "//", block: { open: "/*", close: "*/" } },
      }),
    );
    if (!hideGutter) {
      extraExtensions.push(lintGutter());
    }
  }

  const maybeBase = language ? languages[language] : null;
  const base = typeof maybeBase === "function" ? maybeBase() : null;
  if (base == null) {
    return [];
  }

  return wrap ? wrap(base, extraExtensions) : [base, extraExtensions];
}

// Filter out autocomplete start triggers from completionKeymap since we handle it via configurable hotkeys.
// Keep navigation keys (ArrowUp/Down, Enter, Escape, etc.) but remove startCompletion bindings.
const filteredCompletionKeymap = completionKeymap.filter((binding) => {
  const key = binding.key?.toLowerCase() ?? "";
  const mac = (binding as { mac?: string }).mac?.toLowerCase() ?? "";
  // Filter out Ctrl-Space and Mac-specific autocomplete triggers (Alt-`, Alt-i)
  const isStartTrigger = key.includes("space") || mac.includes("alt-") || mac.includes("`");
  return !isStartTrigger;
});

export const baseExtensions = [
  highlightSpecialChars(),
  history(),
  dropCursor(),
  drawSelection(),
  autocompletion({
    tooltipClass: () => "x-theme-menu",
    closeOnBlur: true, // Set to `false` for debugging in devtools without closing it
    defaultKeymap: false, // We handle the trigger via configurable hotkeys
    compareCompletions: (a, b) => {
      // Don't sort completions at all, only on boost
      return (a.boost ?? 0) - (b.boost ?? 0);
    },
  }),
  syntaxHighlighting(syntaxHighlightStyle),
  syntaxTheme,
  keymap.of([...historyKeymap, ...filteredCompletionKeymap]),
];

export const readonlyExtensions = [
  EditorState.readOnly.of(true),
  EditorView.contentAttributes.of({ tabindex: "-1" }),
];

export const editableExtensions: Extension[] = [];

export const multiLineExtensions = ({ hideGutter }: { hideGutter?: boolean }) => [
  search({ top: true }),
  searchMatchCount(),
  hideGutter
    ? []
    : [
        lineNumbers(),
        foldGutter({
          markerDOM: (open) => {
            const el = document.createElement("div");
            el.classList.add("fold-gutter-icon");
            el.tabIndex = -1;
            if (open) {
              el.setAttribute("data-open", "");
            }
            return el;
          },
        }),
      ],
  codeFolding({
    placeholderDOM(_view, onclick, prepared) {
      const el = document.createElement("span");
      el.onclick = onclick;
      el.className = "cm-foldPlaceholder";
      el.innerText = prepared || "…";
      el.title = "unfold";
      el.ariaLabel = "folded code";
      return el;
    },
    /**
     * Show the number of items when code folded. NOTE: this doesn't get called when restoring
     * a previous serialized editor state, which is a bummer
     */
    preparePlaceholder(state, range) {
      let count: number | undefined;
      let startToken = "{";
      let endToken = "}";

      const prevLine = state.doc.lineAt(range.from).text;
      const isArray = prevLine.lastIndexOf("[") > prevLine.lastIndexOf("{");

      if (isArray) {
        startToken = "[";
        endToken = "]";
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
        const label = isArray ? "item" : "key";
        return pluralizeCount(label, count);
      }
    },
  }),
  indentOnInput(),
  rectangularSelection(),
  crosshairCursor(),
  bracketMatching(),
  highlightActiveLineGutter(),
  keymap.of([...searchKeymap, ...foldKeymap, ...lintKeymap]),
];
