export type { CodeEditorProps } from "./components/editor/CodeEditor";
export { CodeEditor } from "./components/editor/CodeEditor";
export type { LanguageSupports } from "./components/editor/extensions";
export type { FieldDef, FilterOptions } from "./components/editor/filter/extension";
export {
  filterAutocomplete,
  makeCompletionSource as filterCompletionSource,
} from "./components/editor/filter/extension";
export type { QueryFilterOptions, QueryProblem } from "./components/editor/query/extension";
export { queryFilter } from "./components/editor/query/extension";
export {
  closeBracketsExtensions,
  getLanguageExtension,
  readonlyExtensions,
  syntaxExtensions,
  syntaxHighlightStyle,
} from "./components/editor/extensions";
export type { JsonLintOptions } from "./components/editor/json-lint";
export { jsonParseLinter } from "./components/editor/json-lint";
export { searchMatchCount } from "./components/editor/searchMatchCount";
export { singleLineExtensions } from "./components/editor/singleLine";
export { text, textLanguage } from "./components/editor/text/extension";
