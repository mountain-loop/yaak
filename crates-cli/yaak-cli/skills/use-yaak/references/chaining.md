# Chaining requests

The usual way to feed one response into the next request is a shell pipeline:
send, pipe through `jq`, stash in a variable, interpolate into the next command.
Yaak does not need that. A request can reference another request's response
directly, and Yaak resolves the dependency at send time — including sending the
upstream request first if it has to.

This is the highest-leverage thing the CLI offers, because the chain is stored
in the workspace. The user can re-run it from the app, and it keeps working
after the shell session is gone.

## Reading a value out of another response

```
${[ response.body.path(request='rq_login', path='$.token') ]}
```

`request` is the upstream request's ID. `path` is JSONPath for JSON responses
and XPath for XML. So a login-then-call-the-API pair is two requests and no glue:

```bash
yaak request create wk_abc123 --json '{
  "name": "Login",
  "method": "POST",
  "url": "${[ base_url ]}/auth/login",
  "bodyType": "application/json",
  "body": {"text": "{\"user\":\"demo\",\"pass\":\"${[ password ]}\"}"},
  "headers": [{"name": "Content-Type", "value": "application/json", "enabled": true}]
}'
# -> Created request: rq_login

yaak request create wk_abc123 --json '{
  "name": "List Orders",
  "method": "GET",
  "url": "${[ base_url ]}/orders",
  "authenticationType": "bearer",
  "authentication": {"token": "${[ response.body.path(request='rq_login', path='$.token') ]}"}
}'
```

Sending "List Orders" now sends "Login" first when it needs to, extracts
`$.token`, and puts it in the `Authorization` header.

Note the quoting: template function arguments use **single quotes**, so inside a
single-quoted shell string write the payload to a file, or escape as above, or
switch the outer shell quoting to double quotes and escape the inner JSON.
Writing the JSON payload to a file and using `--json "$(cat payload.json)"` is
the least error-prone for anything complex.

## Controlling when the upstream request re-sends

The `behavior` argument decides whether the dependency is actually sent:

| `behavior` | Meaning |
|---|---|
| `smart` (default) | Send only if there is no stored response yet |
| `always` | Send every time |
| `ttl` | Send if the newest response is older than `ttl` seconds (`0` never expires) |

```
${[ response.body.path(request='rq_login', path='$.token', behavior='ttl', ttl='300') ]}
```

`smart` is right for a token you fetch once. `ttl` matches a real token lifetime
and is usually the best choice for auth. `always` is for values that must be
fresh on every call, like a nonce.

## Other response accessors

```
${[ response.header(request='rq_login', header='X-Request-Id') ]}
${[ response.body.raw(request='rq_login') ]}
```

`response.body.path` also accepts `behavior`/`ttl`, and has an alias of plain
`response`.

## Other useful template functions

These come from bundled plugins and work anywhere a value is rendered:

| Function | Use |
|---|---|
| `uuid.v4()`, also `v1`, `v3`, `v5`, `v6`, `v7` | Idempotency keys, unique record names |
| `timestamp.unix()`, `timestamp.unixMillis()`, `timestamp.iso8601()` | Timestamps in bodies or signatures |
| `timestamp.format(...)`, `timestamp.offset(...)` | Formatted or relative times |
| `random.range(min='1', max='100', decimals='0')` | Sample data |
| `hash.sha256(input='…', encoding='hex')` | Digests — also `md5`, `sha1`, `sha512` |
| `hmac.sha256(input='…', key='…', encoding='hex')` | Signed request signatures |
| `base64.encode(input='…')`, `base64.decode(...)` | Encoded values |
| `url.encode(input='…')`, `url.decode(...)` | Escaping values for URLs |
| `fs.readFile(path='/abs/path', trim='true')` | Pull a value from a file on disk |
| `cookie.value(name='session')` | Read a cookie from the jar |
| `1password.item(...)` | Fetch a secret from 1Password rather than storing it |

Note the shapes that are easy to misremember: the encoders are `base64.encode`
and `url.encode`, not `encode.base64`; the random function is `random.range`,
not `random.number`; and there is no `timestamp.now`. Argument names vary per
function, and a wrong name renders as an error rather than an empty string, so
check the function in the app's template editor when unsure.

## When to chain and when not to

Chain when the dependency is part of the API's real shape: log in, then call;
create a resource, then fetch it by the returned ID. The workspace becomes a
runnable description of the API, which is the point.

Do not chain to smuggle in shell logic. If a value needs a conditional, a
computation, or a retry, do that in the shell and set an environment variable.
And do not build a long chain just to run a group of requests — `yaak send
<fl_id>` already sends every request in a folder sequentially, with
`--fail-fast` to stop at the first failure and `--parallel` when order does not
matter. Reach for a chain when a request genuinely *depends* on another's
response, not merely when it should run after it.
