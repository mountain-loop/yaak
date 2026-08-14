# Environments and variables

## The hierarchy

Every workspace gets a base environment named **Global Variables** for free. Its
`parentModel` is `workspace`, and its variables apply to every send regardless of
which environment is selected.

Sub-environments (`parentModel: "environment"`) sit under the base and are chosen
per send with `-e`. A sub-environment variable overrides a base variable of the
same name; names it does not define fall through to the base.

```bash
yaak environment list wk_abc123
# ev_staging     - Staging (environment)
# ev_production  - Production (environment)
# ev_base        - Global Variables (workspace)
```

The trailing parenthetical is `parentModel`, which is how you tell the base
environment from the rest.

## Setting variables

Variables are an array on the environment, so an update replaces the whole list.
Read first, then write the full array back:

```bash
yaak environment show ev_base
yaak environment update --json '{
  "id": "ev_base",
  "variables": [
    {"name": "base_url", "value": "https://api.example.com", "enabled": true},
    {"name": "api_version", "value": "v1", "enabled": true}
  ]
}'
```

Create a sub-environment with its variables in one step:

```bash
yaak environment create wk_abc123 --json '{
  "name": "Staging",
  "parentModel": "environment",
  "variables": [{"name": "base_url", "value": "https://staging.example.com", "enabled": true}]
}'
```

`enabled: false` keeps a variable defined but inert, which is how the app models
a commented-out value.

## Using them

`${[ name ]}` resolves anywhere a value is rendered — URL, headers, body, and
authentication fields:

```bash
yaak request create wk_abc123 --json '{
  "name": "List Pets",
  "method": "GET",
  "url": "${[ base_url ]}/${[ api_version ]}/pets",
  "authenticationType": "bearer",
  "authentication": {"token": "${[ api_token ]}"}
}'
```

Then run the same request against different targets:

```bash
yaak request send rq_abc123                    # base environment only
yaak -e ev_staging request send rq_abc123      # staging overrides base_url
yaak -e ev_production send fl_smoke_tests      # whole folder against production
```

`-e` is global, so it applies to `send`, `request send`, folder sends, and
workspace sends alike.

## Unresolved variables fail loudly

Referencing a name no active environment defines aborts before anything is sent:

```
Error: Failed to render request templates: Render Error: Variable "api_token" is not defined in active environment
```

Exit code 1. This is a feature worth relying on — a typo in a variable name can
never quietly send a request to `https:///pets`. When a send fails this way, the
fix is either the variable name in the request or the `-e` environment, not a
retry.

## Secrets

Do not write real credentials into environment variables on the user's behalf.
Create the reference and let the user supply the value:

```bash
yaak environment update --json '{"id":"ev_base","variables":[{"name":"api_token","value":"","enabled":true}]}'
```

Then tell the user which variable to fill in, and in which environment.

Environments have a `public` flag that mirrors the app's Sharable/Private toggle.
`public: false` (the default) marks the environment Private, which keeps it out
of `yaak export` unless `--include-private-environments` is passed. Secrets
belong in a private environment; values safe to commit or share belong in a
sharable one.

## Cookies

Cookie jars are per-workspace and require no setup — the oldest jar is used
automatically. Sending cookies is off by default per request; enable it with the
inherited setting, on the folder if it should apply to a whole group:

```json
"settingSendCookies":  {"enabled": true, "value": true},
"settingStoreCookies": {"enabled": true, "value": true}
```

With both on, a login request stores its `Set-Cookie` and later requests in the
same jar send it back, which is often simpler than threading a token by hand.
Use `--cookie-jar cj_abc123` to select a non-default jar, and
`yaak cookie-jar list <wk_id>` to see the jars and their cookie counts.
