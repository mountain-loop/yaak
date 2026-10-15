//! Expected output is what the `@yaak/filter-xpath` plugin (xmldom and xpath)
//! returned for the same input, except where a test says otherwise.

use yaak_filter::{Language, filter, xpath};

const ITEMS: &str = r#"<root><item id="1">A</item><item id="2">B &amp; C</item><empty/></root>"#;
const FEED: &str = r#"<feed xmlns="http://www.w3.org/2005/Atom" xmlns:m="urn:m"><entry><title>T</title><m:thumb url="x"/></entry></feed>"#;
const MIXED: &str =
    r#"<?xml version="1.0"?><!-- c --><a x="1&quot;2"><!--note--><b><![CDATA[<raw>]]></b></a>"#;

fn content(xml: &str, query: &str) -> String {
    let result = xpath(xml, query);
    assert_eq!(result.error, None, "{query}");
    result.content
}

#[test]
fn node_sets_serialize_one_node_per_line() {
    assert_eq!(
        content(ITEMS, "//item"),
        "<item id=\"1\">A</item>\n<item id=\"2\">B &amp; C</item>"
    );
    assert_eq!(content(ITEMS, "//item/text()"), "A\nB &amp; C");
    assert_eq!(content(ITEMS, "//empty"), "<empty/>");
    assert_eq!(content(ITEMS, "//missing"), "");
    assert_eq!(content(ITEMS, "//item[@id='2']/.."), ITEMS);
    assert_eq!(content(MIXED, "//comment()"), "<!-- c -->\n<!--note-->");
}

/// The plugin printed a leading space before each attribute (` id="1"`).
#[test]
fn attributes_serialize_as_name_and_value() {
    assert_eq!(content(ITEMS, "//item/@id"), "id=\"1\"\nid=\"2\"");
    assert_eq!(content(MIXED, "/a/@x"), "x=\"1&quot;2\"");
}

#[test]
fn scalar_results_print_like_javascript() {
    assert_eq!(content(ITEMS, "count(//item)"), "2");
    assert_eq!(content(ITEMS, "string(//item[2])"), "B & C");
    assert_eq!(content(ITEMS, "sum(//item/@id) div 4"), "0.75");
    assert_eq!(content(ITEMS, "boolean(//empty)"), "true");
    assert_eq!(content(ITEMS, "1 div 0"), "Infinity");
    assert_eq!(content(ITEMS, "0 div 0"), "NaN");
    assert_eq!(content(ITEMS, "-0"), "0");
}

#[test]
fn namespaces_are_declared_where_they_are_used() {
    assert_eq!(
        content(FEED, "//*[local-name()='entry']"),
        r#"<entry xmlns="http://www.w3.org/2005/Atom"><title>T</title><m:thumb url="x" xmlns:m="urn:m"/></entry>"#
    );
    assert_eq!(content(FEED, "//*[local-name()='thumb']"), r#"<m:thumb url="x" xmlns:m="urn:m"/>"#);
    // XPath 1.0 has no default namespace for unprefixed names.
    assert_eq!(content(FEED, "//entry"), "");
}

/// The plugin kept the XML declaration and the CDATA section; this parser keeps neither.
#[test]
fn root_serializes_the_whole_document() {
    assert_eq!(
        content(MIXED, "/"),
        r#"<!-- c --><a x="1&quot;2"><!--note--><b>&lt;raw&gt;</b></a>"#
    );
    assert_eq!(content(MIXED, "//b/text()"), "&lt;raw&gt;");
    assert_eq!(content("<a>x<![CDATA[<y>]]>&amp;z</a>", "/a/text()"), "x&lt;y&gt;&amp;z");
}

#[test]
fn doctype_is_accepted() {
    assert_eq!(content("<!DOCTYPE note><note>hi</note>", "/note"), "<note>hi</note>");
    assert_eq!(content("<?xml version=\"1.0\"?><!DOCTYPE note><note/>", "/note"), "<note/>");
}

#[test]
fn invalid_queries_and_documents_are_errors() {
    for (xml, query, prefix) in [
        (ITEMS, "//item[", "Invalid filter: "),
        (ITEMS, "", "Invalid filter: "),
        (ITEMS, "unknown-fn()", "Invalid filter: "),
        ("<html><body><p>one<br></p></body></html>", "//p", "Invalid XML: "),
        ("<a><b>", "/a", "Invalid XML: "),
    ] {
        let result = xpath(xml, query);
        assert_eq!(result.content, "", "{query}");
        assert!(
            result.error.as_deref().unwrap_or_default().starts_with(prefix),
            "{query}: {result:?}"
        );
    }
}

#[test]
fn filter_dispatches_to_xpath() {
    assert_eq!(filter(Language::XPath, ITEMS, "count(//item)").content, "2");
}

#[test]
fn numbers_switch_to_exponents_where_javascript_does() {
    assert_eq!(content("<a>0.0000001</a>", "number(/a)"), "1e-7");
    assert_eq!(content("<a>0.000001</a>", "number(/a)"), "0.000001");
    assert_eq!(content("<a>1000000000000000000000</a>", "number(/a)"), "1e+21");
    assert_eq!(content("<a>100000000000000000000</a>", "number(/a)"), "100000000000000000000");
}
