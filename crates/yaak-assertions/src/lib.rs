//! Pure response assertions, shared by the desktop, CLI, and browser worker.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cmp::Ordering;
use std::collections::HashSet;
use ts_rs::TS;
pub use yaak_jsonpath::MAX_BODY_BYTES;
use yaak_jsonpath::{JsonPath, normalized_path};

pub const MAX_CHECKS: usize = 100;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_assertions.ts")]
pub struct HttpAssertions {
    pub version: u32,
    pub checks: Vec<HttpAssertion>,
}

impl Default for HttpAssertions {
    fn default() -> Self {
        Self { version: 1, checks: Vec::new() }
    }
}

impl HttpAssertions {
    pub fn is_empty(&self) -> bool {
        self.version == 1 && self.checks.is_empty()
    }
    pub fn needs_body(&self) -> bool {
        self.checks.iter().any(|c| c.enabled && c.target == "json")
    }
}

/// Strings intentionally retain unknown operators/types so they fail validation, rather than
/// disappearing during import or being treated as an empty, passing collection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_assertions.ts")]
pub struct HttpAssertion {
    pub id: String,
    pub enabled: bool,
    pub target: String,
    pub selector: String,
    pub operator: String,
    pub expected: String,
    pub expected_type: String,
}

impl Default for HttpAssertion {
    fn default() -> Self {
        Self {
            id: String::new(),
            enabled: true,
            target: "json".into(),
            selector: String::new(),
            operator: "equals".into(),
            expected: String::new(),
            expected_type: "text".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_assertions.ts")]
pub struct AssertionResult {
    pub assertion_id: String,
    pub outcome: String,
    pub reason: String,
    pub actual: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_assertions.ts")]
pub struct AssertionReport {
    pub definition: HttpAssertions,
    pub results: Vec<AssertionResult>,
    pub error: Option<String>,
}

#[derive(Clone, Copy)]
pub enum Completion {
    Complete,
    Error,
    Canceled,
}
pub enum Body<'a> {
    Bytes(&'a [u8]),
    TooLarge,
    Unavailable,
}

pub struct Response<'a> {
    pub status: i32,
    pub headers: &'a [(String, String)],
    pub body: Body<'a>,
    pub completion: Completion,
}

fn expected_value(check: &HttpAssertion) -> Result<Value, &'static str> {
    match check.expected_type.as_str() {
        "text" => Ok(Value::String(check.expected.clone())),
        "number" => match serde_json::from_str::<Value>(check.expected.trim()) {
            Ok(v) if v.is_number() => Ok(v),
            _ => Err("Expected value must be a number"),
        },
        "boolean" => match check.expected.trim() {
            "true" => Ok(Value::Bool(true)),
            "false" => Ok(Value::Bool(false)),
            _ => Err("Expected value must be true or false"),
        },
        "null" => Ok(Value::Null),
        _ => Err("Unsupported expected value type"),
    }
}

pub fn validate_check(check: &HttpAssertion) -> Result<(), &'static str> {
    if check.id.is_empty() {
        return Err("Assertion ID is required");
    }
    if check.selector.len() > 1024 || check.expected.len() > 16 * 1024 {
        return Err("Assertion input is too long");
    }
    match check.target.as_str() {
        "json" => {
            if check.selector.trim().is_empty()
                || JsonPath::parse(&normalized_path(&check.selector)).is_err()
            {
                return Err("Enter a valid JSONPath, for example $.user.id");
            }
        }
        "header" if !check.selector.trim().is_empty() => {}
        "status" => {}
        "header" => return Err("Header name is required"),
        _ => return Err("Unsupported assertion target"),
    }
    if check.operator == "exists" {
        return Ok(());
    }
    if !matches!(
        check.operator.as_str(),
        "equals" | "not_equals" | "greater_than" | "less_than" | "contains"
    ) {
        return Err("Unsupported comparison");
    }
    let expected = expected_value(check)?;
    if matches!(check.operator.as_str(), "greater_than" | "less_than") && !expected.is_number() {
        return Err("Numeric comparisons require a number");
    }
    if check.operator == "contains" && !expected.is_string() {
        return Err("Contains requires a text value");
    }
    if check.target == "status"
        && (!expected.is_number()
            || !matches!(
                check.operator.as_str(),
                "equals" | "not_equals" | "greater_than" | "less_than"
            ))
    {
        return Err("Status comparisons require a number");
    }
    if check.target == "header" && !expected.is_string() {
        return Err("Header comparisons require text");
    }
    Ok(())
}

pub fn validate(definition: &HttpAssertions) -> Result<(), String> {
    if definition.version != 1 {
        return Err("Unsupported assertion version".into());
    }
    if definition.checks.len() > MAX_CHECKS {
        return Err("At most 100 assertions are supported per request".into());
    }
    let mut ids = HashSet::new();
    for check in &definition.checks {
        if !ids.insert(&check.id) {
            return Err("Assertion IDs must be unique".into());
        }
        if check.enabled {
            validate_check(check).map_err(str::to_owned)?;
        }
    }
    Ok(())
}

pub fn validation_errors(definition: &HttpAssertions) -> std::collections::HashMap<String, String> {
    let mut errors = std::collections::HashMap::new();
    if definition.version != 1 || definition.checks.len() > MAX_CHECKS {
        errors.insert(String::new(), validate(definition).unwrap_err());
        return errors;
    }
    let mut ids = HashSet::new();
    for check in &definition.checks {
        if !ids.insert(&check.id) {
            errors.insert(check.id.clone(), "Assertion IDs must be unique".into());
        }
        if check.enabled
            && let Err(message) = validate_check(check)
        {
            errors.insert(check.id.clone(), message.into());
        }
    }
    errors
}

fn numeric_cmp(a: &Value, b: &Value) -> Option<Ordering> {
    if let (Some(a), Some(b)) = (a.as_i64(), b.as_i64()) {
        return Some(a.cmp(&b));
    }
    if let (Some(a), Some(b)) = (a.as_u64(), b.as_u64()) {
        return Some(a.cmp(&b));
    }
    if a.as_i64().is_some_and(|n| n < 0) && b.as_u64().is_some() {
        return Some(Ordering::Less);
    }
    if b.as_i64().is_some_and(|n| n < 0) && a.as_u64().is_some() {
        return Some(Ordering::Greater);
    }
    for value in [a, b] {
        if value.as_u64().is_some_and(|n| n > 9_007_199_254_740_992)
            || value.as_i64().is_some_and(|n| n < -9_007_199_254_740_992)
        {
            return None;
        }
    }
    let (a, b) = (a.as_f64()?, b.as_f64()?);
    // Avoid rounding distinct large integers into the same floating-point value.
    if a.abs() > 9_007_199_254_740_992.0 || b.abs() > 9_007_199_254_740_992.0 {
        return None;
    }
    a.partial_cmp(&b)
}

fn compare(actual: &Value, expected: &Value, op: &str) -> Result<bool, &'static str> {
    if op == "contains" {
        return actual
            .as_str()
            .zip(expected.as_str())
            .map(|(a, b)| a.contains(b))
            .ok_or("Value is not text");
    }
    if actual.is_number() && expected.is_number() {
        let cmp = numeric_cmp(actual, expected)
            .ok_or("Number is outside the supported comparison range")?;
        return Ok(match op {
            "equals" => cmp.is_eq(),
            "not_equals" => !cmp.is_eq(),
            "greater_than" => cmp.is_gt(),
            "less_than" => cmp.is_lt(),
            _ => false,
        });
    }
    if matches!(op, "greater_than" | "less_than") {
        return Err("Value is not a number");
    }
    if !(actual.is_string() && expected.is_string()
        || actual.is_boolean() && expected.is_boolean()
        || actual.is_null() && expected.is_null())
    {
        return Err("Value has a different type");
    }
    Ok(if op == "not_equals" { actual != expected } else { actual == expected })
}

