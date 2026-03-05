enum FormatState {
    TemplateTag,
    String,
    None,
}

/// Formats JSON that might contain template tags (skipped entirely)
pub fn format_json(text: &str, tab: &str) -> String {
    let mut chars = text.chars().peekable();

    let mut new_json = "".to_string();
    let mut depth = 0;
    let mut state = FormatState::None;
    let mut saw_newline_in_whitespace = false;

    loop {
        let rest_of_chars = chars.clone();
        let current_char = match chars.next() {
            None => break,
            Some(c) => c,
        };

        // Handle JSON string states
        if let FormatState::String = state {
            match current_char {
                '"' => {
                    state = FormatState::None;
                    new_json.push(current_char);
                    continue;
                }
                '\\' => {
                    new_json.push(current_char);
                    if let Some(c) = chars.next() {
                        new_json.push(c);
                    }
                    continue;
                }
                _ => {
                    new_json.push(current_char);
                    continue;
                }
            }
        }
        // Close Template tag states
        if let FormatState::TemplateTag = state {
            if rest_of_chars.take(2).collect::<String>() == "]}" {
                state = FormatState::None;
                new_json.push_str("]}");
                chars.next(); // Skip the second closing bracket
                continue;
            } else {
                new_json.push(current_char);
                continue;
            }
        }

        if rest_of_chars.take(3).collect::<String>() == "${[" {
            state = FormatState::TemplateTag;
            new_json.push_str("${[");
            chars.next(); // Skip {
            chars.next(); // Skip [
            continue;
        }

        // Handle line comments (//)
        if current_char == '/' && chars.peek() == Some(&'/') {
            chars.next(); // Skip second /
            // Collect the rest of the comment until newline
            let mut comment = String::from("//");
            loop {
                match chars.peek() {
                    Some(&'\n') | None => break,
                    Some(_) => comment.push(chars.next().unwrap()),
                }
            }
            // Check if the comma handler already added \n + indent
            let trimmed = new_json.trim_end_matches(|c: char| c == ' ' || c == '\t');
            if trimmed.ends_with(",\n") && !saw_newline_in_whitespace {
                // Trailing comment on the same line as comma (e.g. "foo",// comment)
                new_json.truncate(trimmed.len() - 1);
                new_json.push(' ');
            } else if !trimmed.ends_with('\n') && !new_json.is_empty() {
                // Trailing comment after a value (no newline before us)
                new_json.push(' ');
            }
            new_json.push_str(&comment);
            new_json.push('\n');
            new_json.push_str(tab.to_string().repeat(depth).as_str());
            saw_newline_in_whitespace = false;
            continue;
        }

        // Handle block comments (/* ... */)
        if current_char == '/' && chars.peek() == Some(&'*') {
            chars.next(); // Skip *
            let mut comment = String::from("/*");
            loop {
                match chars.next() {
                    None => break,
                    Some('*') if chars.peek() == Some(&'/') => {
                        chars.next(); // Skip /
                        comment.push_str("*/");
                        break;
                    }
                    Some(c) => comment.push(c),
                }
            }
            // If we're not already on a fresh line, add newline + indent before comment
            let trimmed = new_json.trim_end_matches(|c: char| c == ' ' || c == '\t');
            if !trimmed.is_empty() && !trimmed.ends_with('\n') {
                new_json.push('\n');
                new_json.push_str(tab.to_string().repeat(depth).as_str());
            }
            new_json.push_str(&comment);
            // After block comment, add newline + indent for the next content
            new_json.push('\n');
            new_json.push_str(tab.to_string().repeat(depth).as_str());
            continue;
        }

        match current_char {
            ',' => {
                new_json.push(current_char);
                new_json.push('\n');
                new_json.push_str(tab.to_string().repeat(depth).as_str());
            }
            '{' => match chars.peek() {
                Some('}') => {
                    new_json.push(current_char);
                    new_json.push('}');
                    chars.next(); // Skip }
                }
                _ => {
                    depth += 1;
                    new_json.push(current_char);
                    new_json.push('\n');
                    new_json.push_str(tab.to_string().repeat(depth).as_str());
                }
            },
            '[' => match chars.peek() {
                Some(']') => {
                    new_json.push(current_char);
                    new_json.push(']');
                    chars.next(); // Skip ]
                }
                _ => {
                    depth += 1;
                    new_json.push(current_char);
                    new_json.push('\n');
                    new_json.push_str(tab.to_string().repeat(depth).as_str());
                }
            },
            '}' => {
                // Guard just in case invalid JSON has more closes than opens
                if depth > 0 {
                    depth -= 1;
                }
                new_json.push('\n');
                new_json.push_str(tab.to_string().repeat(depth).as_str());
                new_json.push(current_char);
            }
            ']' => {
                // Guard just in case invalid JSON has more closes than opens
                if depth > 0 {
                    depth -= 1;
                }
                new_json.push('\n');
                new_json.push_str(tab.to_string().repeat(depth).as_str());
                new_json.push(current_char);
            }
            ':' => {
                new_json.push(current_char);
                new_json.push(' '); // Pad with space
            }
            '"' => {
                state = FormatState::String;
                new_json.push(current_char);
            }
            _ => {
                if current_char == ' '
                    || current_char == '\n'
                    || current_char == '\t'
                    || current_char == '\r'
                {
                    if current_char == '\n' {
                        saw_newline_in_whitespace = true;
                    }
                    // Don't add these
                } else {
                    saw_newline_in_whitespace = false;
                    new_json.push(current_char);
                }
            }
        }
    }

    // Filter out whitespace-only lines, but preserve empty lines inside block comments
    let mut result_lines: Vec<&str> = Vec::new();
    let mut in_block_comment = false;
    for line in new_json.lines() {
        if in_block_comment {
            result_lines.push(line);
            if line.contains("*/") {
                in_block_comment = false;
            }
        } else {
            if line.contains("/*") && !line.contains("*/") {
                in_block_comment = true;
            }
            if !line.trim().is_empty() {
                result_lines.push(line);
            }
        }
    }
    result_lines.iter().map(|line| line.trim_end()).collect::<Vec<&str>>().join("\n")
}

