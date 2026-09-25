import { Buffer } from "node:buffer";
import { convertId } from "./common";

// Convert only syntax with a native equivalent. Leave filters, expressions and third-party
// tags intact rather than importing something that looks valid but means something different.
const identifier = /^[\p{L}\p{N}_][\p{L}\p{N}_.-]*$/u;

function argument(value: string): string {
  return `b64'${Buffer.from(value).toString("base64url")}'`;
}

function decodeArgument(value: string): string | null {
  if (!value.startsWith("b64::")) return value;
  const match = /^b64::([A-Za-z0-9+/_-]*={0,2})(?:::[^:]*)?$/.exec(value);
  if (!match) return null;
  const bytes = Buffer.from(match[1]!, "base64");
  const normalized = match[1]!.replace(/=+$/, "").replaceAll("+", "-").replaceAll("/", "_");
  if (bytes.toString("base64url") !== normalized) return null;
  const decoded = bytes.toString("utf8");
  return Buffer.from(decoded).equals(bytes) ? decoded : null;
}

/** Literal arguments only; never evaluate Nunjucks or silently skip unexpected tokens. */
function parseArgs(input: string): string[] | null {
  const args: string[] = [];
  const token =
    /\s*(?:'((?:[^'\\]|\\['"\\nrt])*)'|"((?:[^"\\]|\\['"\\nrt])*)"|(-?\d+(?:\.\d+)?)|(true|false))\s*/y;
  let offset = 0;
  while (offset < input.length) {
    token.lastIndex = offset;
    const match = token.exec(input);
    if (!match) return input.trim() === "" ? [] : null;
    const literal = (match[1] ?? match[2] ?? match[3] ?? match[4]!).replace(
      /\\(['"\\nrt])/g,
      (_, char: string) => ({ n: "\n", r: "\r", t: "\t" })[char] ?? char,
    );
    const decoded = decodeArgument(literal);
    if (decoded == null) return null;
    args.push(decoded);
    offset = token.lastIndex;
    if (offset === input.length) break;
    if (input[offset] !== ",") return null;
    offset++;
    if (input.slice(offset).trim() === "") return null;
  }
  return args;
}

/**
 * Insomnia's dropdown arguments fall back to the first option of their list when a tag leaves
 * them out, so every converter below mirrors that first option as its default.
 */

function convertUuid(args: string[]): string | null {
  // Version 4 is listed first, so a bare tag generates one.
  if (args.length === 0) return "uuid.v4()";
  if (args.length === 1 && ["v1", "v4"].includes(args[0]!)) return `uuid.${args[0]}()`;
  return null;
}

function convertNow(args: string[]): string | null {
  if (args.length > 2) return null;
  const [kind = "iso-8601", format = ""] = args;
  switch (kind.toLowerCase()) {
    case "iso-8601":
      return "timestamp.iso8601()";
    case "millis":
    case "ms":
      return "timestamp.unixMillis()";
    case "unix":
    case "seconds":
    case "s":
      return "timestamp.unix()";
    case "custom":
      // The format string is passed through untranslated. Insomnia formats with date-fns
      // today, like Yaak does, but older versions used Moment and those token sets differ
      // (eg. Moment's DD/YYYY against date-fns' dd/yyyy). A token that no longer means the
      // same thing shows up as a tag the user can correct.
      return `timestamp.format(format=${argument(format)})`;
    default:
      return null;
  }
}

/** The legacy timestamp tag takes no arguments and returns milliseconds. */
function convertTimestamp(args: string[]): string | null {
  return args.length === 0 ? "timestamp.unixMillis()" : null;
}

const base64Encodings: Record<string, string> = {
  normal: "base64",
  url: "base64url",
  // Insomnia's hex mode reads/writes hex rather than text. Yaak has no such mode, so this
  // falls back to plain base64, which at least imports as a tag instead of raw text.
  hex: "base64",
};

function convertBase64(args: string[]): string | null {
  if (args.length < 2 || args.length > 3) return null;
  // Assumed: exports written before the Kind argument existed pass (action, value), so a
  // lone second argument that names no kind is the value.
  const legacy = args.length === 2 && !Object.hasOwn(base64Encodings, args[1]!);
  const encoding = base64Encodings[legacy ? "normal" : args[1]!];
  const value = legacy ? args[1]! : (args[2] ?? "");
  if (encoding == null) return null;
  if (args[0] === "encode") {
    return `base64.encode(encoding='${encoding}', value=${argument(value)})`;
  }
  // Yaak's decoder reads both alphabets, so the kind doesn't change the call.
  if (args[0] === "decode") return `base64.decode(value=${argument(value)})`;
  return null;
}

const hashAlgorithms = ["md5", "sha1", "sha256", "sha512"];

function convertHash(args: string[]): string | null {
  if (args.length > 3) return null;
  const [algorithm = "md5", encoding = "hex", value = ""] = args;
  // Insomnia's own tag falls back to SHA-256 for algorithms outside its list.
  const name = hashAlgorithms.includes(algorithm.toLowerCase())
    ? algorithm.toLowerCase()
    : "sha256";
  // Insomnia offers only hex and base64, the same two digests Yaak does.
  const digest = encoding === "base64" ? "base64" : "hex";
  return `hash.${name}(input=${argument(value)}, encoding='${digest}')`;
}

function convertCookie(args: string[]): string | null {
  if (args.length !== 2) return null;
  const [url = "", name = ""] = args;
  if (name === "") return null;
  const domain = cookieDomain(url);
  const filter = domain === "" ? "" : `, domain=${argument(domain)}`;
  return `cookie.value(name=${argument(name)}${filter})`;
}

/** Insomnia matches cookies against a full URL, while Yaak filters the jar by domain. */
function cookieDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    // Not a URL we can read, usually because it holds a template tag. Keep the text so the
    // user can see and fix it rather than dropping the filter.
    return url.trim();
  }
}

function convertPrompt(args: string[]): string | null {
  if (args.length > 6) return null;
  const [title = "", label = "", defaultValue = "", storageKey = "", mask = "false"] = args;
  // Insomnia requires a title and shows the label above the input, falling back to the title.
  if (title === "" && label === "") return null;
  const parts = [`label=${argument(label === "" ? title : label)}`];
  if (storageKey !== "") {
    // Insomnia keeps a stored value until the app closes. Yaak's closest option keeps it
    // forever. Storing needs a namespace, and the workspace is what Yaak's editor defaults to.
    // oxlint-disable-next-line no-template-curly-in-string -- Yaak template syntax
    const namespace = argument("${[ctx.workspace()]}");
    parts.push("store='forever'", `namespace=${namespace}`, `key=${argument(storageKey)}`);
  }
  if (title !== "") parts.push(`title=${argument(title)}`);
  if (defaultValue !== "") parts.push(`defaultValue=${argument(defaultValue)}`);
  if (mask === "true") parts.push("password=true");
  return `prompt.text(${parts.join(", ")})`;
}

function convertResponse(args: string[], requestIds: Set<string>): string | null {
  if (args.length < 2 || args.length > 5) return null;
  const [attribute, request, filter = "", behavior = "never", maxAge = "0"] = args;
  if (!request || !requestIds.has(convertId(request))) return null;
  const behaviors: Record<string, string> = {
    never: "never",
    "no-history": "smart",
    always: "always",
    "when-expired": "ttl",
  };
  const convertedBehavior = Object.hasOwn(behaviors, behavior) ? behaviors[behavior] : null;
  if (!convertedBehavior || !/^\d+$/.test(maxAge)) return null;
  // Insomnia treats zero as immediately expired; Yaak uses zero for never expiring.
  if (convertedBehavior === "ttl" && Number(maxAge) === 0) return null;
  const common = `request=${argument(convertId(request))}, behavior='${convertedBehavior}', ttl='${maxAge}'`;
  if (attribute === "raw") {
    return `response.body.raw(${common})`;
  }
  if (attribute === "body") {
    // Insomnia returns a scalar for one match, but an array for several. Yaak's first/all
    // modes cannot express that automatically. Only convert definite paths for now.
    if (!/^\$(?:\.[\p{L}\p{N}_-]+|\[(?:0|[1-9]\d*)\])*$/u.test(filter.trim())) return null;
    return `response.body.path(${common}, path=${argument(filter.trim())}, result='first')`;
  }
  if (attribute === "header" && filter !== "") {
    return `response.header(${common}, header=${argument(filter.trim())})`;
  }
  // Insomnia's url attribute has no counterpart, since Yaak has no response URL function.
  return null;
}

function convertTag(name: string, input: string, requestIds: Set<string>): string | null {
  const args = parseArgs(input);
  if (args == null) return null;
  switch (name) {
    case "base64":
      return convertBase64(args);
    case "cookie":
      return convertCookie(args);
    case "faker":
      return args.length === 1 && args[0] === "randomUUID" ? "uuid.v4()" : null;
    case "hash":
      return convertHash(args);
    case "now":
      return convertNow(args);
    case "prompt":
      return convertPrompt(args);
    case "response":
      return convertResponse(args, requestIds);
    case "timestamp":
      return convertTimestamp(args);
    case "uuid":
      return convertUuid(args);
    default:
      return null;
  }
}

export function convertTemplateSyntax<T>(obj: T, requestIds = new Set<string>()): T {
  if (typeof obj === "string") {
    return obj
      .replace(/{{\s*([\s\S]*?)\s*}}/g, (full, expression: string) => {
        const trimmed = expression.trim();
        const bracket = /^_\s*\[\s*(['"])([^'"\\]+)\1\s*\]$/.exec(trimmed);
        const name = bracket?.[2] ?? trimmed.replace(/^_\./, "");
        return identifier.test(name) && !["true", "false", "null"].includes(name)
          ? `\${[ ${name} ]}`
          : full;
      })
      .replace(
        /{%\s*(\w+)\s*((?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|[^'"])*?)%}/g,
        (full, name: string, input: string) => {
          const converted = convertTag(name, input, requestIds);
          return converted == null ? full : `\${[ ${converted} ]}`;
        },
      ) as T;
  }
  if (Array.isArray(obj)) return obj.map((value) => convertTemplateSyntax(value, requestIds)) as T;
  if (typeof obj === "object" && obj != null) {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, convertTemplateSyntax(value, requestIds)]),
    ) as T;
  }
  return obj;
}