pub fn evaluate(definition: &HttpAssertions, response: Response<'_>) -> AssertionReport {
    let error = validate(definition).err();
    if definition.checks.len() > MAX_CHECKS {
        return AssertionReport { definition: definition.clone(), results: Vec::new(), error };
    }
    let json = if error.is_none()
        && matches!(response.completion, Completion::Complete)
        && definition.needs_body()
    {
        match response.body {
            Body::Bytes(bytes) if bytes.len() <= MAX_BODY_BYTES => {
                serde_json::from_slice::<Value>(bytes)
                    .map_err(|_| "Response body is not valid UTF-8 JSON")
            }
            Body::TooLarge | Body::Bytes(_) => {
                Err("Response body exceeds the 10 MiB assertion limit")
            }
            Body::Unavailable => Err("Response body is unavailable"),
        }
    } else {
        Ok(Value::Null)
    };
    let results = definition
        .checks
        .iter()
        .map(|check| {
            let result = |outcome: &str, reason: &str, actual: Option<Value>| AssertionResult {
                assertion_id: check.id.clone(),
                outcome: outcome.into(),
                reason: reason.into(),
                actual,
            };
            if !check.enabled {
                return result("skipped", "Disabled", None);
            }
            if let Some(error) = &error {
                return result("invalid", error, None);
            }
            match response.completion {
                Completion::Canceled => return result("error", "Request canceled", None),
                Completion::Error => {
                    return result("error", "Request did not complete successfully", None);
                }
                Completion::Complete => {}
            }
            let status = Value::from(response.status);
            let header_values: Vec<Value> = if check.target == "header" {
                response
                    .headers
                    .iter()
                    .filter(|(name, _)| name.eq_ignore_ascii_case(check.selector.trim()))
                    .map(|(_, value)| Value::String(value.clone()))
                    .collect()
            } else {
                Vec::new()
            };
            // Borrow JSON matches: recursive selectors can select overlapping subtrees.
            // Cloning every selected subtree would multiply memory well beyond the body limit.
            let values: Result<Vec<&Value>, &str> = match check.target.as_str() {
                "status" => Ok(vec![&status]),
                "header" => Ok(header_values.iter().collect()),
                "json" => json.as_ref().map_err(|e| *e).map(|body| {
                    JsonPath::parse(&normalized_path(&check.selector))
                        .expect("validated path")
                        .query(body)
                        .all()
                }),
                _ => unreachable!("validated target"),
            };
            let values = match values {
                Ok(values) => values,
                Err(message) => return result("error", message, None),
            };
            if values.is_empty() {
                return result("failed", "Value was not found", None);
            }
            if check.operator == "exists" {
                return result("passed", "Value exists", None);
            }
            if check.target == "json" && values.len() != 1 {
                return result("error", "JSONPath must select one value for this comparison", None);
            }
            let expected = expected_value(check).expect("validated expected value");
            let mut reason = "Value did not match";
            let mut all_different = true;
            for actual in &values {
                match compare(actual, &expected, &check.operator) {
                    Ok(true) if check.operator != "not_equals" => {
                        return result("passed", "Comparison passed", None);
                    }
                    Ok(true) => {}
                    Ok(false) => all_different = false,
                    Err(message) => {
                        reason = message;
                        all_different = false;
                    }
                }
            }
            if check.operator == "not_equals" && all_different {
                return result("passed", "Comparison passed", None);
            }
            // Details are local to the response; CLI reports deliberately omit actual values.
            let actual = values
                .first()
                .filter(|v| {
                    v.is_null()
                        || v.is_boolean()
                        || v.is_number()
                        || v.as_str().is_some_and(|s| s.len() <= 1024)
                })
                .map(|v| (*v).clone());
            result("failed", reason, actual)
        })
        .collect();
    AssertionReport { definition: definition.clone(), results, error }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check(path: &str, op: &str, expected: &str, kind: &str) -> HttpAssertion {
        HttpAssertion {
            id: "check".into(),
            selector: path.into(),
            operator: op.into(),
            expected: expected.into(),
            expected_type: kind.into(),
            ..Default::default()
        }
    }
    fn run(check: HttpAssertion, bytes: &[u8]) -> AssertionResult {
        evaluate(
            &HttpAssertions { checks: vec![check], ..Default::default() },
            Response {
                status: 200,
                headers: &[],
                body: Body::Bytes(bytes),
                completion: Completion::Complete,
            },
        )
        .results
        .remove(0)
    }
    #[test]
    fn json_paths_and_strict_scalar_types() {
        let body = br#"{"user":{"id":123,"name":"Greg","active":true,"deleted":null},"items":[1,2],"a.b":"value"}"#;
        for (path, op, expected, kind, outcome) in [
            ("$.user.id", "equals", "123", "number", "passed"),
            ("user.id", "equals", "123.0", "number", "passed"),
            ("user.id", "equals", "123", "text", "failed"),
            ("user.id", "not_equals", "123", "text", "failed"),
            ("user.id", "greater_than", "122", "number", "passed"),
            ("user.id", "less_than", "124", "number", "passed"),
            ("user.name", "contains", "reg", "text", "passed"),
            ("user.active", "equals", "true", "boolean", "passed"),
            ("user.deleted", "exists", "", "text", "passed"),
            ("user.deleted", "equals", "", "null", "passed"),
            ("user.missing", "equals", "", "null", "failed"),
            ("user.missing", "not_equals", "anything", "text", "failed"),
            ("items[*]", "equals", "1", "number", "error"),
            ("items[*]", "exists", "", "text", "passed"),
            ("['a.b']", "equals", "value", "text", "passed"),
            ("user", "equals", "{}", "text", "failed"),
        ] {
            assert_eq!(
                run(check(path, op, expected, kind), body).outcome,
                outcome,
                "{path} {op} {expected} {kind}"
            );
        }
    }
    #[test]
    fn invalid_configs_are_not_failures_or_passes() {
        for c in [
            check("$[", "equals", "1", "number"),
            check("id", "equals", "NaN", "number"),
            check("id", "greater_than", "2", "text"),
            check("id", "script", "", "text"),
            check("id", "equals", "yes", "boolean"),
        ] {
            assert_eq!(run(c, b"{}").outcome, "invalid");
        }
        let c = check("id", "exists", "", "text");
        assert!(validate(&HttpAssertions { version: 2, checks: vec![] }).is_err());
        assert!(
            validate(&HttpAssertions { checks: vec![c.clone(), c], ..Default::default() }).is_err()
        );
    }
    #[test]
    fn duplicate_headers_match_case_insensitively_without_joining() {
        let headers = vec![
            ("X-Test".into(), "one".into()),
            ("x-test".into(), "two".into()),
        ];
        for (op, expected, outcome) in [
            ("equals", "two", "passed"),
            ("equals", "one,two", "failed"),
            ("not_equals", "one", "failed"),
            ("not_equals", "three", "passed"),
        ] {
            let mut c = check("X-TEST", op, expected, "text");
            c.target = "header".into();
            let report = evaluate(
                &HttpAssertions { checks: vec![c], ..Default::default() },
                Response {
                    status: 200,
                    headers: &headers,
                    body: Body::Unavailable,
                    completion: Completion::Complete,
                },
            );
            assert_eq!(report.results[0].outcome, outcome);
        }
    }
    #[test]
    fn incomplete_requests_cannot_pass_even_a_status_check() {
        for completion in [Completion::Error, Completion::Canceled] {
            let mut c = check("", "equals", "200", "number");
            c.target = "status".into();
            let report = evaluate(
                &HttpAssertions { checks: vec![c], ..Default::default() },
                Response { status: 200, headers: &[], body: Body::Bytes(b"{}"), completion },
            );
            assert_eq!(report.results[0].outcome, "error");
        }
    }
    #[test]
    fn body_errors_do_not_prevent_status_checks() {
        let c = check("id", "exists", "", "text");
        for body in [
            Body::Unavailable,
            Body::TooLarge,
            Body::Bytes(b"not json"),
            Body::Bytes(b"\xff"),
        ] {
            let mut status = check("", "equals", "200", "number");
            status.target = "status".into();
            status.id = "status".into();
            let report = evaluate(
                &HttpAssertions { checks: vec![c.clone(), status], ..Default::default() },
                Response { status: 200, headers: &[], body, completion: Completion::Complete },
            );
            assert_eq!(report.results[0].outcome, "error");
            assert_eq!(report.results[1].outcome, "passed");
        }
    }
    #[test]
    fn disabled_checks_and_large_numbers() {
        let mut c = check("invalid path", "unknown", "", "bad");
        c.enabled = false;
        assert_eq!(run(c, b"{}").outcome, "skipped");
        assert_eq!(
            run(check("id", "equals", "9007199254740993", "number"), br#"{"id":9007199254740992}"#)
                .outcome,
            "failed"
        );
        assert_eq!(
            run(check("id", "equals", "9007199254740993", "number"), br#"{"id":9007199254740993}"#)
                .outcome,
            "passed"
        );
        assert_eq!(
            run(
                check("id", "equals", "9007199254740992.0", "number"),
                br#"{"id":9007199254740993}"#
            )
            .outcome,
            "failed"
        );
    }
}
