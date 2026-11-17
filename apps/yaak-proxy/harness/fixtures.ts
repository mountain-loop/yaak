import type { Flow, GetFlowBodyResponse } from "@yaakapp-internal/proxy-lib";

/** A flow fixture with its two bodies, as the engine's `get_flow_body` RPC returns them */
export interface FlowFixture {
  label: string;
  flow: Flow;
  requestBody: GetFlowBodyResponse;
  responseBody: GetFlowBodyResponse;
}

function body(data: string | Uint8Array): GetFlowBodyResponse {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return { data: btoa(binary), truncated: false, storedSize: bytes.length };
}

const base: Flow = {
  id: "fl_harness",
  number: 1429,
  createdAt: "2026-11-04T22:10:00",
  updatedAt: "2026-11-04T22:10:01",
  startedAt: "2026-11-04T22:10:00.000",
  method: "GET",
  url: "https://api.example.com/",
  clientHttpVersion: "HTTP/2",
  upstreamHttpVersion: "HTTP/2",
  remoteAddr: "93.184.216.34:443",
  status: 200,
  contentType: null,
  requestHeaders: [],
  responseHeaders: [],
  requestSize: 0,
  responseSize: 0,
  requestTruncated: false,
  responseTruncated: false,
  elapsedHeadersMs: 84,
  elapsedMs: 112,
  error: null,
  cancelled: false,
  savedRequestId: null,
  clientPid: 4211,
  clientName: "curl",
  clientBundleId: null,
  clientPath: "/usr/bin/curl",
  clientCwd: null,
  streamKind: null,
  messageCount: 0,
  grpcService: null,
  grpcMethod: null,
  grpcStatus: null,
  grpcMessage: null,
  graphqlOperation: null,
  tunnelled: false,
  tunnelReason: null,
  tunnelExcludedBy: null,
  tunnelExcludedBuiltIn: false,
  tunnelRejectedBy: null,
  reconnectRequested: false,
  tlsRejected: null,
  agentRead: false,
  clientAddr: "127.0.0.1:54321",
  elapsedConnectMs: 18,
  elapsedTlsMs: 41,
  elapsedRequestMs: 43,
  upstreamTlsVersion: "TLSv1.3",
  upstreamTlsCipher: "TLS13_AES_128_GCM_SHA256",
};

const jsonRequest = JSON.stringify({ amount: 4200, currency: "usd", capture: true });
const jsonResponse = JSON.stringify({
  id: "pi_3Q8x",
  object: "payment_intent",
  amount: 4200,
  currency: "usd",
  status: "succeeded",
  charges: { data: [{ id: "ch_1", paid: true }] },
});
const graphqlRequest = JSON.stringify({
  query: "query GetViewer { viewer { login } }",
  operationName: "GetViewer",
});
const formRequest = "grant_type=client_credentials&client_id=yaak-proxy&scope=read+write";
const csvResponse = [
  "id,email,plan,created_at",
  "1,ada@example.com,pro,2026-10-01",
  "2,grace@example.com,team,2026-10-14",
  "3,linus@example.com,free,2026-11-02",
].join("\n");
const tsvResponse = [
  "sku\tname\tstock\tnote",
  "A-100\tDesk lamp\t42\tWarm white, dimmable, ships with a long braided fabric cable",
  "A-101\tMonitor arm\t7\t",
  "A-102\tKeyboard tray\t0\tBack in stock next week",
].join("\n");
const multipartBoundary = "yaakBoundary7MA4YWxk";
const multipartRequest = [
  `--${multipartBoundary}`,
  'Content-Disposition: form-data; name="title"',
  "",
  "Quarterly report",
  `--${multipartBoundary}`,
  'Content-Disposition: form-data; name="meta"; filename="meta.json"',
  "Content-Type: application/json",
  "",
  '{"pages":12,"draft":false}',
  `--${multipartBoundary}`,
  'Content-Disposition: form-data; name="rows"; filename="rows.csv"',
  "Content-Type: text/csv",
  "",
  "region,revenue\nnorth,1200\nsouth,980",
  `--${multipartBoundary}--`,
  "",
].join("\r\n");
const textResponse = "Uploaded 3 parts";
const htmlResponse =
  "<!doctype html><html><body style='font-family:sans-serif'><h1>Signed in</h1><p>You can close this window.</p></body></html>";
