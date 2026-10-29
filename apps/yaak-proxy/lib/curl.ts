import type { Flow } from "@yaakapp-internal/proxy-lib";

/** Headers curl works out itself, or that only meant something between the app and the proxy */
const LEFT_OUT = new Set([
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** `value` in single quotes for a POSIX shell */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The flow's request as a curl command: its method, URL, headers and body. Headers curl sets
 * itself are left out, and an encoded response is asked for with `--compressed`, as the app did.
 */
export function toCurl(flow: Pick<Flow, "method" | "url" | "requestHeaders">, body: string | null) {
  const args: string[] = [];
  const hasBody = body != null && body !== "";
  const defaultMethod = hasBody ? "POST" : "GET";
  if (flow.method.toUpperCase() !== defaultMethod) args.push(`-X ${flow.method}`);
  args.push(shellQuote(flow.url));
  let compressed = false;
  for (const { name, value } of flow.requestHeaders) {
    const lower = name.toLowerCase();
    if (LEFT_OUT.has(lower) || lower.startsWith("proxy-") || lower.startsWith(":")) continue;
    if (lower === "accept-encoding") {
      compressed = true;
      continue;
    }
    args.push(`-H ${shellQuote(`${name}: ${value}`)}`);
  }
  if (compressed) args.push("--compressed");
  if (hasBody) args.push(`--data-raw ${shellQuote(body)}`);
  return `curl ${args.join(" \\\n  ")}`;
}
