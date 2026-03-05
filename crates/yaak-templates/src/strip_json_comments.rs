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
    result
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<&str>>()
        .join("\n")
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
            strip_json_comments(r#"{
  "foo": "bar", // this is a comment
  "baz": 123
}"#),
            r#"{
  "foo": "bar",
  "baz": 123
}"#
        );
    }

    #[test]
    fn test_whole_line_comment() {
        assert_eq!(
            strip_json_comments(r#"{
  // this is a comment
  "foo": "bar"
}"#),
            r#"{
  "foo": "bar"
}"#
        );
    }

    #[test]
    fn test_inline_block_comment() {
        assert_eq!(
            strip_json_comments(r#"{
  "foo": /* a comment */ "bar"
}"#),
            r#"{
  "foo": "bar"
}"#
        );
    }

    #[test]
    fn test_whole_line_block_comment() {
        assert_eq!(
            strip_json_comments(r#"{
  /* a comment */
  "foo": "bar"
}"#),
            r#"{
  "foo": "bar"
}"#
        );
    }

    #[test]
    fn test_multiline_block_comment() {
        assert_eq!(
            strip_json_comments(r#"{
  /**
   * Hello World!
   */
  "foo": "bar"
}"#),
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
            strip_json_comments(r#"{
  // first comment
  "foo": "bar", // trailing
  /* block */
  "baz": 123
}"#),
            r#"{
  "foo": "bar",
  "baz": 123
}"#
        );
    }
}
