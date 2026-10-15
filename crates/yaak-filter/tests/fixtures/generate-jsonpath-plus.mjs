// Records what the removed `@yaak/filter-jsonpath` plugin returned for a corpus
// of (document, path) cases, using the jsonpath-plus in node_modules. The Rust
// engine in src/jsonpath must reproduce every case, except the named deviations,
// whose expected result is written here by hand.
//
//   node crates/yaak-filter/tests/fixtures/generate-jsonpath-plus.mjs

import { writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSONPath } from "jsonpath-plus";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const version = JSON.parse(readFileSync(require.resolve("jsonpath-plus/package.json"), "utf8")).version;
if (version !== "11.0.0") throw new Error(`expected jsonpath-plus 11.0.0, found ${version}`);

/** The plugin's literal fast path, as `jsonPathToSegments` was before the port. */
const PATH_SEGMENT = /^(?:\.([A-Za-z_$][A-Za-z0-9_$]*)|\[(0|[1-9]\d*)\]|\[("(?:[^"\\]|\\.)*")\])/;
function jsonPathToSegments(path) {
  let rest = path.trim();
  if (!rest.startsWith("$")) return null;
  rest = rest.slice(1);
  const segments = [];
  while (rest.length > 0) {
    const match = PATH_SEGMENT.exec(rest);
    if (match == null) return null;
    const [whole, bareKey, index, quotedKey] = match;
    if (bareKey != null) {
      if (bareKey === "$") return null;
      segments.push({ kind: "key", key: bareKey });
    } else if (index != null) {
      const value = Number(index);
      if (!Number.isSafeInteger(value)) return null;
      segments.push({ kind: "index", index: value });
    } else if (quotedKey != null) {
      try {
        segments.push({ kind: "key", key: JSON.parse(quotedKey) });
      } catch {
        return null;
      }
    }
    rest = rest.slice(whole.length);
  }
  return segments;
}

/** The plugin's `onFilter`, minus the host. */
function oldPlugin(payload, filter) {
  const parsed = JSON.parse(payload);
  try {
    const segments = filter.includes('["') ? jsonPathToSegments(filter) : null;
    let filtered;
    if (segments != null) {
      let value = parsed;
      for (const segment of segments) {
        const key = segment.kind === "key" ? segment.key : segment.index;
        if (value == null || !Object.prototype.hasOwnProperty.call(value, key)) {
          return { content: "[]" };
        }
        value = value[key];
      }
      filtered = [value];
    } else {
      filtered = JSONPath({ path: filter, json: parsed });
    }
    return { content: JSON.stringify(filtered, null, 2) ?? null };
  } catch (err) {
    return { error: `Invalid filter: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const docs = {
  store: {
    store: {
      book: [
        { category: "reference", author: "Nigel Rees", title: "Sayings of the Century", price: 8.95 },
        { category: "fiction", author: "Evelyn Waugh", title: "Sword of Honour", price: 12.99 },
        { category: "fiction", author: "Herman Melville", title: "Moby Dick", isbn: "0-553-21311-3", price: 8.99 },
        {
          category: "fiction",
          author: "J. R. R. Tolkien",
          title: "The Lord of the Rings",
          isbn: "0-395-19395-8",
          price: 22.99,
        },
      ],
      bicycle: { color: "red", price: 19.95 },
    },
  },
  items: { items: [{ id: 1 }, { id: 2 }, { id: 3 }], "space key": 4 },
  vals: {
    vals: [0, 1, "1", "", " ", "0", null, true, false, [], [1], [1, 2], {}, "abc", "10", "9", 1.5, -1, "a1", 2],
  },
  mixed: {
    str: "Hello World",
    empty: "",
    zero: 0,
    num: 12.5,
    neg: -3,
    t: true,
    f: false,
    n: null,
    arr: [1, "2", null, true, [3], { a: 1 }],
    obj: { a: 1, b: "x" },
    emptyArr: [],
    nested: { deep: { deeper: { value: 42 } } },
  },
  people: {
    people: [
      { name: "Ann", age: 31, email: "ann@example.com", tags: ["dev", "ops"], address: { city: "Paris" },
        pets: [{ type: "cat", age: 7 }] },
      { name: "Bob", age: 17, tags: ["admin"], address: null, pets: [] },
      { name: "Cleo", email: "", tags: [], address: { city: "Oslo", zip: "0150" },
        pets: [{ type: "dog", age: 2 }, { type: "cat", age: 1 }] },
      { name: "Dmitri", age: 64, email: "d@example.com", tags: ["dev"], address: { city: "Paris" },
        pets: [{ type: "fish", age: 9 }] },
    ],
    groups: [
      { name: "red", members: [{ active: false }, { active: true }] },
      { name: "blue", members: [{ active: false }] },
    ],
  },
  numeric: JSON.parse('{"b":1,"2":"two","10":"ten","a":[0,1,2,3,4,5,6,7,8,9],"01":"lead","-1":"minus"}'),
  unicode: { "ключ": "значение", "emoji 🤔": "face", "日本": { "語": 1 }, "ü": [1, 2], "z": "🤔ok" },
  deep: {
    a: { b: 1, a: { b: 2, c: [{ a: { b: 3 } }, { b: 4 }] } },
    c: [[1, [2]], { a: 5 }],
    v: 1,
    w: { v: 2, x: { v: 3, y: null } },
  },
  weird: {
    weird: {
      "*": 1, "..": 2, "$": 3, "@": 4, "~": 5, "^": 6, "a.b": 7, "a,b": 8, "`x": 9, "x y": 10,
      "[": 11, "]": 12, "'q'": 13, '"dq"': 14, "?(true)": 15, "": 16, "%@%": 17, "a~b": 18,
      "quote\"key": 19, "single'key": 20, "back\\slash": 21, "length": 22, "0:2": 23,
    },
    "*": "root-star",
    plain: { x: 1 },
  },
  nums: { nums: [1, 2.5, 1e21, 1e-7, 123456789012345680000, 0.1, 100, 3.14159, 1e300, 5e-324, 0.000001, 1.5e-7, 1.005, -1.5, 0.5, 255] },
  rawnums: '{"n":[1.0,10.50,-0,1E3,1e400,0.30000000000000004,9007199254740993,-0.0,1e-400]}',
  strs: { strs: ["  padded  ", "Hello", "hello world", "a,b,c", "ABC", "x-y-z", "café", "🤔ok", "line\nbreak"] },
  rootstr: "hello",
  rootnum: 42,
  roottrue: true,
  rootzero: 0,
  rootempty: "",
  falsy: { s: "", t: "abc", a: [], z: 0, f: false, n: null, o: {} },
  rootfalse: false,
  rootnull: null,
  rootarr: [],
  rootobj: {},
  rootarray: [{ a: 1 }, { a: 2, b: [10, 20] }, "x", 5, null],
  dupes: '{"a":1,"b":2,"a":3,"1":"one","0":"zero"}',
};

/** [doc, path] or [doc, path, deviation, expected]; expected is a value, or ERROR. */
const ERROR = Symbol("error");
const cases = [];
const add = (doc, path, deviation, expect) => cases.push({ doc, path, deviation, expect });
const same = (doc, ...paths) => paths.forEach((p) => add(doc, p));
/** jsonpath-plus finds nothing where RFC 9535 defines a result. */
const rfc = (doc, path, deviation, expect) => add(doc, path, deviation, expect);
/** jsonpath-plus evaluates JavaScript this engine does not, which is an error here. */
const unsupported = (doc, ...paths) => paths.forEach((p) => add(doc, p, "unsupported", ERROR));

// Goessner's bookstore.
same(
  "store",
  "$.store.book[*].author",
  "$..author",
  "$.store.*",
  "$.store..price",
  "$..book[2]",
  "$..book[(@.length-1)]",
  "$..book[-1:]",
  "$..book[0,1]",
  "$..book[:2]",
  "$..book[?(@.isbn)]",
  "$..book[?(@.price<10)]",
  "$..*",
  "$..book[?(@.price==8.95)].title",
  "$..book[?(@.author=='Nigel Rees')].title",
  '$..book[?(@.category==="fiction" && @.price > 10)].title',
  '$..book[?(@.price > 20 || @.category=="reference")].title',
  "$..book[?(!@.isbn)].title",
  "$..book[1:3].title",
  "$..book[::2].title",
  "$..book[1::2].title",
  "$..book[-3:-1].title",
  "$.store.book[*].price",
  "$..book.length",
  "$..book[?(@.title.length > 10)].title",
  "$..book[?(@.author.startsWith('J'))].title",
  "$..book[?(@.author.includes('e'))].author",
  "$..book[?(@.title.toLowerCase().indexOf('the') >= 0)].title",
  "$..book[?(@.title.match(/of/i))].title",
  "$..book[?(/Moby/.test(@.title))].title",
  "$..book[?(@.price.toFixed(1) == '9.0')].title",
  "$..book[?(@property == 0)].title",
  "$..book[?(@property > 1)]~",
  "$..book[?(@parentProperty == 'book')].title",
  "$..book[?(@parentProperty == 'store')].title",
  `$..book[?(@path == "$['store']['book'][1]")].title`,
  "$..book[?(@root.store.bicycle.price > @.price)].title",
  "$..book[?(@parent.bicycle)].title",
  "$.store.book^",
  "$.store.book[0]^^",
  "$..book[?(@.isbn)]^",
  "$.store.*~",
  "$.store.book[*]~",
  "$..price~",
  "$.store.bicycle.color~",
  "$..book[0][title,author]",
  "$..book[?(@.price > 9)].price",
  "$..[?(@.price)].price",
  "$.store..*@number()",
  "$..*@string()",
  "$.store.book[?(@.price < $.store.bicycle.price)]",
  "$..book[?(@.price < @root.store.bicycle.price)].title",
  '$["store"]["book"][0]["title"]',
  "$['store']['book'][0]['title']",
  '$.store["bicycle"].color',
  '$.store["bicycle"]["missing"]',
  "$.store.book[?(@.price > 10)].title^",
  "$.store.book[(@path == \"$['store']['book']\" ? 0 : 1)].title",
  "$.store.book[(@property == 'book' ? 1 : 2)].title",
  "$.store.book[(@root.store.book.length - 1)].title",
  "$.store.book[*][?(@property == 'author')]",
  "$.store.book[0][?(@property != 'price')]",
  `$..[?(@path === "$['store']['bicycle']")]`,
  "$..[?(@parent && @parent.bicycle)].category",
  "$.store[('bi' + 'cycle')].color",
  "$.store.book[(@.length - 1)].title",
  "$.store.book[?(@.price < 10)].title^",
  "$..book[?(@.price < 10) || @.category == 'reference'].title",
  "$.store.book.*.title",
  "$.store..title",
  "$..book..title",
  "$..title^",
  "$..title~",
  "$.store.book[?(@.category == 'fiction')][title]",
);

// The existing test file's fixture.
same(
  "items",
  "$",
  "$.items[1].id",
  '$["space key"]',
  "$['space key']",
  "$.items[*].id",
  "$..id",
  "$.items[0:2].id",
  "$.items[0,2].id",
  "$.items[?(@.id > 1)].id",
  '$.items[?(@["id"] > 1)].id',
  '$["items"][*].id',
  "$.missing",
  "$.items[(@.length-1)].id",
  '$["items"].$',
  "$.items[?(@.id.toString() == '1')]",
  "$.*",
  "$[*]",
  "$..*",
  "$..[*]",
  "$..[0]",
  "$.items[0]",
  "$.items.0",
  "$.items['1'].id",
  '$.items["1"].id',
  "$.items[1:]",
  "$.items[:1]",
  "$.items[-2:]",
  "$.items[:-1]",
  "$.items[::2]",
  "$.items[0,-1].id",
  "$.items[-4]",
  "$.items[0:1,2].id",
  "$.items[(@.length-2)]",
  "$.items[(@.length)]",
  "$.items[('0')].id",
  "$.items[0][('id')]",
  "$['items'][0]",
  '$["items"][0]',
  "$.items[?(@.id)]",
  "$.items[?(@.id == 2)].id",
  "$.items[?(@.id in [1])]",
  "$.items~",
  "$.items[*]~",
  "$.items[0]~",
  "$.items.0~",
  "$.*~",
  "$..id~",
  "$.items[0]^",
  "$.items[0]^^",
  "$.items[*]^",
  "$.items[?(@.id==2)]^",
  "$.items^~",
  "$.items[0].id^",
  "$..id^",
  "$.`items",
  "$.items[0].`id",
  "$.$",
  "$.items.$",
  "$.items[0].$.id",
  "items[0].id",
  ".items",
  "$.missing.deeper",
  "$.items[5]",
  "$.items[0].id.missing",
  "$.items[0].id.length",
  "$.space key",
  "$.items[(0)].id",
  "$.items[('1')]",
  "$.items[(@.length > 2 ? 0 : 1)].id",
  "$.items[(true)]",
  "$.items[(null)]",
  "$.items[(undefined)]",
  "$.items[('*')]",
  "$.items[('0,1')].id",
  "$.items[('?(@.id>1)')]",
  "$.items[('1:3')].id",
  "$.items[('-1')]",
  "$.items[(@.length-1)]~",
  "$.items[0][id]",
  "$.items[?(@.id >)]",
  "$.items[?(@.id == 'x)]",
  "$.items[?(foo)]",
  "$.items[?(@.id.foo())]",
  "$.items[?(@.constructor)]",
  "$.items[?(@.__proto__)]",
  "$.items[?(@.id.constructor('x'))]",
  "$[?(@)]",
  "$.items[?()]",
  "$.items[()]",
  "$.items[?(@.id = 5)]",
  "$.items[?(@.id++)]",
  "$.items[?(@.id ?? 1)]",
  "$.items[?(@.id ** 2 > 3)]",
  "$.items[?(this)]",
  "$.items[?((@.id, true))]",
  "$.items[?(@.id > 1) && @.id < 3]",
  "",
  "$.",
  "$..",
  "$[",
  "$]",
  "$.items[",
  "$.items[0",
  "$.items[?(@.id",
  "$['unclosed",
  "$.items[*].id,",
  "$.items..id",
  "$.items[*]..id",
  "$.items[*][id]",
  "$.items[?(@.id % 2)]~",
  "$.items[?(@.id == 1 ? true : @.id == 3)].id",
  "$.items[?(@ && @.id)].id",
  "$.items[?(@.id?.toString() == '2')].id",
  "$.items[?(@['id'] === 3)].id",
  "$.items[?(@.id && @.id.toString().length)].id",
  "$.items[?(@.id.toString(2) == '11')].id",
  "$.items[?(@root.items[@property].id == @.id)].id",
  "$.items[?(@root['space key'] == 4)].id",
);
unsupported(
  "items",
  "$.items[?(/x/.exec)].id",
  "$.items[?(@.id; true)]",
  "$.items[?(@.id, true)]",
  "$.items[?(@.id @.id)]",
  "$.items[?(var x = 1; x)]",
  "$.items[?(@.id.valueOf() == 1)]",
  "$.items[?(@.hasOwnProperty('id'))]",
);
rfc("items", "$.items[-1].id", "rfc-negative-index", [3]);
rfc("items", "$.items[-3].id", "rfc-negative-index", [1]);
rfc("items", "$.items[::-1].id", "rfc-negative-step", [3, 2, 1]);
rfc("items", "$.items[2:0:-1].id", "rfc-negative-step", [3, 2]);
rfc("items", "$.items[?@.id > 1].id", "rfc-filter", [2, 3]);
rfc("items", "$.items[?@.id == 1 || @.id == 3].id", "rfc-filter", [1, 3]);
rfc("items", "$.items[?length(@) == 1].id", "rfc-filter", [1, 2, 3]);
rfc("items", "$.items[?(length(@) == 1)].id", "rfc-function", [1, 2, 3]);
same("items", "$.items[?@.id == '1'].id");
rfc("items", "$.items[?length(@)]", "rfc-filter", ERROR);
rfc("items", "$.items[?@.*.x > 1]", "rfc-filter", ERROR);
rfc("items", "$.items[?@.id ==]", "rfc-filter", ERROR);
rfc("items", "$..[?@.id > 2].id", "rfc-filter", [3]);
rfc("items", "$.items[?count(@.*) == 1].id", "rfc-filter", [1, 2, 3]);
rfc("items", "$.items[?@.id > $.items[0].id].id", "rfc-filter", [2, 3]);
rfc("items", "$.items[?@.missing == @.alsoMissing].id", "rfc-filter", [1, 2, 3]);
same("items", "$.items[?(@.id > 1)][-1]");
same("items", "$.items[?(@.missing.deep)]");
add("mixed", "$.emptyArr[?(@.a ==)]", "eager-parse", ERROR);
add("mixed", "$.emptyArr[?(@)]", "eager-parse", ERROR);
add("mixed", "$.str[?(@)]", "eager-parse", ERROR);
// Rust strings cannot hold half of a surrogate pair.
add("strs", "$.strs[7][0]", "lone-surrogate", ["\ufffd"]);
add("unicode", "$.z[0]", "lone-surrogate", ["\ufffd"]);
same("unicode", "$.z[1:]", "$[?(@property.length > 1)]~");
add("mixed", "$.emptyArr[?(@.a.padStart(2))]", "eager-parse", ERROR);
add("mixed", "$.emptyArr[?(@.a; true)]", "eager-parse", ERROR);

// Coercion and every operator, as literal comparisons in a filter.
for (const expr of [
  "'1' == 1",
  "1 == '1'",
  "null == undefined",
  "null === undefined",
  "'' == 0",
  "'0' == false",
  "' ' == 0",
  "'\\t\\n' == 0",
  "'0x10' == 16",
  "'1e3' == 1000",
  "'1.' == 1",
  "'.5' == 0.5",
  "'Infinity' == 1/0",
  "'abc' == 0",
  "null == 0",
  "undefined == 0",
  "null >= 0",
  "undefined >= 0",
  "[] == false",
  "[0] == false",
  "[1,2] == '1,2'",
  "[1] == 1",
  "[[1]] == 1",
  "[null] == ''",
  "true == 1",
  "true == '1'",
  "true === 1",
  "'10' < '9'",
  "10 < 9",
  "'10' < 9",
  "'b' > 'a'",
  "'B' < 'a'",
  "'abc' < 'abd'",
  "'a' < 'aa'",
  "'' < 'a'",
  "null < 1",
  "undefined < 1",
  "'x' < 1",
  "'x' > 1",
  "1 <= 1",
  "'1' >= 1",
  "true > false",
  "true + 1 == 2",
  "null + 1 == 1",
  "undefined + 1",
  "'3' * '4' == 12",
  "'a' + 1 + 2 == 'a12'",
  "1 + 2 + 'a' == '3a'",
  "[1] + [2] == '12'",
  "'5' - 2 == 3",
  "'5' + 2 == '52'",
  "7 / 2 == 3.5",
  "-7 % 3 == -1",
  "7 % -3 == 1",
  "5.5 % 2 == 1.5",
  "1 / 0 > 1e308",
  "-1 / 0 < -1e308",
  "0 / 0 != 0 / 0",
  "0 / 0 == 0 / 0",
  "typeof null == 'object'",
  "typeof undefined == 'undefined'",
  "typeof [] == 'object'",
  "typeof /x/ == 'object'",
  "typeof 'x' == 'string'",
  "typeof 1 == 'number'",
  "typeof true == 'boolean'",
  "typeof @.id.toString == 'function'",
  "typeof @ == 'object'",
  "void 0 === undefined",
  "!0",
  "!!''",
  "!'0'",
  "!!-0",
  "~5 == -6",
  "~'3' == -4",
  "-'3' == -3",
  "+'' == 0",
  "+'x'",
  "+[] == 0",
  "+true == 1",
  "1 << 31 < 0",
  "1 << 32 == 1",
  "-1 >>> 28 == 15",
  "-1 >>> 0 == 4294967295",
  "-16 >> 2 == -4",
  "5 & 3 == 1",
  "(5 & 3) == 1",
  "5 | 2 == 7",
  "(5 | 2) == 7",
  "(5 ^ 1) == 4",
  "(2147483648 | 0) == -2147483648",
  "(4294967296.5 | 0) == 0",
  "1 + 2 * 3 == 7",
  "(1 + 2) * 3 == 9",
  "1 - 2 - 3 == -4",
  "12 / 3 / 2 == 2",
  "1 < 2 < 3",
  "3 > 2 > 1",
  "true ? false : true",
  "0 ? 1 : 0 ? 1 : 2",
  "0 || '' || null",
  "0 || 'x'",
  "1 && 0",
  "1 && 'y'",
  "null || undefined",
  "'a' && 'b' == 'b'",
  "[1, 2, 3].includes(2)",
  "[1, 2, 3].indexOf(3) == 2",
  "['a', 'b'].join('-') == 'a-b'",
  "[1, [2, 3]].join() == '1,2,3'",
  "[null, undefined, 1].join() == ',,1'",
  "[1, 2].toString() == '1,2'",
  "[0 / 0].includes(0 / 0)",
  "[0 / 0].indexOf(0 / 0) == -1",
  "['1'].includes(1)",
  "[1, 2, 3].includes(1, 1)",
  "[1, 2, 3].indexOf(1, -3) == 0",
  "[1, 2, 3].length == 3",
  "[1, 2, 3][1] == 2",
  "[1, 2, 3]['1'] == 2",
  "'abc'[1] == 'b'",
  "'abc'.length == 3",
  "(12.5).toString() == '12.5'",
  "(255).toString(16) == 'ff'",
  "(-255).toString(2) == '-11111111'",
  "(1e21).toString() == '1e+21'",
  "(1.005).toFixed(2) == '1.00'",
  "(2.5).toFixed(0) == '3'",
  "(-1.5).toFixed(0) == '-2'",
  "(0.000001).toFixed(7) == '0.0000010'",
  "(1e21).toFixed(2) == '1e+21'",
  "(123.456).toFixed() == '123'",
  "(-0.0001).toFixed(2) == '-0.00'",
  "(0.5).toFixed(0) == '1'",
  "(1.45).toFixed(1) == '1.4'",
  "(8.345).toFixed(2) == '8.35'",
  "/a/.test('cat')",
  "/^a/.test('cat')",
  "/A/i.test('cat')",
  "/^t/m.test('ca\\nt')",
  "/a.t/.test('a\\nt')",
  "/a.t/s.test('a\\nt')",
  "/\\d+/.test('a1')",
  "/\\w/.test('é')",
  "/\\s/.test('\\u00a0')",
  "/\\bcat/.test('a cat')",
  "/(a)\\1/.test('aa')",
  "/(?<=x)y/.test('xy')",
  "/(?<!x)y/.test('xy')",
  "/a(?=b)/.test('ab')",
  "/a(?!b)/.test('ab')",
  "/[^]/.test('\\n')",
  "/[]/.test('a')",
  "/a{2}/.test('aa')",
  "/a{,2}/.test('a{,2}')",
  "/}/.test('}')",
  "/]/.test(']')",
  "/[[]/.test('[')",
  "/\\//.test('/')",
  "/(?<name>a)\\k<name>/.test('aa')",
  "/\\u0041/.test('A')",
  "/\\x41/.test('A')",
  "/\\cJ/.test('\\n')",
  "/\\p{L}/u.test('é')",
  "/a/.test()",
  "/und/.test(undefined)",
  "/a/x.test('a')",
  "/(/.test('a')",
  "'a-b-c'.split('-').length == 3",
  "'a-b-c'.split('-', 2).join() == 'a,b'",
  "'abc'.split('').join(' ') == 'a b c'",
  "'a1b2c'.split(/\\d/).join() == 'a,b,c'",
  "'a1b'.split(/(\\d)/).join() == 'a,1,b'",
  "''.split(',').length == 1",
  "''.split('').length == 0",
  "'abc'.split().length == 1",
  "'abc'.split(undefined, 0).length == 0",
  "'abc'.split(/(?:)/).length == 3",
  "'a,b,'.split(',').length == 3",
  "'test'.match(/t/g).length == 2",
  "'test'.match(/x/g) == null",
  "'test'.match(/(t)(e)/)[2] == 'e'",
  "'test'.match(/e/).index == 1",
  "'test'.match(/e/).input == 'test'",
  "'test'.match('es')[0] == 'es'",
  "'test'.match()[0] == ''",
  "'test'.match(/(x)?t/)[1] === undefined",
  "'  x '.trim() == 'x'",
  "'\\u00a0x\\ufeff'.trim() == 'x'",
  "'abc'.slice(-2) == 'bc'",
  "'abc'.slice(1, -1) == 'b'",
  "'abc'.slice(2, 1) == ''",
  "'abc'.substring(2, 0) == 'ab'",
  "'abc'.substring(-5, 1) == 'a'",
  "'abc'.substring(1) == 'bc'",
  "'abcabc'.indexOf('c', 3) == 5",
  "'abcabc'.lastIndexOf('a') == 3",
  "'abcabc'.lastIndexOf('a', 2) == 0",
  "'abc'.indexOf('') == 0",
  "'abc'.lastIndexOf('') == 3",
  "'abc'.includes('')",
  "'abc'.includes('c', 3)",
  "'abc'.startsWith('b', 1)",
  "'abc'.endsWith('b', 2)",
  "'abc'.includes(/b/)",
  "'ABC'.toLowerCase() == 'abc'",
  "'straße'.toUpperCase() == 'STRASSE'",
  "'ΟΔΟΣ'.toLowerCase() == 'οδος'",
  "'🤔'.length == 2",
  "'🤔x'.indexOf('x') == 2",
  "'abc'.toString() == 'abc'",
  "'1,2' == [1, 2]",
  "@.id.toString().padStart(2) == ' 1'",
  "@.id.toString().charAt(0) == '1'",
  "@.id.toPrecision(2) == '1.0'",
  "[1, 2].map",
  "'abc'.replace('a', 'b') == 'bbc'",
  "'abc'.toLocaleUpperCase() == 'ABC'",
  "'abc'.concat('d') == 'abcd'",
]) {
  const path = `$.items[?(${expr})].id`;
  const unsupportedMethod = /padStart|charAt|toPrecision|\.map$|replace\(|toLocaleUpperCase|concat\(/.test(expr);
  if (unsupportedMethod) unsupported("items", path);
  else same("items", path);
}

// Each value against the operators, so coercion runs over every type.
same(
  "vals",
  "$.vals[?(@ == 1)]",
  "$.vals[?(@ === 1)]",
  "$.vals[?(@ != 1)]",
  "$.vals[?(@ !== 1)]",
  "$.vals[?(@ == '1')]",
  "$.vals[?(@ == 0)]",
  "$.vals[?(@ == '')]",
  "$.vals[?(@ == null)]",
  "$.vals[?(@ == undefined)]",
  "$.vals[?(@ === null)]",
  "$.vals[?(@ == true)]",
  "$.vals[?(@ == false)]",
  "$.vals[?(@ < 2)]",
  "$.vals[?(@ > '5')]",
  "$.vals[?(@ <= 1)]",
  "$.vals[?(@ >= '9')]",
  "$.vals[?(@ < 'b')]",
  "$.vals[?(@ + 1 == 2)]",
  "$.vals[?(@ + '' == '1')]",
  "$.vals[?(@ - 1 == 0)]",
  "$.vals[?(@ * 2 == 2)]",
  "$.vals[?(@ / 2 == 0.5)]",
  "$.vals[?(@ % 2 == 1)]",
  "$.vals[?(@ | 0)]",
  "$.vals[?(@ & 1)]",
  "$.vals[?(@ ^ 1)]",
  "$.vals[?(~@ == -2)]",
  "$.vals[?(@ << 1 == 2)]",
  "$.vals[?(@ >> 1 == 0)]",
  "$.vals[?(@ >>> 0 == 4294967295)]",
  "$.vals[?(-@ == -1)]",
  "$.vals[?(+@ == 1)]",
  "$.vals[?(!@)]",
  "$.vals[?(!!@)]",
  "$.vals[?(typeof @ == 'string')]",
  "$.vals[?(typeof @ === 'object')]",
  "$.vals[?(void @)]",
  "$.vals[?(@ ? true : false)]",
  "$.vals[?(@ || false)]",
  "$.vals[?(@ && true)]",
  "$.vals[?([1, '1'].includes(@))]",
  "$.vals[?(['1', 1].indexOf(@) >= 0)]",
  "$.vals[?(@ == @)]",
  "$.vals[?(@ === @)]",
  "$.vals[?(@ != @)]",
  "$.vals[?(@.length == 1)]",
  "$.vals[?(@.length > 0)]",
  "$.vals[?(@ == [1])]",
  "$.vals[?(@ == '1,2')]",
  "$.vals[?(@ == '[object Object]')]",
  "$.vals[?(@ < 'a')]",
  "$.vals[?(@ > -2 && @ < 2)]",
  "$.vals[?(@property > 15)]",
  "$.vals[?(@property % 5 == 0)]~",
  "$.vals[(@.length - 1)]",
  "$.vals.*@string()",
  "$.vals.*@number()",
  "$.vals.*@integer()",
  "$.vals.*@boolean()",
  "$.vals.*@null()",
  "$.vals.*@object()",
  "$.vals.*@array()",
  "$.vals.*@scalar()",
  "$.vals.*@nonFinite()",
  "$.vals.*@undefined()",
  "$.vals.*@function()",
  "$.vals.*@other()",
  "$.vals.*@foo()",
  "$.vals[*]@string()",
  "$.vals[0]@number()",
  "$.vals[1]@string()",
  "$..*@null()",
  "$..*@array()",
  "$.vals[?(@ == 1)]~",
  "$.vals[?(@ == 1)]^",
  "$.vals[0:3]~",
  "$.vals[:3]@number()",
);

// Types, nulls and empties.
same(
  "mixed",
  "$.*@string()",
  "$.*@number()",
  "$..*@integer()",
  "$..*@boolean()",
  "$..*@null()",
  "$..*@object()",
  "$..*@array()",
  "$..*@scalar()",
  "$.str@string()",
  "$.str.length",
  "$.str[0]",
  "$.str[1:3]",
  "$.str[*]",
  "$.empty.length",
  "$.zero",
  "$.zero.x",
  "$.n",
  "$.n.x",
  "$.n~",
  "$.arr[*]",
  "$.arr[?(@)]",
  "$.arr[?(@ == null)]",
  "$.arr[?(@ === null)]",
  "$.arr[?(@ === undefined)]",
  "$.arr[4][0]",
  "$.arr[5].a",
  "$.arr..a",
  "$.arr.length",
  "$.obj.*",
  "$.obj[*]~",
  "$.obj.length",
  "$.emptyArr[*]",
  "$.emptyArr[0]",
  "$.nested..value",
  "$.nested.deep.deeper.value",
  "$..deeper",
  "$..value^",
  "$..value^^",
  "$..value^^^",
  "$..value^^^^",
  "$.*[?(@ == 1)]",
  "$..[?(@ === null)]",
  "$.nested[?(@.deeper)]",
  "$..*",
  "$..",
  "$.*.*",
  "$.t",
  "$.f",
  "$[?(@ === false)]~",
  "$[?(@ === 0)]~",
  "$[?(@ === '')]~",
  "$[?(typeof @ == 'number')]",
  "$[?(@property.length == 1)]",
  "$[?(@property.startsWith('e'))]~",
  "$.str[(@.length - 1)]",
  "$.str[('length')]",
  "$.arr[(@.length - 1)].a",
  "$.arr[?(@.a)]",
  "$.arr[?(@ == 3)]",
  "$.arr[?(@ == '3')]",
  "$.arr[?(@.length)]",
);

// People: nulls, missing keys and nested filters.
same(
  "people",
  "$.people[?(@.address)].name",
  "$.people[?(@.address.city == 'Paris')].name",
  "$.people[?(@.address && @.address.city == 'Paris')].name",
  "$.people[?(@.age > 30)].name",
  "$.people[?(@.age == null)].name",
  "$.people[?(@.age === undefined)].name",
  "$.people[?(@.email)].name",
  "$.people[?(!@.email)].name",
  "$.people[?(@.nickname == undefined)].name",
  "$.people[?(@.missing.deep)]",
  "$.people[?(typeof @.age == 'number')].name",
  "$.people[?(@.age >= 18 && @.age < 65)].name",
  "$..address.city",
  "$..city",
  "$.people[*].address.city",
  "$.people[*].address",
  "$.people[?(@.tags[0] == 'dev')].name",
  "$.people[?(@['name'] == 'Ann')].age",
  "$.people[?(@.name.length > 3)].name",
  "$.people[?(@.tags.includes('admin'))].name",
  "$.people[?(@.tags.indexOf('dev') == 0)].name",
  "$.people[?(@.tags.join('|') == 'dev|ops')].name",
  "$.people[?(@.tags.join() == 'dev,ops')].name",
  "$.people[?(@.tags.toString() == 'admin')].name",
  "$.people[?(@.tags.length == 0)].name",
  "$.people[?(@.tags == 'admin')].name",
  "$.people[?(@.tags == 'dev,ops')].name",
  "$.people[?(@.tags[?(@ == 'dev')])].name",
  "$.people[?(@.pets[?(@.type == 'cat')])].name",
  "$.people[?(@.pets[?(@.age > 5)])].name",
  "$.people[?(@.tags[?(@ == 'nope')] || @.age > 1)].name",
  "$.people[?(@.pets[(@.length-1)])].name",
  "$.people[?(@.address[?(@ == 'Paris')])].name",
  "$.groups[?(@.members[?(@.active)])].name",
  "$.groups[?(@[?(@.active)])].name",
  "$.people[?(@.email.endsWith('example.com'))].name",
  "$.people[?(@.email && @.email.endsWith('example.com'))].name",
  "$.people[?(@.email.split('@')[0] == 'd')].name",
  "$.people[?(@.name.match(/^[A-C]/))].name",
  "$.people[?(@.name.toUpperCase().includes('LE'))].name",
  "$.people[?(@.age > 18)].pets[*].type",
  "$.people[*].pets[?(@.age < 5)].type",
  "$.people..type",
  "$.people[*].tags[*]",
  "$.people[*].tags.length",
  "$.people[?(@.address.zip)].name",
  "$.people[?(@.address != null && @.address.zip)].name",
  "$.people[?(@.age > 100)]",
  "$.people[?(@.age > 100)].name",
  "$.people.length",
  "$.people[*]~",
  "$.people[?(@.name == 'Bob')].address",
  "$.people[?(@.name == 'Bob')].address.city",
  "$.people[?(@.name == 'Bob')]..city",
  "$.people[1].address~",
  "$.people[*].name^",
  "$.people[?(@.tags.length > 1)].tags[-1:]",
  "$.people[?(@path.endsWith('[2]'))].name",
  "$.people[?(@root.groups.length == 2)].name",
);
rfc("people", "$.people[?count(@.tags[*]) > 1].name", "rfc-filter", ["Ann"]);
rfc("people", "$.people[?(count(@.tags[*]) > 1)].name", "rfc-function", ["Ann"]);
rfc("people", "$.people[?match(@.name, 'A.*')].name", "rfc-filter", ["Ann"]);
rfc("people", "$.people[?(match(@.name, 'A.*'))].name", "rfc-function", ["Ann"]);
rfc("people", "$.people[?search(@.name, 'o')].name", "rfc-filter", ["Bob", "Cleo"]);
rfc("people", "$.people[?(search(@.name, 'o'))].name", "rfc-function", ["Bob", "Cleo"]);
rfc("people", "$.people[?value(@.age) == 31].name", "rfc-filter", ["Ann"]);
rfc("people", "$.people[?(value(@.age) == 31)].name", "rfc-function", ["Ann"]);
rfc("people", "$.people[?length(@.name) > 3].name", "rfc-filter", ["Cleo", "Dmitri"]);
rfc("people", "$.people[?(length(@.name) > 3)].name", "rfc-function", ["Cleo", "Dmitri"]);
rfc("people", "$.people[?@.tags[?@ == 'dev']].name", "rfc-filter", ["Ann", "Dmitri"]);
rfc("people", "$.people[?count(@.pets[?@.type == 'cat']) > 0].name", "rfc-filter", ["Ann", "Cleo"]);
rfc("people", "$.people[?@.address.city == 'Paris'].name", "rfc-filter", ["Ann", "Dmitri"]);
rfc("people", "$.people[?@.age].name", "rfc-filter", ["Ann", "Bob", "Dmitri"]);
rfc("people", "$.people[?!@.age].name", "rfc-filter", ["Cleo"]);
rfc("people", "$.people[?@.email].name", "rfc-filter", ["Ann", "Cleo", "Dmitri"]);
rfc("people", "$.people[?@.address == null].name", "rfc-filter", ["Bob"]);
rfc("people", "$.people[?@.age < 20 || !(@.age >= 20)].name", "rfc-filter", ["Bob", "Cleo"]);
same("people", "$.people[?(@.tags[-1] == 'ops')].name");
rfc("people", "$.people[-1].name", "rfc-negative-index", ["Dmitri"]);
rfc("people", "$.people[*].tags[-1]", "rfc-negative-index", ["ops", "admin", "dev"]);
same("people", "$.people[?match(@.name, '[')].name");
rfc("people", "$.people[?(match(@.name, 'A'))].name", "rfc-function", []);
same("people", "$.people[?match(@.age, '3.*')].name");
rfc("people", "$.people[?(count(@) == 1)].name", "rfc-function", ["Ann", "Bob", "Cleo", "Dmitri"]);
rfc("people", "$.people[?(value(@.pets[*].age) > 5)].name", "rfc-function", ["Ann", "Dmitri"]);
rfc("people", "$.people[?count(@..age) == 2].name", "rfc-filter", ["Ann", "Cleo", "Dmitri"]);
rfc("people", "$.people[?@.name == $.people[0].name].age", "rfc-filter", [31]);

// The bookstore through RFC 9535 syntax.
rfc("store", "$..book[-1].title", "rfc-negative-index", ["The Lord of the Rings"]);
rfc("store", "$..book[-2].title", "rfc-negative-index", ["Moby Dick"]);
rfc("store", "$..book[::-1].price", "rfc-negative-step", [22.99, 8.99, 12.99, 8.95]);
rfc("store", "$..book[-1::-2].price", "rfc-negative-step", [22.99, 12.99]);
rfc("store", "$.store.book[?@.price < 10].title", "rfc-filter", ["Sayings of the Century", "Moby Dick"]);
rfc("store", "$.store.book[?@.isbn].title", "rfc-filter", ["Moby Dick", "The Lord of the Rings"]);
rfc("store", "$.store.book[?!@.isbn].title", "rfc-filter", ["Sayings of the Century", "Sword of Honour"]);
rfc("store", "$.store.book[?@.price < 10 && @.category == 'fiction'].title", "rfc-filter", ["Moby Dick"]);
rfc("store", "$.store.book[?@.price > $.store.bicycle.price].title", "rfc-filter", ["The Lord of the Rings"]);
rfc("store", "$.store.book[?search(@.title, '^S')].title", "rfc-filter", ["Sayings of the Century", "Sword of Honour"]);
rfc("store", "$.store.book[?match(@.isbn, '0-5.*')].title", "rfc-filter", ["Moby Dick"]);
rfc("store", "$.store.book[?length(@) == 5].title", "rfc-filter", ["Moby Dick", "The Lord of the Rings"]);
rfc("store", "$.store.book[?(length(@.title) > 15)].title", "rfc-function", ["Sayings of the Century", "The Lord of the Rings"]);
rfc("store", "$.store.book[?(count(@.*) == 5)].title", "rfc-function", ["Moby Dick", "The Lord of the Rings"]);
rfc("store", "$.store.book[?(value(@.price) < 9)].title", "rfc-function", ["Sayings of the Century", "Moby Dick"]);
rfc("store", "$.store.book[?(match(@.author, '.*Tolkien'))].author", "rfc-function", ["J. R. R. Tolkien"]);
rfc("store", "$..[?@.color].color", "rfc-filter", ["red"]);
rfc("store", "$..book[?@.author =~ 'x']", "rfc-filter", ERROR);
rfc("store", "$.store.book[?@.price == 8.95].title", "rfc-filter", ["Sayings of the Century"]);
rfc("store", "$.store.book[?@.title == \"Moby Dick\"].price", "rfc-filter", [8.99]);
rfc("store", "$.store.book[?@.missing == @.other].title", "rfc-filter",
  ["Sayings of the Century", "Sword of Honour", "Moby Dick", "The Lord of the Rings"]);
rfc("store", "$.store.book[?@ == @].price", "rfc-filter", [8.95, 12.99, 8.99, 22.99]);
rfc("store", "$.store.book[?@.price != 8.95 && @.price != 12.99].price", "rfc-filter", [8.99, 22.99]);

// Recursive descent order over a nested document.
same(
  "deep",
  "$..a",
  "$..b",
  "$..*",
  "$..[0]",
  "$..[*]",
  "$..a..b",
  "$..a.b",
  "$.w..v",
  "$..[?(@.v)]",
  "$..[?(@.v > 1)].v",
  "$..v",
  "$..*~",
  "$..b~",
  "$..b^",
  "$..c[*]",
  "$..c[1:]",
  "$..c..a",
  "$..[?(@.b)].b",
  "$..[?(@ && @.b > 1)].b",
  "$..x.y",
  "$..y",
  "$..[?(@ === null)]",
  "$..[(@.length - 1)]",
  "$..a[?(@.b)]",
  "$.a.a.c[*].a.b",
  "$.c[0][1][0]",
  "$.c[*][*]",
  "$.c..*",
  "$..*@integer()",
  "$..*@object()",
  "$..*.b",
  "$...b",
  "$....b",
  "$..a.*",
  "$..['b']",
  '$..["b"]',
  "$..[b]",
  "$..[a,v]",
);
rfc("deep", "$..[-1]", "rfc-negative-index", [{ b: 4 }, { a: 5 }, [2], 2]);
rfc("deep", "$..c[-1].b", "rfc-negative-index", [4]);

// Keys that look like operators, and quoted names.
same(
  "weird",
  "$.weird.*",
  "$.weird['*']",
  "$.weird[*]",
  "$.weird.$",
  "$.weird.`$",
  "$.weird.~",
  "$.weird['a.b']",
  '$.weird["a.b"]',
  "$.weird.a.b",
  "$.weird['a,b']",
  "$.weird.`x",
  "$.weird[`x]",
  "$.weird['`x']",
  "$.weird['x y']",
  '$.weird["?(true)"]',
  '$.weird[""]',
  '$.weird["%@%"]',
  "$.weird['a~b']",
  '$.weird["a~b"]',
  '$.weird["quote\\"key"]',
  '$.weird["single\'key"]',
  '$.weird["back\\\\slash"]',
  "$.weird.length",
  "$.weird['length']",
  "$.weird['0:2']",
  '$.weird["0:2"]',
  "$.weird.^",
  "$.weird.@",
  "$.weird.plain",
  "$.plain.x",
  "$.*",
  "$['plain']['x']",
  "$.weird..",
  "$.weird[?(@ > 20)]",
  "$.weird[?(@property == '*')]",
  "$.weird[?(@property.length > 4)]~",
  '$["weird"]["*"]',
  '$["weird"]["~"]',
  '$["weird"]["$"]',
  '$["weird"]["\\u0061.b"]',
);
add("weird", "$['*']", "literal-key", ["root-star"]);
add("weird", "$['..']", "literal-key", []);
add("weird", "$.weird['?(true)']", "literal-key", [15]);
add("weird", "$.weird['%@%']", "literal-key", [17]);
same("weird", "$.weird['']");
add("weird", "$.weird['single\\'key']", "literal-key", [20]);
same("weird", "$.weird['quote\"key']");
add("weird", "$.weird['back\\\\slash']", "literal-key", [21]);
same("weird", "$.weird[\"'q'\"]");
same("weird", "$.weird['\"dq\"']");
add("weird", "$.weird[']']", "literal-key", [12]);
same("weird", '$.weird["]"]');
add("weird", "$.weird['[']", "literal-key", [11]);
add("weird", "$.weird['a.b','a,b']", "literal-key", [7, 8]);
add("weird", '$.weird["a.b", "x y"]', "literal-key", [7, 10]);
add("weird", '$.weird[ "a.b" ]', "literal-key", [7]);
add("weird", "$.weird['\\u0061.b']", "literal-key", [7]);
same("weird", '$.weird["*"].x');
same("weird", '$.weird["*"]');
same("weird", '$["*"]');
same("weird", '$.weird["a.b"]~');
same("weird", '$["weird"]["a.b"]^');
same("weird", '$["weird"][*]');
same("weird", "$['plain'].*");
add("store", "$..book[0]['title','author']", "literal-key", ["Sayings of the Century", "Nigel Rees"]);
add("store", '$..book[0]["title","price"]', "literal-key", ["Sayings of the Century", 8.95]);
add("store", '$..book[?(@.price > 20)]["title", "isbn"]', "literal-key", ["The Lord of the Rings", "0-395-19395-8"]);
same("store", "$['store']['book'][*]['title']");

// Unicode keys and values.
same(
  "unicode",
  "$.ключ",
  "$['ключ']",
  '$["emoji 🤔"]',
  "$.日本.語",
  "$..語",
  "$.ü[1]",
  "$[?(@ == 'значение')]",
  "$.*~",
  "$.*",
  '$["\\u043a\\u043b\\u044e\\u0447"]',
  "$[?(@property.length == 2)]",
  "$[?(@property == 'emoji 🤔')]",
  "$.z.length",
  "$.z[2]",
  "$[?(@.length == 4)]",
  "$[?(@ < 'й')]",
);
add("unicode", "$['\\u043a\\u043b\\u044e\\u0447']", "literal-key", ["значение"]);

// Integer-like keys come first in JavaScript objects.
same(
  "numeric",
  "$.*",
  "$[*]",
  "$..*",
  "$.*~",
  "$.2",
  "$['10']",
  '$["01"]',
  "$[2]",
  "$[-1]",
  "$.a[2:5]",
  "$.a[?(@ > 6)]",
  "$.a[?(@property % 3 == 0)]",
  "$.a[1:9:3]",
  "$.a[-3:]",
  "$.a[::3]",
  "$.a[::0]",
  "$.a[100:]",
  "$.a[-100:2]",
  "$.a[3:3]",
  "$.a[5:2]",
  "$.a[0,3,5]",
  "$.a[(@.length/2)]",
  "$.a[(@.length/3)]",
  "$.a[?(@ % 2 == 0 && @ > 4)]",
  "$.a[007]",
  "$.a[1.0]",
  "$.a[ 1 ]",
  "$.a[0, 1]",
  "$.a[-:]",
  "$.a[:-]",
  "$.a[-0:2]",
  "$.a[2:4:]",
  "$.a[:]",
  "$.a[::]",
  "$.a[8:]~",
  "$.a[?(@ > 7)]~",
  "$[(1 + 1)]",
  "$[('1' + '0')]",
);
rfc("numeric", "$.a[-1]", "rfc-negative-index", [9]);
rfc("numeric", "$.a[-10]", "rfc-negative-index", [0]);
same("numeric", "$.a[-11]");
rfc("numeric", "$.a[8:2:-2]", "rfc-negative-step", [8, 6, 4]);
rfc("numeric", "$.a[:-8:-3]", "rfc-negative-step", [9, 6, 3]);
rfc("numeric", "$.a[1::-1]", "rfc-negative-step", [1, 0]);

// Numbers as JavaScript prints them.
same(
  "nums",
  "$.nums[*]",
  "$.nums[?(@.toString() == '1e+21')]",
  "$.nums[?(@ + '' == '1e-7')]",
  "$.nums[?(@.toFixed(2) == '2.50')]",
  "$.nums[?(@.toFixed(0) == '3')]",
  "$.nums[?(@.toFixed(2) == '0.10')]",
  "$.nums[?(@.toFixed(2) == '1.00')]",
  "$.nums[?(@.toFixed(0) == '-2')]",
  "$.nums[?(@.toFixed(0) == '1')]",
  "$.nums[?(@.toString(16) == '64')]",
  "$.nums[?(@.toString(16) == 'ff')]",
  "$.nums[?(@.toString() == '123456789012345680000')]",
  "$.nums[?(@.toString() == '5e-324')]",
  "$.nums[?(@.toString() == '0.000001')]",
  "$.nums[?(@.toString() == '1.5e-7')]",
  "$.nums[?(@.toString() == '1e+300')]",
  "$.nums[?(@ > 1e20)]",
  "$.nums[?(@ < 1e-6)]",
  "$.nums[?(@ % 1 != 0)]",
  "$.nums[?(@ == 0.1)]",
  "$.nums[?(@ == '0.1')]",
  "$.nums[?(@.toFixed(3) == '1.005')]",
  "$.nums[?(@.toFixed(20) == '0.10000000000000000555')]",
  "$.nums[?((@ | 0) == @)]",
  "$.nums[?(@ >>> 0 == 1)]",
  "$.nums[(@.length - 1)]",
);
unsupported("nums", "$.nums[?(@.toPrecision(2) == '2.5')]", "$.nums[?(@.toExponential() == '1e+0')]");
same("nums", "$.nums[?(@.toString(3) == '0.1')]", "$.nums[?(@.toString(2).length > 20)]", "$.nums[?(@.toString(36) == '1.i')]", "$.nums[?(@.toString(16) == '2.8')]");
same("rawnums", "$.n[*]", "$.n[?(@ === 0)]", "$.n[?(1 / @ < 0)]", "$.n[?(@ > 1e308)]", "$.n[?(@ == 10.5)]", "$.n.length");

// String methods.
same(
  "strs",
  "$.strs[?(@.includes('o'))]",
  "$.strs[?(@.includes('o', 5))]",
  "$.strs[?(@.startsWith('He'))]",
  "$.strs[?(@.startsWith('ll', 2))]",
  "$.strs[?(@.endsWith('d'))]",
  "$.strs[?(@.endsWith('l', 4))]",
  "$.strs[?(@.indexOf('l') == 2)]",
  "$.strs[?(@.indexOf('l', 3) == 3)]",
  "$.strs[?(@.lastIndexOf('l') == 9)]",
  "$.strs[?(@.lastIndexOf('l', 5) == 3)]",
  "$.strs[?(@.toLowerCase() == 'abc')]",
  "$.strs[?(@.toUpperCase() == 'HELLO')]",
  "$.strs[?(@.trim() == 'padded')]",
  "$.strs[?(@.trimStart() == 'padded  ')]",
  "$.strs[?(@.trimEnd() == '  padded')]",
  "$.strs[?(@.slice(1, 3) == 'el')]",
  "$.strs[?(@.slice(-3) == 'rld')]",
  "$.strs[?(@.slice(2, -2) == 'l')]",
  "$.strs[?(@.substring(3, 1) == 'el')]",
  "$.strs[?(@.substring(-1, 2) == 'He')]",
  "$.strs[?(@.split(',').length == 3)]",
  "$.strs[?(@.split('-')[1] == 'y')]",
  "$.strs[?(@.split('').length == 3)]",
  "$.strs[?(@.split(/[-,]/).length == 3)]",
  "$.strs[?(@.split(',', 2).length == 2)]",
  "$.strs[?(@.split(/(-)/).length == 5)]",
  "$.strs[?(@.split().length == 1)]",
  "$.strs[?(@.match(/l+/) && @.match(/l+/)[0] == 'll')]",
  "$.strs[?(@.match(/o/g) && @.match(/o/g).length == 2)]",
  "$.strs[?(@.match(/(\\w+) (\\w+)/) && @.match(/(\\w+) (\\w+)/)[2] == 'world')]",
  "$.strs[?(@.match(/xyz/) == null)]",
  "$.strs[?(@.match('l{2}'))]",
  "$.strs[?(@.match(/l/) && @.match(/l/).index == 2)]",
  "$.strs[?(@.toString() == 'ABC')]",
  "$.strs[?(@.length == 5)]",
  "$.strs[?(@[0] == 'H')]",
  "$.strs[?(@['length'] > 5)]",
  "$.strs[?(@.length == 3 && @[2] == 'C')]",
  "$.strs[?(/^h/i.test(@))]",
  "$.strs[?(/k$/m.test(@))]",
  "$.strs[?(/e.b/s.test(@))]",
  "$.strs[?(/e.b/.test(@))]",
  "$.strs[?(/(?<=x-)y/.test(@))]",
  "$.strs[?(/(l)\\1/.test(@))]",
  "$.strs[?(/\\bworld/.test(@))]",
  "$.strs[?(/caf\\u00e9/.test(@))]",
  "$.strs[?(/\\d/.test(@))]",
  "$.strs[?(/[^a-z]/.test(@))]",
  "$.strs[?(/^[A-Z]+$/.test(@))]",
  "$.strs[?(/l/g.test(@))]",
  "$.strs[?(/o/g.test(@) || /o/g.test(@))]",
  "$.strs[?(@.match(/[aeiou]/g) && @.match(/[aeiou]/g).length > 2)]",
  "$.strs[?(@.toLowerCase().startsWith('h'))]",
  "$.strs[?(@.trim().length < @.length)]",
  "$.strs[?(@.includes(','))]",
  "$.strs[?(@.split(',').includes('b'))]",
  "$.strs[?(@.split(',').indexOf('c') == 2)]",
  "$.strs[?(@.split('-').join('+') == 'x+y+z')]",
  "$.strs[?(@.length > 8)].length",
  "$.strs[*].length",
  "$.strs[1][0]",
  "$.strs[7].length",
  "$.strs[?(@.includes('\\n'))]",
  "$.strs[?(@ > 'b')]",
  "$.strs[?(@ < 'B')]",
  "$.strs[?(@.slice(-2) == 'ok')]",
);
unsupported(
  "strs",
  "$.strs[?(@.padStart(10) == '     Hello')]",
  "$.strs[?(@.replace('l', 'L') == 'HeLlo')]",
  "$.strs[?(@.charAt(0) == 'H')]",
  "$.strs[?(@.repeat(2) == 'ABCABC')]",
  "$.strs[?(@.concat('!') == 'ABC!')]",
  "$.strs[?(@.at(-1) == 'C')]",
  "$.strs[?(@.normalize() == 'café')]",
  "$.strs[?(@.split(',').map)]",
  "$.strs[?(@.split(',').reverse())]",
  "$.strs[?(@.codePointAt(0) > 200)]",
);

// Path syntax odds and ends, and scripts returning odd values.
same(
  "store",
  "$.store.book[0].title^^^",
  "$..book[?(@property === 0 || @property === 3)].title",
  "$['store'].book[?(@['price'] < 10)]['title']",
  "$.store.book[?(@.title == 'a]b')]",
  '$.store.book[?(@.title == "x)]")]',
  "$.store.book[?(@.author == 'J. R. R. Tolkien')].title",
  "$..book[?(@.author.match(/\\./))].title",
  "$.store.book[?(@.price > 10)]['title']",
  "$..[?(@.isbn)].title",
  "$.store.book[?(@.isbn)].isbn.length",
  "$.store.book[?(@.price > 10 && @.title.length < 20)].title",
  "$.store.book.0.title",
  "$..book[?(@.price)].title.length",
  "$.store.book[0].title.",
  "$..book[0]..title",
  "$.store.book[ 0 ]",
  "$.store['book'][0]['title'].length",
  "$.store.book.*.author",
  "$.store.book[*]['author']",
  '$["store"].book',
  "$.'store'",
  "$.store.'book'",
  "$[store][book]",
  "$.store[book][0]",
  "$.store.book['0']",
  '$.store.book["0"]',
  "@.store",
  "store.book[0].title",
  "$store",
  "$.store.book[0]title",
  "$.store.book[ ?(@.isbn) ]",
  "$.store.book[?( @.isbn )].title",
  "$.store.book[?(@.isbn)] .title",
  "$.store.book[0,1]~",
  "$.store.book[0,1].title~",
  "$.store.book[*].title^^",
  "$.store.*[?(@.price > 15)]",
  "$..book[?(@.price < 10)].category^",
  "$[(@property)]",
  "$[(@path)]",
  "$.store[(@parentProperty)]",
  "$[?(@parent === null)]~",
  "$.store[?(@parent.store)]~",
  "$..[?(@parentProperty === 'book')].title",
  "$..book[?(typeof @.isbn == 'undefined')].title",
  "$..book[?(@.price > 9 ? @.price < 20 : false)].title",
  "$..book[?(_$_v.price > 20)].title",
  "$..book[?(_$_root.store.book.length == 4)].title",
  "$..book[([0])].title",
  "$..book[([0, 1])].title",
  "$..book[({})]",
  "$..book[(/x/)]",
  "$..book[(1.5)]",
  "$..book[(-1)]",
  "$..book[(1e21)]",
  "$..book[('0' + '')].title",
  "$..book[('@string()')]",
  "$..book[('^')]",
  "$..book[('~')]",
  "$..book[('..')].title",
  "$..book[('$')]",
  "$..book[('`0')].title",
);
same(
  "items",
  "$.items[?([1,2,].length == 2)].id",
  "$.items[?([1,,2].length == 3)].id",
  "$.items[?('abc'.includes('a' 'b'))].id",
  "$.items[?('\\x41' == 'x41')].id",
  "$.items[?('\\u0041' == 'u0041')].id",
  "$.items[?('a\\'b' == \"a'b\")].id",
  "$.items[?(.5 == 0.5)].id",
  "$.items[?(5. == 5)].id",
  "$.items[?(1e3 == 1000)].id",
  "$.items[?(1E-3 == 0.001)].id",
  "$.items[?(1.5e+1 == 15)].id",
  "$.items[?(1e)].id",
  "$.items[?(1a)].id",
  "$.items[?(1..toString())].id",
  "$.items[?(ключ)].id",
  "$.items[?(@.id == 1 ? 'a' : 'b')].id",
  "$.items[?(@.id == 1 ? 'a')].id",
  "$.items[?(@.id.toString)].id",
  "$.items[?(@.id.toString === @.id.toString)].id",
  "$.items[?(@.id.toString == 'function () { [native code] }')].id",
  "$.items[?(@.id.toFixed(1) + '' == '1.0')].id",
  "$.items[?(@.id.toFixed(101))].id",
  "$.items[?(@.id.toString(1))].id",
  "$.items[?(@.id.toString(37))].id",
  "$.items[?(@.id.toString(undefined) == '1')].id",
  "$.items[?((@.id).toString() == '2')].id",
  "$.items[?(@ . id == 2)].id",
  "$.items[?(@[ 'id' ] == 2)].id",
  "$.items[?(@['i' + 'd'] == 2)].id",
  "$.items[?(@[['id']] == 2)].id",
  "$.items[?(@.id.length)].id",
  "$.items[?(@.id['toString']() == '3')].id",
  "$.items[?(@.id['toFixed'](0) == '3')].id",
  "$.items[?(@['id']['toString'] && true)].id",
  "$.items[?((@.id.toString)() == '1')].id",
  "$.items[?(/x/.flags)].id",
  "$.items[?(/x/.lastIndex == 0)].id",
  "$.items[?(@.id && @.id.missing)].id",
  "$.items[?(@.id.missing.deeper)].id",
  "$.items[?(@.address?.city)].id",
  "$.items[?(@?.id == 2)].id",
  "$.items[?(@.id > 1)]['id']",
  "$.items[?(@.id)][('id')]",
  "$.items[0,1]~",
  "$.items[?(/x/gi.flags == 'gi')].id",
  "$.items[?(/a\\/b/.source == 'a\\\\/b')].id",
  "$.items[?(/x/m.multiline && !/x/.global)].id",
  "$.items[?(@.id)]..id",
  "$.items[*].id^^",
  "$.items[*].id^^^",
  "$.items[?(@.id == 2)]^[0].id",
  "$.items[?(@ == @root.items[1])].id",
  "$.items[?(@root.items.indexOf(@) == 2)].id",
  "$.items[?(@root.items.includes(@))].id",
);
same(
  "people",
  "$.people[0]['name']['length']",
  "$.people[?(@.address?.city == 'Paris')].name",
  "$.people[?(@.address != null ? @.address.city == 'Paris' : false)].name",
  "$.people[?(@.pets.length && @.pets[0].age > 5)].name",
  "$.people[?(@.pets[0] && @.pets[0].type == 'dog')].name",
  "$.people[?(@.tags.join(@.name) == 'devAnnops')].name",
  "$.people[?(@.tags.indexOf('ops', 1) == 1)].name",
  "$.people[?(@.tags.includes('dev', -1))].name",
);
add("people", "$.people[?(@.age > 30)]['name','age']", "literal-key", ["Ann", 31, "Dmitri", 64]);
same("weird", `$.weird[?(@path == "$['weird']['a.b']")]`, `$.weird[?(@path == "$['weird']['single'key']")]`, "$.weird[?(@path.includes('*'))]");

// Root documents that are not objects.
same("rootstr", "$", "$.length", "$[0]", "$[*]", "$..*");
add("rootstr", "$[?(@)]", "eager-parse", ERROR);
add("items", "$..id[?(@)]", "eager-parse", ERROR);
same("rootnum", "$", "$.x", "$..*");
same("roottrue", "$", "$[*]");
same("rootarr", "$", "$[*]", "$..*", "$[0]", "$.length");
same("rootobj", "$", "$.*", "$..*", "$~");
same(
  "rootarray",
  "$",
  "$[*]",
  "$[0].a",
  "$[*].a",
  "$..a",
  "$[1].b[1]",
  "$..b[*]",
  "$[?(@.a)]",
  "$[?(@.a > 1)].b",
  "$[?(@ == 'x')]",
  "$[?(@ == 5)]~",
  "$[?(@ === null)]",
  "$[2:]",
  "$.length",
  "$[(@.length - 1)]",
  "$..*",
  "$[*]~",
);
rfc("rootarray", "$[-1]", "rfc-negative-index", [null]);
rfc("rootarray", "$[-2]", "rfc-negative-index", [5]);
add("rootzero", "$", "falsy-root", [0]);
add("rootempty", "$", "falsy-root", [""]);
add("rootfalse", "$", "falsy-root", [false]);
add("rootnull", "$", "falsy-root", [null]);
add("rootnull", "$.a", "falsy-root", []);

// The plugin's literal fast path reads own properties of falsy values too.
same(
  "falsy",
  '$["s"].length',
  '$["s"][0]',
  '$["t"].length',
  '$["t"][1]',
  '$["a"].length',
  '$["z"].length',
  '$["f"].x',
  '$["n"].x',
  '$["o"].length',
  "$.s.length",
  "$.t.length",
  '$.s["length"]',
);

// Duplicate keys keep their first position and last value.
same("dupes", "$", "$.*", "$.a", "$.*~", "$[0]", "$[1]");

const caseNames = new Set();
const problems = [];
const out = { generator: "generate-jsonpath-plus.mjs", jsonpathPlus: version, docs: {}, cases: [] };
for (const [name, doc] of Object.entries(docs)) {
  out.docs[name] = typeof doc === "string" && name.startsWith("raw") || name === "dupes" ? doc : JSON.stringify(doc);
}
for (const { doc, path, deviation, expect } of cases) {
  const key = `${doc} ${path}`;
  if (caseNames.has(key)) throw new Error(`duplicate case ${key}`);
  caseNames.add(key);
  JSONPath.clearCache();
  const result = oldPlugin(out.docs[doc], path);
  const plus = "error" in result ? { error: true } : { content: result.content };
  const entry = { doc, path };
  if (deviation == null) {
    entry.expected = plus;
  } else {
    entry.deviation = deviation;
    entry.expected = expect === ERROR ? { error: true } : { content: JSON.stringify(expect, null, 2) };
    entry.jsonpathPlus = plus;
    if (JSON.stringify(entry.expected) === JSON.stringify(plus)) {
      problems.push(`${key} is marked ${deviation} but jsonpath-plus already gives that`);
    }
    if (deviation.startsWith("rfc-") && plus.content !== "[]" && !plus.error) {
      problems.push(`${key} would change a non-empty jsonpath-plus result: ${plus.content}`);
    }
  }
  out.cases.push(entry);
}
if (problems.length > 0) throw new Error(problems.join("\n"));
writeFileSync(join(here, "jsonpath_plus.json"), `${JSON.stringify(out, null, 2)}\n`);
const deviations = out.cases.filter((c) => c.deviation).length;
console.log(`${out.cases.length} cases, ${deviations} deviations`);