#[cfg(test)]
mod tests {
    use crate::format_json::format_json;

    #[test]
    fn test_simple_object() {
        assert_eq!(
            format_json(r#"{"foo":"bar","baz":"qux"}"#, "  "),
            r#"
{
  "foo": "bar",
  "baz": "qux"
}
"#
            .trim()
        );
    }

    #[test]
    fn test_escaped() {
        assert_eq!(
            format_json(r#"{"foo":"Hi \"world!\""}"#, "  "),
            r#"
{
  "foo": "Hi \"world!\""
}
"#
            .trim()
        );
    }

    #[test]
    fn test_simple_array() {
        assert_eq!(
            format_json(r#"["foo","bar","baz","qux"]"#, "  "),
            r#"
[
  "foo",
  "bar",
  "baz",
  "qux"
]
"#
            .trim()
        );
    }

    #[test]
    fn test_extra_whitespace() {
        assert_eq!(
            format_json(
                r#"["foo",   "bar",  "baz","qux"

            ]"#,
                "  "
            ),
            r#"
[
  "foo",
  "bar",
  "baz",
  "qux"
]
"#
            .trim()
        );
    }

    #[test]
    fn test_invalid_json() {
        assert_eq!(
            format_json(r#"["foo", {"bar",  }"baz",["qux" ]]"#, "  "),
            r#"
[
  "foo",
  {
    "bar",
  }"baz",
  [
    "qux"
  ]
]
"#
            .trim()
        );
    }

    #[test]
    fn test_skip_template_tags() {
        assert_eq!(
            format_json(r#"{"foo":${[ fn("hello", "world") ]} }"#, "  "),
            r#"
{
  "foo": ${[ fn("hello", "world") ]}
}
"#
            .trim()
        );
    }

    #[test]
    fn test_graphql_response() {
        assert_eq!(
            format_json(
                r#"{"data":{"capsules":[{"landings":null,"original_launch":null,"reuse_count":0,"status":"retired","type":"Dragon 1.0","missions":null},{"id":"5e9e2c5bf3591882af3b2665","landings":null,"original_launch":null,"reuse_count":0,"status":"retired","type":"Dragon 1.0","missions":null}]}}"#,
                "  "
            ),
            r#"
{
  "data": {
    "capsules": [
      {
        "landings": null,
        "original_launch": null,
        "reuse_count": 0,
        "status": "retired",
        "type": "Dragon 1.0",
        "missions": null
      },
      {
        "id": "5e9e2c5bf3591882af3b2665",
        "landings": null,
        "original_launch": null,
        "reuse_count": 0,
        "status": "retired",
        "type": "Dragon 1.0",
        "missions": null
      }
    ]
  }
}
"#
            .trim()
        );
    }

    #[test]
    fn test_immediate_close() {
        assert_eq!(
            format_json(r#"{"bar":[]}"#, "  "),
            r#"
{
  "bar": []
}
"#
            .trim()
        );
    }

    #[test]
    fn test_more_closes() {
        assert_eq!(
            format_json(r#"{}}"#, "  "),
            r#"
{}
}
"#
            .trim()
        );
    }

    #[test]
    fn test_line_comment_between_keys() {
        assert_eq!(
            format_json(
                r#"{"foo":"bar",// a comment
"baz":"qux"}"#,
                "  "
            ),
            r#"
{
  "foo": "bar", // a comment
  "baz": "qux"
}
"#
            .trim()
        );
    }

    #[test]
    fn test_line_comment_at_end() {
        assert_eq!(
            format_json(
                r#"{"foo":"bar" // trailing
}"#,
                "  "
            ),
            r#"
{
  "foo": "bar" // trailing
}
"#
            .trim()
        );
    }

    #[test]
    fn test_block_comment() {
        assert_eq!(
            format_json(r#"{"foo":"bar",/* comment */"baz":"qux"}"#, "  "),
            r#"
{
  "foo": "bar",
  /* comment */
  "baz": "qux"
}
"#
            .trim()
        );
    }

    #[test]
    fn test_comment_in_array() {
        assert_eq!(
            format_json(
                r#"[1,// item comment
2,3]"#,
                "  "
            ),
            r#"
[
  1, // item comment
  2,
  3
]
"#
            .trim()
        );
    }

    #[test]
    fn test_comment_only_line() {
        assert_eq!(
            format_json(
                r#"{
  // this is a standalone comment
  "foo": "bar"
}"#,
                "  "
            ),
            r#"
{
  // this is a standalone comment
  "foo": "bar"
}
"#
            .trim()
        );
    }

    #[test]
    fn test_multiline_block_comment() {
        assert_eq!(
            format_json(
                r#"{
  "foo": "bar"
  /**
   Hello World!

   Hi there
   */
}"#,
                "  "
            ),
            r#"
{
  "foo": "bar"
  /**
   Hello World!

   Hi there
   */
}
"#
            .trim()
        );
    }

    // NOTE: trailing whitespace on output lines is trimmed by the formatter.
    // We can't easily add a test for this because raw string literals get
    // trailing whitespace stripped by the editor/linter.

    #[test]
    fn test_comment_inside_string_ignored() {
        assert_eq!(
            format_json(r#"{"foo":"// not a comment","bar":"/* also not */"}"#, "  "),
            r#"
{
  "foo": "// not a comment",
  "bar": "/* also not */"
}
"#
            .trim()
        );
    }

    #[test]
    fn test_comment_on_line_after_comma() {
        assert_eq!(
            format_json(
                r#"{
  "a": "aaa",
  // "b": "bbb"
}"#,
                "  "
            ),
            r#"
{
  "a": "aaa",
  // "b": "bbb"
}
"#
            .trim()
        );
    }
}
