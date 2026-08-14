# Authoring requests

Everything here is a field on the HTTP request model. Run
`yaak request schema http --pretty` to see the full, current schema, including
the authentication variants contributed by installed plugins.

## Two ways to create

Name, method, and URL have flags. Everything else needs JSON:

```bash
yaak request create wk_abc123 --name "List Pets" --method GET --url "https://api.example.com/pets"
```

```bash
yaak request create wk_abc123 --json '{
  "name": "Create Pet",
  "method": "POST",
  "url": "https://api.example.com/pets",
  "bodyType": "application/json",
  "body": {"text": "{\"name\":\"Rex\",\"species\":\"dog\"}"},
  "headers": [{"name": "Content-Type", "value": "application/json", "enabled": true}]
}'
```

Flags and JSON cannot be mixed on the same command. The workspace ID may be
omitted when only one workspace exists, and may also be carried inside the
payload as `workspaceId`.

## Bodies

`bodyType` decides how `body` is encoded onto the wire, and `body` is a
free-form object whose shape depends on that type. For text-ish types the
content lives in `body.text` as a **string**, so a JSON payload is
double-encoded: a JSON string containing JSON.

| `bodyType` | `body` |
|---|---|
| `application/json` | `{"text": "{\"key\":\"value\"}"}` |
| `text/xml` | `{"text": "<root/>"}` |
| `other` | `{"text": "…"}` |
| `graphql` | `{"query": "{ pets { id } }", "variables": "{\"n\":1}", "operationName": ""}` |
| `application/x-www-form-urlencoded` | `{"form": [{"name":"a","value":"1","enabled":true}]}` |
| `multipart/form-data` | `{"form": [{"name":"file","file":"/abs/path","enabled":true}]}` |
| `binary` | `{"filePath": "/abs/path"}` |
| `null` (omitted) | no body |

For `graphql`, note that `variables` is a **string** of JSON, not an object, and
that a GraphQL request sent with method `GET` moves query/variables/operationName
into the query string and sends no body at all.

For `multipart/form-data`, each entry is either a text field (`value`) or a file
(`file`, an absolute path), and may carry its own `contentType`.

**Add the `Content-Type` header yourself.** In the desktop app, choosing a body
type also writes a matching `Content-Type` into the request's headers, so it is
stored on the request rather than inferred at send time. Creating a request from
the CLI skips that step: `bodyType` alone controls how the body is *encoded*, and
nothing adds the header. A JSON body with no `Content-Type` goes out as untyped
bytes, which many APIs answer with 400 or 415.

```json
"bodyType": "application/json",
"body": {"text": "{\"name\":\"Rex\"}"},
"headers": [{"name": "Content-Type", "value": "application/json", "enabled": true}]
```

Use the same value as `bodyType`, with two exceptions the app also makes: `other`
pairs with `text/plain`, and `graphql` pairs with `application/json`. Multipart is
the one case to leave alone — the sender replaces that header with one carrying
the generated boundary.

Requests created this way end up identical to app-created ones, which matters
because the user will open them in the app afterwards.

## Headers

```json
"headers": [
  {"name": "Accept", "value": "application/json", "enabled": true},
  {"name": "X-Debug", "value": "1", "enabled": false}
]
```

`enabled: false` keeps a header in the app for the user to toggle without
sending it. Values accept template variables.

## URL parameters

One array covers both query string entries and path placeholders. A parameter
fills a path placeholder only when its **name starts with a colon** and matches
the placeholder in the URL. Everything else becomes a query string entry:

```json
"url": "https://api.example.com/pets/:petId/visits",
"urlParameters": [
  {"name": ":petId", "value": "42", "enabled": true},
  {"name": "limit",  "value": "10", "enabled": true}
]
```

That sends `https://api.example.com/pets/42/visits?limit=10` — `:petId` is
substituted into the path and dropped from the query string, `limit` is not.

This is the single easiest thing to get wrong here, and it fails **silently**.
Naming the parameter `petId` instead of `:petId` leaves `/pets/:petId/visits` in
the path as literal text and appends `?petId=42`, which most servers answer with
a 404. Always include the colon, and confirm with `yaak -v request send <id>`
that the `> GET …` line shows a substituted path.

