enum FormatState {
    TemplateTag,
    Comment,
    String,
    None,
}

/// Formats JSON that might contain template tags (skipped entirely)
pub fn format_json(text: &str, tab: &str) -> String {
    let mut chars = text.chars().peekable();

    let mut new_json = "".to_string();
    let mut depth = 0;
    let mut state = FormatState::None;

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
            if rest_of_chars.clone().take(2).collect::<String>() == "]}" {
                state = FormatState::None;
                new_json.push_str("]}");
                chars.next(); // Skip the second closing bracket
                continue;
            } else {
                new_json.push(current_char);
                continue;
            }
        }

        // Close Comment state
        if let FormatState::Comment = state {
            if current_char == '\n' {
                state = FormatState::None;
                new_json.push('\n');
                new_json.push_str(tab.to_string().repeat(depth).as_str());
                continue;
            } else {
                new_json.push(current_char);
                continue;
            }
        }

        if rest_of_chars.clone().take(3).collect::<String>() == "${[" {
            state = FormatState::TemplateTag;
            new_json.push_str("${[");
            chars.next(); // Skip {
            chars.next(); // Skip [
            continue;
        }

        if rest_of_chars.clone().take(2).collect::<String>() == "//" {
            state = FormatState::Comment;
            new_json.push_str("//");
            chars.next(); // Skip second /
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
                    // Don't add these
                } else {
                    new_json.push(current_char);
                }
            }
        }
    }

    // Replace only lines containing whitespace with nothing
    new_json
        .lines()
        .filter(|line| !line.trim().is_empty()) // Filter out whitespace-only lines
        .collect::<Vec<&str>>() // Collect the non-empty lines into a vector
        .join("\n") // Join the lines back into a single string
}

#[cfg(test)]
mod tests {
    use crate::format::format_json;

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
    fn test_comment() {
        assert_eq!(
            format_json("{\n  // Hello world\n  \"foo\":\"bar\"\n}", "  "),
            r#"
{
  // Hello world
  "foo": "bar"
}
"#
                .trim()
        );
    }
}