// A 24x24 PNG gradient
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAADnUlEQVR4nA3MEQJEIQBAwc95nOdxHj2J8zjP4zyP8zjP47wD7M4B5vv4BJ/kU3yaz/BZPsfn+QJf5Et8ma/wVb7G1/kG3+RbfJvv8F2+x/d9CIGQCIXQCIOwCIfwiICIiITIiIKoiIboiIGYiIXYiIO4iIf4R1IgJVIhNdIgLdIhPTIgIzIhM7IgK7IhO3IgJ3IhN/IgL/Ih/5ESKIlSKI0yKItyKI8KqIhKqIwqqIpqqI4aqIlaqI06qIt6qH+kBVqiFVqjDdqiHdqjAzqiEzqjC7qiG7qjB3qiF3qjD/qiH/ofGYGRGIXRGIOxGIfxmICJmITJmIKpmIbpmIGZmIXZmIO5mIf5R1ZgJVZhNdZgLdZhPTZgIzZhM7ZgK7ZhO3ZgJ3ZhN/ZgL/Zh/5ETOIlTOI0zOItzOI8LuIhLuIwruIpruI4buIlbuI07uIt7uH/kBV7iFV7jDd7iHd7jAz7iEz7jC77iG77jB37iF37jD/7iH/4fBUGQBEXQBEOwBEfwhECIhETIhEKohEbohEGYhEXYhEO4hEf4R1EQJVERNdEQLdERPTEQIzERM7EQK7ERO3EQJ3ERN/EQL/ER/1ESJElSJE0yJEtyJE8KpEhKpEwqpEpqpE4apElapE06pEt6pH+UBVmSFVmTDdmSHdmTAzmSEzmTC7mSG7mTB3mSF3mTD/mSH/kfFUGRFEXRFEOxFEfxlECJlETJlEKplEbplEGZlEXZlEO5lEf5R1VQJVVRNdVQLdVRPTVQIzVRM7VQK7VRO3VQJ3VRN/VQL/VR/1ETNElTNE0zNEtzNE8LtEhLtEwrtEprtE4btElbtE07tEt7tH/UBV3SFV3TDd3SHd3TAz3SEz3TC73SG73TB33SF33TD/3SH/0fDcGQDMXQDMOwDMfwjMCIjMTIjMKojMbojMGYjMXYjMO4jMf4R1MwJVMxNdMwLdMxPTMwIzMxM7MwK7MxO3MwJ3MxN/MwL/Mx/9ESLMlSLM0yLMtyLM8KrMhKrMwqrMpqrM4arMlarM06rMt6rH+0BVuyFVuzDduyHduzAzuyEzuzC7uyG7uzB3uyF3uzD/uyH/sfHcGRHMXRHMOxHMfxnMCJnMTJnMKpnMbpnMGZnMXZnMO5nMf5R1dwJVdxNddwLddxPTdwIzdxM7dwK7dxO3dwJ3dxN/dwL/dx/9ETPMlTPM0zPMtzPM8LvMhLvMwrvMprvM4bvMlbvM07vMt7vB8/gdf/dWsIbgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

