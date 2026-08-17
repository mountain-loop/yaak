# yaak-send-proxy

The network half of Yaak in a browser.

A tab can't see an HTTP response the way a desktop app can: CORS hides most
headers (2 of 8 in a typical response), redirects are followed silently, and
there is no timeline. So the tab renders the request and posts it here, and this
process puts it on the network with the desktop's own engine (`yaak-http`) and
streams back everything that happened — every header, every redirect hop, DNS
timing, the body — for the tab to store.

It is a **stateless executor**. It keeps nothing: no database, no files, no
sessions, no cookies between calls. Every byte it sees comes from the tab in the
request, and every byte it returns is stored by the tab. Restart it any time.

## Running it

```shell
cargo run -p yaak-send-proxy
```

Listens on `127.0.0.1:9227`. Then run the web build against it:

```shell
YAAK_TARGET=web npm run dev --workspace @yaakapp/yaak-client
```

The tab looks for the proxy at `http://127.0.0.1:9227` unless
`VITE_YAAK_SEND_PROXY_URL` says otherwise at build time.

Every flag has a `YAAK_PROXY_*` environment variable, so a container needs no
arguments; `--help` lists them all.

| Flag | Default | What |
| --- | --- | --- |
| `--bind` | `127.0.0.1:9227` | Listen address. `0.0.0.0:9227` inside a container. |
| `--allowed-origins` | `*` | CORS origins, comma-separated. A hosted instance should name its web origin. |
| `--token` | unset | Require `Authorization: Bearer <token>`. Unset means anonymous, which is what the hosted funnel wants alongside the rate limit. |
| `--allow-private-networks` | off | Let sends reach private, loopback and link-local addresses. **Off by default; see below.** |
| `--allow-hosts` | empty | Only these hosts (`api.example.com`, `*.example.com`). Empty means any host not denied. |
| `--deny-hosts` | empty | Never these hosts. Checked before the allow list. |
| `--max-request-bytes` | 16 MiB | Largest rendered request accepted from the tab. |
| `--max-response-bytes` | 64 MiB | Largest upstream body relayed before the send is cut off. |
| `--max-timeout-secs` | 60 | Ceiling on a send's timeout; a request asking for more (or none) gets this. |
| `--rate-limit-per-minute` | 120 | Sends per client IP per minute; 0 disables. |
| `--max-concurrent` | 256 | Sends in flight at once. |
| `--trust-forwarded-for` | off | Take the client IP from `X-Forwarded-For`. Only behind a load balancer that sets it. |

## What it refuses, and why

A hosted proxy is, by construction, a machine that makes HTTP requests on
behalf of strangers. Left alone that is an open relay into whatever network it
sits on. So by default it refuses to connect to:

- loopback (`127/8`, `::1`), private (`10/8`, `172.16/12`, `192.168/16`,
  `fc00::/7`), link-local (`169.254/16` — where cloud metadata lives — and
  `fe80::/10`), carrier-grade NAT, multicast, reserved and unspecified ranges,
  and IPv4 addresses tunnelled inside IPv6 forms (`::ffff:a.b.c.d`, NAT64);
- anything not `http://` or `https://`.

The check runs **on the resolved addresses, after DNS**, for every hop of a
redirect chain, so a public hostname that points at an internal address is
caught, and so is a `Location:` header that points at one. It also refuses body
types that would read files on the proxy's disk (`binary`, multipart file
fields), since no browser tab could legitimately mean those.

Refusals are logged with the reason. A self-hosted instance on a private network
that legitimately needs to reach the services next to it turns the range check
off with `--allow-private-networks`, and can narrow that with `--allow-hosts`.

## Self-hosting

One binary, no dependencies. Build it and run it wherever you like:

```shell
cargo build --release -p yaak-send-proxy
YAAK_PROXY_BIND=0.0.0.0:9227 \
YAAK_PROXY_ALLOWED_ORIGINS=https://yaak.example.com \
YAAK_PROXY_TOKEN=change-me \
./target/release/yaak-send-proxy
```

Put TLS in front of it (a reverse proxy) — the token travels as a header. If the
reverse proxy buffers responses, tell it not to: the reply is a stream and the
`X-Accel-Buffering: no` header it sets is honoured by nginx-shaped ones.

## The wire

`POST /v1/http/send` with a JSON body:

```json
{
  "request":  { "url": "https://…", "method": "GET", "headers": […], "body": {…}, "bodyType": null, "urlParameters": […] },
  "settings": { "validateCertificates": true, "followRedirects": true, "timeoutMs": 0, "sendCookies": true, "storeCookies": true },
  "cookies":  [ … ] 
}
```

`request` is a Yaak `HttpRequest` in the desktop's own model shape with every
template already rendered by the tab; the proxy builds the URL, headers and
body from it exactly the way the desktop does after rendering. `cookies` is the
jar's contents (or `null` for no jar).

The reply is `application/x-ndjson`, one JSON frame per line, in the order things
happened:

| `type` | When | Carries |
| --- | --- | --- |
| `event` | as the engine produces them | one timeline event, in the desktop's `http_response_event.event` shape |
| `response` | once, when the final hop's headers arrive | status, all headers, request headers as sent, remote address, HTTP version, timing |
| `body` | as the body is read | a decompressed chunk, base64 |
| `done` | last, on success | elapsed, byte counts, and the cookie jar as the send left it |
| `error` | last, on failure | the reason, and any cookies collected before the failure |

Refusals that happen before anything is sent (a blocked destination, a bad body,
rate limit, missing token) are plain HTTP errors (`403`, `400`, `429`, `401`)
with `{"error": "…"}`, not streams.

Why a streamed HTTP response and not a WebSocket: one `POST` is stateless by
construction, cancellable by closing the connection, readable with `curl`, and
needs no upgrade handling on either side. A WebSocket only earns its keep when
traffic is bidirectional, which a single send is not.

The TypeScript side of this contract is generated from `src/wire.rs` by ts-rs
into `bindings/` (run `cargo test -p yaak-send-proxy` after changing a frame)
and published to the tab as `@yaakapp-internal/send-proxy`, so a change to the
wire on one side is a type error on the other.

`GET /v1/health` reports the version and the effective limits.

## What comes later

Not built, by design, but the router is shaped for it: a WebSocket relay
(`/v1/ws/relay`) and a gRPC relay (`/v1/grpc/relay`) would be long-lived,
bidirectional endpoints on the same binary, behind the same destination policy,
limits and token. They differ from this endpoint in holding per-connection
in-memory state while a connection is open (never persisted), which brings
connection limits and a larger abuse surface — the reason they are separate
work.
