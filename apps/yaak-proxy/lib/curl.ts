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
 * The flow's request as a curl command: its method, URL, headers and `body`, the request body
 * decoded. Headers curl sets itself are left out, and an encoded response is asked for with
 * `--compressed`, as the app did.
 */
export function toCurl(flow: Pick<Flow, "method" | "url" | "requestHeaders">, body: string | null) {
  const args: string[] = [];
  const hasBody = body != null && body !== "";
  const defaultMethod = hasBody ? "POST" : "GET";
  if (flow.method.toUpperCase() === "HEAD" && !hasBody) {
    // So curl expects no body after the headers.
    args.push("--head");
  } else if (flow.method.toUpperCase() !== defaultMethod) {
    // A method is any token, which can hold characters a shell would act on.
    const plain = /^[A-Za-z0-9_-]+$/.test(flow.method);
    args.push(`-X ${plain ? flow.method : shellQuote(flow.method)}`);
  }
  // curl reads brackets and braces in a URL as ranges and sets unless told not to.
  if (/[[\]{}]/.test(flow.url)) args.push("--globoff");
  args.push(shellQuote(flow.url));
  let compressed = false;
  for (const { name, value } of flow.requestHeaders) {
    const lower = name.toLowerCase();
    if (LEFT_OUT.has(lower) || lower.startsWith("proxy-") || lower.startsWith(":")) continue;
    // The body is the decoded one, so its encoding no longer applies.
    if (lower === "content-encoding" && hasBody) continue;
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
