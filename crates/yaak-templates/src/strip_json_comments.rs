/// Strips JSON comments only if the result is valid JSON. If stripping comments
/// produces invalid JSON, the original text is returned unchanged.
pub fn maybe_strip_json_comments(text: &str) -> String {
    let stripped = strip_json_comments(text);
    if serde_json::from_str::<serde_json::Value>(&stripped).is_ok() {
        stripped
    } else {
        text.to_string()
    }
}

/// Strips comments from JSONC, preserving the original formatting as much as possible.
///
/// - Trailing comments on a line are removed (along with preceding whitespace)
/// - Whole-line comments are removed, including the line itself
/// - Block comments are removed, including any lines that become empty
/// - Comments inside strings and template tags are left alone
pub fn strip_json_comments(text: &str) -> String {
    let mut chars = text.chars().peekable();
    let mut result = String::with_capacity(text.len());
    let mut in_string = false;
    let mut in_template_tag = false;

    loop {
        let current_char = match chars.next() {
            None => break,
            Some(c) => c,
        };

        // Handle JSON strings
        if in_string {
            result.push(current_char);
            match current_char {
                '"' => in_string = false,
                '\\' => {
                    if let Some(c) = chars.next() {
                        result.push(c);
                    }
                }
                _ => {}
            }
            continue;
        }

        // Handle template tags
        if in_template_tag {
            result.push(current_char);
            if current_char == ']' && chars.peek() == Some(&'}') {
                result.push(chars.next().unwrap());
                in_template_tag = false;
            }
            continue;
        }

        // Check for template tag start
        if current_char == '$' && chars.peek() == Some(&'{') {
            let mut lookahead = chars.clone();
            lookahead.next(); // skip {
            if lookahead.peek() == Some(&'[') {
                in_template_tag = true;
                result.push(current_char);
                result.push(chars.next().unwrap()); // {
                result.push(chars.next().unwrap()); // [
                continue;
            }
        }

        // Check for line comment
        if current_char == '/' && chars.peek() == Some(&'/') {
            chars.next(); // skip second /
            // Consume until newline
            loop {
                match chars.peek() {
                    Some(&'\n') | None => break,
                    Some(_) => {
                        chars.next();
                    }
                }
            }
            // Trim trailing whitespace that preceded the comment
            let trimmed_len = result.trim_end_matches(|c: char| c == ' ' || c == '\t').len();
            result.truncate(trimmed_len);
            continue;
        }

        // Check for block comment
        if current_char == '/' && chars.peek() == Some(&'*') {
            chars.next(); // skip *
            // Consume until */
            loop {
                match chars.next() {
                    None => break,
                    Some('*') if chars.peek() == Some(&'/') => {
                        chars.next(); // skip /
                        break;
                    }
                    Some(_) => {}
                }
            }
            // Trim trailing whitespace that preceded the comment
            let trimmed_len = result.trim_end_matches(|c: char| c == ' ' || c == '\t').len();
            result.truncate(trimmed_len);
            // Skip whitespace/newline after the block comment if the next line is content
            // (this handles the case where the block comment is on its own line)
            continue;
        }

        if current_char == '"' {
            in_string = true;
        }

        result.push(current_char);
    }

    // Remove lines that are now empty (were comment-only lines)
    let result =
        result.lines().filter(|line| !line.trim().is_empty()).collect::<Vec<&str>>().join("\n");

    // Remove trailing commas before } or ]
    strip_trailing_commas(&result)
}

/// Removes trailing commas before closing braces/brackets, respecting strings.
fn strip_trailing_commas(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    let mut in_string = false;

    while i < chars.len() {
        let ch = chars[i];

        if in_string {
            result.push(ch);
            match ch {
                '"' => in_string = false,
                '\\' => {
                    i += 1;
                    if i < chars.len() {
                        result.push(chars[i]);
                    }
                }
                _ => {}
            }
            i += 1;
            continue;
        }

        if ch == '"' {
            in_string = true;
            result.push(ch);
            i += 1;
            continue;
        }

        if ch == ',' {
            // Look ahead past whitespace/newlines for } or ]
            let mut j = i + 1;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if j < chars.len() && (chars[j] == '}' || chars[j] == ']') {
                // Skip the comma
                i += 1;
                continue;
            }
        }

        result.push(ch);
        i += 1;
    }

    result
}

#[cfg(test)]
mod tests {
    use crate::strip_json_comments::strip_json_comments;

    #[test]
    fn test_no_comments() {
        let input = r#"{
  "foo": "bar",
  "baz": 123
}"#;
        assert_eq!(strip_json_comments(input), input);
    }

    #[test]
    fn test_trailing_line_comment() {
        assert_eq!(
            strip_json_comments(
                r#"{
  "foo": "bar", // this is a comment
  "baz": 123
}"#
            ),
            r#"{
  "foo": "bar",
  "baz": 123
}"#
        );
    }

    #[test]
    fn test_whole_line_comment() {
        assert_eq!(
            strip_json_comments(
                r#"{
  // this is a comment
  "foo": "bar"
}"#
            ),
            r#"{
  "foo": "bar"
}"#
        );
    }

    #[test]
    fn test_inline_block_comment() {
        assert_eq!(
            strip_json_comments(
                r#"{
  "foo": /* a comment */ "bar"
}"#
            ),
            r#"{
  "foo": "bar"
}"#
        );
    }

    #[test]
    fn test_whole_line_block_comment() {
        assert_eq!(
            strip_json_comments(
                r#"{
  /* a comment */
  "foo": "bar"
}"#
            ),
            r#"{
  "foo": "bar"
}"#
        );
    }

    #[test]
    fn test_multiline_block_comment() {
        assert_eq!(
            strip_json_comments(
                r#"{
  /**
   * Hello World!
   */
  "foo": "bar"
}"#
            ),
            r#"{
  "foo": "bar"
}"#
        );
    }

    #[test]
    fn test_comment_inside_string_preserved() {
        let input = r#"{
  "foo": "// not a comment",
  "bar": "/* also not */"
}"#;
        assert_eq!(strip_json_comments(input), input);
    }

    #[test]
    fn test_comment_inside_template_tag_preserved() {
        let input = r#"{
  "foo": ${[ fn("// hi", "/* hey */") ]}
}"#;
        assert_eq!(strip_json_comments(input), input);
    }

    #[test]
    fn test_multiple_comments() {
        assert_eq!(
            strip_json_comments(
                r#"{
  // first comment
  "foo": "bar", // trailing
  /* block */
  "baz": 123
}"#
            ),
            r#"{
  "foo": "bar",
  "baz": 123
}"#
        );
    }

    #[test]
    fn test_trailing_comma_after_comment_removed() {
        assert_eq!(
            strip_json_comments(
                r#"{
  "a": "aaa",
  // "b": "bbb"
}"#
            ),
            r#"{
  "a": "aaa"
}"#
        );
    }

    #[test]
    fn test_trailing_comma_in_array() {
        assert_eq!(strip_json_comments(r#"[1, 2, /* 3 */]"#), r#"[1, 2]"#);
    }

    #[test]
    fn test_comma_inside_string_preserved() {
        let input = r#"{"a": "hello,}"#;
        assert_eq!(strip_json_comments(input), input);
    }
}
