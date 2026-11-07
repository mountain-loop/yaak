//! Spans for syntax highlighting.

use crate::ast::Span;
use crate::lexer::{TokKind, lex};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "query.ts"))]
pub enum TokenKind {
    /// `@path:`, through the colon.
    Field,
    /// A field's value, quoted or not.
    Value,
    /// `OR` and `AND`.
    Operator,
    /// A quoted phrase in free text.
    Quote,
    Paren,
    /// A `-` that negates what follows it.
    Negation,
    /// A bare free-text word.
    Text,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export, export_to = "query.ts"))]
pub struct Token {
    pub kind: TokenKind,
    pub span: Span,
}

/// The highlighted pieces of `input`, in order. Whitespace is not covered.
pub fn tokens(input: &str) -> Vec<Token> {
    let mut out = Vec::new();
    let toks = lex(input);
    for (i, tok) in toks.iter().enumerate() {
        let kind = match &tok.kind {
            TokKind::LParen | TokKind::RParen => TokenKind::Paren,
            TokKind::Minus => {
                // The parser ignores a `-` with nothing to negate directly after it
                let negates = toks.get(i + 1).is_some_and(|next| {
                    next.span.start == tok.span.end
                        && !matches!(next.kind, TokKind::RParen | TokKind::Or | TokKind::And)
                });
                if negates { TokenKind::Negation } else { TokenKind::Text }
            }
            TokKind::Or | TokKind::And => TokenKind::Operator,
            TokKind::Word(_) => TokenKind::Text,
            TokKind::Phrase { .. } => TokenKind::Quote,
            TokKind::Field { path_span, value_span, .. } => {
                out.push(Token { kind: TokenKind::Field, span: *path_span });
                if value_span.start != value_span.end {
                    out.push(Token { kind: TokenKind::Value, span: *value_span });
                }
                continue;
            }
        };
        out.push(Token { kind, span: tok.span });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn show(input: &str) -> Vec<(TokenKind, &str)> {
        tokens(input).into_iter().map(|t| (t.kind, t.span.slice(input))).collect()
    }

    #[test]
    fn kinds_and_spans() {
        use TokenKind::*;
        assert_eq!(
            show("-@method:post OR (\"a b\" c) @url:"),
            vec![
                (Negation, "-"),
                (Field, "@method:"),
                (Value, "post"),
                (Operator, "OR"),
                (Paren, "("),
                (Quote, "\"a b\""),
                (Text, "c"),
                (Paren, ")"),
                (Field, "@url:"),
            ]
        );
        assert_eq!(
            show("@status:[400 TO 499]"),
            vec![(Field, "@status:"), (Value, "[400 TO 499]")]
        );
        assert_eq!(show("localhost:3000"), vec![(Text, "localhost:3000")]);
        assert_eq!(show(""), vec![]);
        // A `-` with nothing directly after it negates nothing
        assert_eq!(show("- a -"), vec![(Text, "-"), (Text, "a"), (Text, "-")]);
    }
}
