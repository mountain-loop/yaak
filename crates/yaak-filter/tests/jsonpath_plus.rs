//! Every case in `fixtures/jsonpath_plus.json`, which
//! `fixtures/generate-jsonpath-plus.mjs` records from jsonpath-plus 11.0.0 as
//! the removed plugin ran it.

use serde_json::Value;
use std::collections::BTreeMap;
use yaak_filter::json_path;

/// Where this engine means to differ from jsonpath-plus; the fixture holds the
/// result each such case should give instead.
const DEVIATIONS: &[&str] = &[
    // `["a.b"]` and `['a.b']` are literal keys, never operators or expressions.
    "literal-key",
    // RFC 9535 `[-1]`, which jsonpath-plus looks up as the key "-1".
    "rfc-negative-index",
    // RFC 9535 `[::-1]`, which jsonpath-plus does not read as a slice.
    "rfc-negative-step",
    // RFC 9535 `[?@.a > 1]`, which jsonpath-plus looks up as a key.
    "rfc-filter",
    // RFC 9535 `length()`, `count()`, `match()`, `search()` and `value()` in `?(...)`.
    "rfc-function",
    // A call outside the allowlist, or several statements: an error, not JavaScript.
    "unsupported",
    // Filters are compiled up front, so a bad one fails even when no node reaches it.
    "eager-parse",
    // jsonpath-plus returns undefined for a root of 0, "", false or null.
    "falsy-root",
    // Indexing into a string can split a surrogate pair, which becomes U+FFFD here.
    "lone-surrogate",
];

#[test]
fn matches_jsonpath_plus_except_named_deviations() {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/jsonpath_plus.json")).unwrap();
    let docs = fixture["docs"].as_object().unwrap();
    let cases = fixture["cases"].as_array().unwrap();
    assert!(cases.len() >= 300, "{} cases", cases.len());

    let mut failures = Vec::new();
    let mut per_deviation: BTreeMap<&str, usize> = BTreeMap::new();
    for case in cases {
        let doc = docs[case["doc"].as_str().unwrap()].as_str().unwrap();
        let path = case["path"].as_str().unwrap();
        let expected = &case["expected"];
        let label = match case["deviation"].as_str() {
            Some(deviation) => {
                assert!(
                    DEVIATIONS.contains(&deviation),
                    "unknown deviation {deviation} for {path}"
                );
                *per_deviation.entry(deviation).or_default() += 1;
                format!("{} {path} [{deviation}]", case["doc"])
            }
            None => format!("{} {path}", case["doc"]),
        };
        let result = json_path(doc, path);
        let ok = if expected["error"] == Value::Bool(true) {
            result.content.is_empty()
                && result.error.as_ref().is_some_and(|e| e.starts_with("Invalid filter: "))
        } else {
            result.error.is_none() && Some(result.content.as_str()) == expected["content"].as_str()
        };
        if !ok {
            failures.push(format!("{label}\n  expected: {expected}\n  got: {result:?}"));
        }
    }
    for deviation in DEVIATIONS {
        assert!(per_deviation.contains_key(deviation), "no case covers {deviation}");
    }
    assert!(
        failures.is_empty(),
        "{} of {} cases differ:\n{}",
        failures.len(),
        cases.len(),
        failures.join("\n")
    );
}
