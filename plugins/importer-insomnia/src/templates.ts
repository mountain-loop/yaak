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
    /\s*(?:'((?:[^'\\]|\\['"\\nrt])*)'|"((?:[^"\\]|\\['"\\nrt])*)"|(-?\d+(?:\.\d+)?))\s*/y;
  let offset = 0;
  while (offset < input.length) {
    token.lastIndex = offset;
    const match = token.exec(input);
    if (!match) return input.trim() === "" ? [] : null;
    const literal = (match[1] ?? match[2] ?? match[3]!).replace(
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

function convertTag(name: string, input: string, requestIds: Set<string>): string | null {
  const args = parseArgs(input);
  if (args == null) return null;
  if (name === "uuid" && args.length === 1 && ["v1", "v4"].includes(args[0]!)) {
    return `uuid.${args[0]}()`;
  }
  if (name === "faker" && args.length === 1 && args[0] === "randomUUID") {
    return "uuid.v4()";
  }
  if (name !== "response" || args.length < 3 || args.length > 5) return null;
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
  return null;
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