export const fixtures: FlowFixture[] = [
  {
    label: "JSON POST",
    flow: {
      ...base,
      id: "fl_json",
      method: "POST",
      url: "https://api.stripe.com/v1/payment_intents?expand=charges&limit=1",
      contentType: "application/json",
      requestHeaders: [
        { name: "Content-Type", value: "application/json" },
        { name: "Authorization", value: "Bearer sk_test_51Hx" },
        { name: "Cookie", value: "session=abc123; theme=dark" },
        { name: "User-Agent", value: "curl/8.7.1" },
      ],
      responseHeaders: [
        { name: "Content-Type", value: "application/json; charset=utf-8" },
        { name: "Set-Cookie", value: "session=def456; Path=/; HttpOnly; Secure" },
        { name: "Request-Id", value: "req_9Z" },
      ],
      requestSize: jsonRequest.length,
      responseSize: jsonResponse.length,
    },
    requestBody: body(jsonRequest),
    responseBody: body(jsonResponse),
  },
  {
    label: "Form POST, HTML response",
    flow: {
      ...base,
      id: "fl_form",
      method: "POST",
      url: "https://auth.example.com/oauth/token",
      contentType: "text/html",
      requestHeaders: [
        { name: "Content-Type", value: "application/x-www-form-urlencoded" },
        { name: "Authorization", value: "Basic eWFhazpwcm94eQ==" },
      ],
      responseHeaders: [{ name: "Content-Type", value: "text/html; charset=utf-8" }],
      requestSize: formRequest.length,
      responseSize: htmlResponse.length,
    },
    requestBody: body(formRequest),
    responseBody: body(htmlResponse),
  },
  {
    label: "Image GET",
    flow: {
      ...base,
      id: "fl_image",
      url: "https://cdn.example.com/avatars/42.png?size=2",
      contentType: "image/png",
      requestHeaders: [{ name: "Accept", value: "image/*" }],
      responseHeaders: [{ name: "Content-Type", value: "image/png" }],
      responseSize: png.length,
    },
    requestBody: body(""),
    responseBody: body(png),
  },
  {
    label: "Failed",
    flow: {
      ...base,
      id: "fl_failed",
      url: "https://unreachable.example.com/health",
      status: null,
      elapsedHeadersMs: null,
      elapsedMs: null,
      error: "dns error: failed to lookup address information: nodename nor servname provided",
      requestHeaders: [{ name: "Accept", value: "*/*" }],
    },
    requestBody: body(""),
    responseBody: body(""),
  },
  {
    label: "Tunnelled",
    flow: {
      ...base,
      id: "fl_tunnel",
      method: "CONNECT",
      url: "bank.example.com:443",
      status: null,
      elapsedHeadersMs: null,
      elapsedMs: 4_210,
      clientHttpVersion: "HTTP/1.1",
      upstreamHttpVersion: null,
      clientName: "Safari",
      clientBundleId: "com.apple.Safari",
      clientPath: "/Applications/Safari.app",
      requestSize: 3_412,
      responseSize: 48_210,
      tunnelled: true,
      tunnelReason: "not_listed",
    },
    requestBody: body(""),
    responseBody: body(""),
  },
  {
    label: "GraphQL POST",
    flow: {
      ...base,
      id: "fl_graphql",
      method: "POST",
      url: "https://api.github.com/graphql",
      contentType: "application/json",
      requestHeaders: [{ name: "Content-Type", value: "application/json" }],
      responseHeaders: [{ name: "X-Cache", value: "MISS" }],
      requestSize: graphqlRequest.length,
      responseSize: 64,
      graphqlOperation: "GetViewer",
    },
    requestBody: body(graphqlRequest),
    responseBody: body('{"data":{"viewer":{"login":"yaak"}}}'),
  },
  {
    label: "CSV GET",
    flow: {
      ...base,
      id: "fl_csv",
      url: "https://api.example.com/users/export.csv",
      contentType: "text/csv",
      requestHeaders: [{ name: "Accept", value: "text/csv" }],
      responseHeaders: [{ name: "Content-Type", value: "text/csv; charset=utf-8" }],
      responseSize: csvResponse.length,
    },
    requestBody: body(""),
    responseBody: body(csvResponse),
  },
  {
    label: "TSV GET",
    flow: {
      ...base,
      id: "fl_tsv",
      url: "https://api.example.com/inventory.tsv",
      contentType: "text/tab-separated-values",
      requestHeaders: [{ name: "Accept", value: "text/tab-separated-values" }],
      responseHeaders: [{ name: "Content-Type", value: "text/tab-separated-values" }],
      responseSize: tsvResponse.length,
    },
    requestBody: body(""),
    responseBody: body(tsvResponse),
  },
  {
    label: "Multipart POST",
    flow: {
      ...base,
      id: "fl_multipart",
      method: "POST",
      url: "https://api.example.com/reports",
      contentType: "text/plain",
      requestHeaders: [
        {
          name: "Content-Type",
          value: `multipart/form-data; boundary=${multipartBoundary}`,
        },
      ],
      responseHeaders: [{ name: "Content-Type", value: "text/plain; charset=utf-8" }],
      requestSize: multipartRequest.length,
      responseSize: textResponse.length,
    },
    requestBody: body(multipartRequest),
    responseBody: body(textResponse),
  },
  {
    label: "gRPC call",
    flow: {
      ...base,
      id: "fl_grpc",
      method: "POST",
      url: "https://grpc.example.com/pkg.Greeter/SayHello",
      contentType: "application/grpc",
      clientHttpVersion: "HTTP/2",
      upstreamHttpVersion: "HTTP/2",
      requestHeaders: [{ name: "Content-Type", value: "application/grpc" }],
      responseHeaders: [{ name: "Content-Type", value: "application/grpc" }],
      grpcService: "pkg.Greeter",
      grpcMethod: "SayHello",
      grpcStatus: 0,
    },
    requestBody: body(""),
    responseBody: body(""),
  },
];

/** An app icon for every flow in the harness, as base64 PNG */
export const appIconPng = btoa(String.fromCharCode(...png));
