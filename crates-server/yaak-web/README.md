# yaak-web

The network half of Yaak in a browser — and, with `--serve`, the half that
hands the browser the app in the first place.

A tab can't see an HTTP response the way a desktop app can: CORS hides most
headers (2 of 8 in a typical response), redirects are followed silently, and
there is no timeline. So the tab renders the request and posts it here, and this
process puts it on the network with the desktop's own engine (`yaak-http`) and
streams back everything that happened — every header, every redirect hop, DNS
timing, the body — for the tab to store.

It is a **stateless executor**. It keeps nothing: no database, no files, no
sessions, no cookies between calls. Every byte it sees comes from the tab in the
request, and every byte it returns is stored by the tab. Restart it any time.

## Self-hosting it

One container, no configuration, nothing behind it:

```shell
docker run -p 8080:8080 ghcr.io/mountain-loop/yaak-web
```

Open <http://localhost:8080>. The image carries the built web client and this
binary, which serves it — so the app and its sends are on one origin, and the
tab's send URL is a path (`/v1/http/send`) rather than an address anyone has to
configure. The image is `linux/amd64` and `linux/arm64`, built from
`Dockerfile.web` at the repo root.

Your data lives in your browser (SQLite compiled to wasm, in IndexedDB), not in
the container. The container is stateless: nothing is written to disk, so
upgrading is `docker pull` and nothing else.

Two settings are worth knowing about:

```shell
docker run -p 8080:8080 \
  -e YAAK_WEB_ALLOW_PRIVATE_NETWORKS=true \
  -e YAAK_WEB_RATE_LIMIT_PER_MINUTE=0 \
  ghcr.io/mountain-loop/yaak-web
```

