import type { Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import { type ParseError, parse, printParseErrorCode } from "jsonc-parser";
import { replaceTemplateTags } from "../../../lib/templateTags";

// jsonc-parser reports error codes, so these are the words the editor shows for them
const MESSAGES: Record<string, string> = {
  InvalidSymbol: "Invalid symbol",
  InvalidNumberFormat: "Invalid number format",
  PropertyNameExpected: "Property name expected",
  ValueExpected: "Value expected",
  ColonExpected: "Colon expected",
  CommaExpected: "Comma expected",
  CloseBraceExpected: "Closing brace expected",
  CloseBracketExpected: "Closing bracket expected",
  EndOfFileExpected: "End of file expected",
  InvalidCommentToken: "Comments are not allowed",
  UnexpectedEndOfComment: "Unexpected end of comment",
  UnexpectedEndOfString: "Unexpected end of string",
  UnexpectedEndOfNumber: "Unexpected end of number",
  InvalidUnicode: "Invalid unicode sequence",
  InvalidEscapeCharacter: "Invalid escape character",
  InvalidCharacter: "Invalid character",
};

interface JsonLintOptions {
  allowComments?: boolean;
  allowTrailingCommas?: boolean;
}

export function jsonParseLinter(options?: JsonLintOptions) {
  return (view: EditorView): Diagnostic[] => {
    const doc = view.state.doc.toString();
    if (doc.trim() === "") return [];

    // We need lint to not break on stuff like {"foo:" ${[ ... ]}} so we'll replace all template
    // syntax with repeating `1` characters, so it's valid JSON and the position is still correct.
    const escapedDoc = replaceTemplateTags(doc, (m) => "1".repeat(m.end - m.start));

    const errors: ParseError[] = [];
    parse(escapedDoc, errors, {
      allowTrailingComma: options?.allowTrailingCommas ?? false,
      disallowComments: !(options?.allowComments ?? true),
    });

    // Later errors are mostly consequences of the first one, so only that one is shown
    const error = errors[0];
    if (error == null) return [];

    return [
      {
        from: error.offset,
        to: error.offset + error.length,
        severity: "error",
        message: MESSAGES[printParseErrorCode(error.error)] ?? "Invalid JSON",
      },
    ];
  };
}