## Authentication

`authenticationType` names a strategy and `authentication` holds its values. The
strategy names are not always what you would guess — the built-ins are `basic`,
`bearer`, `apikey`, `jwt`, `oauth1`, `oauth2`, `awsv4` (not "aws"), and
`windows` (not "ntlm"). Installed plugins can add more.

```json
"authenticationType": "bearer",
"authentication": {"token": "${[ api_token ]}"}
```

```json
"authenticationType": "basic",
"authentication": {"username": "admin", "password": "${[ admin_password ]}"}
```

```json
"authenticationType": "apikey",
"authentication": {"location": "header", "key": "X-Api-Key", "value": "${[ api_key ]}"}
```

OAuth 2.0 is the one to look up rather than attempt from memory. It has fifteen
fields, six of them required, and `grantType` is an enum:

```json
"authenticationType": "oauth2",
"authentication": {
  "grantType": "client_credentials",
  "clientId": "${[ client_id ]}",
  "clientSecret": "${[ client_secret ]}",
  "accessTokenUrl": "https://auth.example.com/oauth/token",
  "scope": "read:pets",
  "credentials": "body",
  "tokenName": "access_token",
  "headerName": "Authorization",
  "usePkce": false,
  "useExternalBrowser": false
}
```

`grantType` accepts `authorization_code`, `implicit`, `password`, or
`client_credentials`, and which other fields matter depends on which you pick:
`authorization_code` also wants `authorizationUrl` and `redirectUri`, while
`client_credentials` does not.

The exact fields for every strategy, and which are required, come from the
schema, which enumerates each installed strategy as a named variant under
`authentication`:

```bash
# display name plus the value to use for authenticationType
yaak request schema http | jq -r '.properties.authentication.oneOf[]
  | select(.title) | "\(.title): \(.description)"'

# the full shape of one strategy
yaak request schema http | jq '.properties.authentication.oneOf[]
  | select(.title == "OAuth 2.0")'
```

Because the list is built by loading plugins, it covers plugin-contributed
strategies too, not just the built-ins. Read it rather than guessing.

Set `authenticationType` to `null` to send no auth and stop inheriting from the
parent folder.

## Folders and inheritance

Folders are containers *and* a place to put shared configuration. Headers and
authentication set on a folder apply to every request inside it, so the common
pattern is one folder per API surface holding the auth:

```bash
yaak folder create wk_abc123 --name "Admin API"
yaak folder update --json '{
  "id": "fl_abc123",
  "authenticationType": "bearer",
  "authentication": {"token": "${[ admin_token ]}"},
  "headers": [{"name": "X-Api-Version", "value": "2024-01-01", "enabled": true}]
}'
yaak request create wk_abc123 --json '{"name":"List Users","method":"GET","url":"${[ base_url ]}/users","folderId":"fl_abc123"}'
```

The request above sends both the folder's bearer token and its version header
without repeating either. A request that sets its own `authenticationType`
overrides the folder's.

Nest folders by setting a folder's `folderId`. `yaak send <fl_id>` sends every
request in the folder recursively.

## Per-request settings

Each `setting*` field is an inherited toggle shaped
`{"enabled": bool, "value": …}`, where `enabled` means "override the inherited
value" rather than "turn the feature on":

```json
"settingFollowRedirects": {"enabled": true, "value": false},
"settingRequestTimeout":  {"enabled": true, "value": 5000}
```

Available: `settingFollowRedirects`, `settingRequestTimeout` (ms, `0` for none),
`settingValidateCertificates`, `settingSendCookies`, `settingStoreCookies`.

## Updating

Updates are JSON merge patches keyed by `id`. Send only what changes:

```bash
yaak request update --json '{"id":"rq_abc123","method":"PATCH"}'
```

Arrays are replaced wholesale, not merged — to add one header, read the current
list with `yaak request show rq_abc123` and write the full new array back.
Setting a key to `null` removes it.

## Ordering

`sortPriority` (a float) controls display order in the app sidebar. Leave it at
`0` unless the user cares; requests created with the same priority fall back to
creation order.