- **`YAAK_WEB_ALLOW_PRIVATE_NETWORKS=true`** lets sends reach loopback,
  private and link-local addresses. Off by default, and it should stay off on
  anything strangers can reach — see [What it refuses](#what-it-refuses-and-why).
  Turn it on for an instance on your own network, where calling the API on the
  next machine is the whole point. Note that "private" is relative to the
  *container*: `127.0.0.1` is the container itself, and reaching the Docker
  host means `host.docker.internal` (or `--network host`).
- **`YAAK_WEB_RATE_LIMIT_PER_MINUTE`** defaults to 120 sends per client IP,
  which suits a public instance and not a team of your own; `0` disables it.

Behind a reverse proxy, add `YAAK_WEB_TRUST_FORWARDED_FOR=true` so the rate
limit sees real client addresses instead of its own — and only then, since
otherwise anyone can spoof the header. If the reverse proxy buffers responses,
tell it not to: sends are streamed, and the `X-Accel-Buffering: no` header this
binary sets is honoured by nginx-shaped ones.

## Running it from source

```shell
cargo run -p yaak-web -- --serve dist/apps/yaak-client
```

after a `YAAK_TARGET=web SKIP_WASM_BUILD=1 npx vp -C apps/yaak-client build`.
Without `--serve` it is the send executor alone, which is what the frontend
dev server wants:

```shell
cargo run -p yaak-web
YAAK_TARGET=web npm run dev --workspace @yaakapp/yaak-client
```

A dev build looks for the server at `http://127.0.0.1:9227` (the Vite server is a
different origin and serves no `/v1`); a production build sends to its own
origin unless `VITE_YAAK_WEB_URL` was set when it was built.

## Configuration

Every flag has a `YAAK_WEB_*` environment variable, so a container needs no
arguments; `--help` lists them all.

| Flag | Default | What |
| --- | --- | --- |
| `--serve` | off | Also serve a built web client from this directory, on the same origin. |
| `--bind` | `127.0.0.1:9227` | Listen address. The image sets `0.0.0.0:8080`. |
| `--allow-private-networks` | off | Allow sends to loopback, private and link-local addresses. |
| `--allowed-origins` | `*` | CORS origins, comma-separated. Unused when the app is served from here: same origin, no CORS. |
| `--max-request-bytes` | 16 MiB | Largest rendered request accepted from the tab. |
| `--max-response-bytes` | 64 MiB | Largest upstream body relayed before the send is cut off. |
| `--max-timeout-secs` | 60 | Ceiling on a send's timeout; a request asking for more (or none) gets this. |
| `--rate-limit-per-minute` | 120 | Sends per client IP per minute; 0 disables. |
| `--max-concurrent` | 256 | Sends in flight at once. |
| `--trust-forwarded-for` | off | Take the client IP from `X-Forwarded-For`. Only behind a load balancer that sets it. |

## Serving the app

`--serve DIR` puts a file server behind the API routes: `/v1/*` is matched
first, everything else comes from `DIR`, and a path with no file behind it gets
`index.html` so the app's own routes survive a refresh. Responses are compressed
(gzip or zstd) on the fly. `/assets/*` is cached forever — Vite content-hashes
those names — and everything else is `no-cache`, so a new deploy arrives on the
next reload.

Serving files changes nothing about sending: the same rendered request, the same
destination policy, the same stateless executor. It exists so that a
self-hosted Yaak is one thing to run rather than two.

## Split deployments

The app and the sender can still be separate services — one CDN-hosted bundle and
one server elsewhere, or one server shared by several fronts. Then the bundle has
to be told where to send, at build time:

```shell
docker build -f Dockerfile.web \
  --build-arg VITE_YAAK_WEB_URL=https://send.example.com .
```

and the server needs the CORS origins its callers use, since the requests are no
longer same-origin:

```shell
docker run -p 8080:8080 \
  -e YAAK_WEB_ALLOWED_ORIGINS=https://yaak.example.com \
  ghcr.io/mountain-loop/yaak-web \
  yaak-web
```

The trailing `yaak-web` is a command override: the same image run without
`--serve`, so it executes sends and serves no app.

## What it refuses, and why

A hosted sender is, by construction, a machine that makes HTTP requests on
behalf of strangers. Left alone that is an open relay into whatever network it
sits on. So by default it refuses to connect to:

- loopback (`127/8`, `::1`), private (`10/8`, `172.16/12`, `192.168/16`,
  `fc00::/7`), link-local (`169.254/16` — where cloud metadata lives — and
  `fe80::/10`), carrier-grade NAT, multicast, reserved and unspecified ranges,
  IPv4 addresses carried inside IPv6 forms (`::ffff:a.b.c.d`, the well-known
  NAT64 prefix, 6to4), and the whole NAT64 local-use range;
- anything not `http://` or `https://`.

The check runs **on the resolved addresses, after DNS**, for every hop of a
redirect chain, so a public hostname that points at an internal address is
caught, and so is a `Location:` header that points at one. It also refuses body
types that would read files on its own disk (`binary`, multipart file
fields), since no browser tab could legitimately mean those.

Refusals are logged with the reason. On a public instance (`web.yaak.app`, or
anything else strangers can reach) this must stay on: the machine's private
network is the host's, not the user's, so a `localhost` or LAN API is not the
user's to reach through it — the desktop app is what reaches those. On an
instance you run for yourself, that reasoning is inverted, and
`--allow-private-networks` inverts the policy with it. It allows every range
above, including `169.254.169.254`, so use it only where the network on the
other side is one the users are entitled to.

There is no authentication either way: an instance is anonymous, protected by
the per-client rate limit and the destination policy. Anything more (a shared
token, per-user quotas) is a later slice and would sit in front of `send_http`
in `main.rs`. Put TLS in front of a public instance.

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
template already rendered by the tab; the server builds the URL, headers and
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
rate limit, capacity) are plain HTTP errors (`403`, `400`, `429`, `503`) with
`{"error": "…"}`, not streams.

Why a streamed HTTP response and not a WebSocket: one `POST` is stateless by
construction, cancellable by closing the connection, readable with `curl`, and
needs no upgrade handling on either side. A WebSocket only earns its keep when
traffic is bidirectional, which a single send is not.

The TypeScript side of this contract is generated from `src/wire.rs` by ts-rs
into `bindings/` (run `cargo test -p yaak-web` after changing a frame)
and published to the tab as `@yaakapp-internal/web`, so a change to the
wire on one side is a type error on the other.

`GET /v1/health` reports the version and the effective limits.

## What comes later

Not built, by design, but the router is shaped for it: a WebSocket relay
(`/v1/ws/relay`) and a gRPC relay (`/v1/grpc/relay`) would be long-lived,
bidirectional endpoints on the same binary, behind the same destination policy
and limits. They differ from this endpoint in holding per-connection
in-memory state while a connection is open (never persisted), which brings
connection limits and a larger abuse surface — the reason they are separate
work.
