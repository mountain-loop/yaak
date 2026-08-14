# Importing and exporting

## Import

```bash
yaak import ./openapi.yaml
```

One command, one positional file path. The format is auto-detected — OpenAPI 3,
Swagger 2, Postman collections, Postman environments, Insomnia exports, cURL
commands, and Yaak's own export format are all supported by bundled importer
plugins. Output is a one-line summary:

```
Imported 1 workspace, 1 environment, 1 folder, 3 HTTP requests
```

By default this creates a **new workspace**. To merge into one that already
exists:

```bash
yaak import ./collection.json --workspace-id wk_abc123
```

Not every importer honours `--workspace-id`; the flag applies where the importer
supports it, and otherwise a new workspace is still created. Run
`yaak workspace list` afterwards to see what you actually got.

**Reach for this first.** When the user has an OpenAPI spec, a Postman
collection, or even a directory of `curl` commands in a README, importing beats
authoring requests by hand — it is one command, it preserves names and grouping,
and it will not typo a URL. Author requests by hand when there is no spec, or
when the user wants a small hand-picked set rather than every endpoint.

A cURL import is a fast way to turn something the user already has into a saved
request:

```bash
echo "curl -X POST https://api.example.com/pets -H 'Content-Type: application/json' -d '{\"name\":\"Rex\"}'" > /tmp/req.txt
yaak import /tmp/req.txt
```

## After importing

An imported spec gives you requests pointing at whatever `servers` the spec
declared. The usual follow-up is to make the host swappable:

1. `yaak request list <wk_id>` to see what landed.
2. Put the host in a base environment variable (`base_url`).
3. Update the imported requests to use `${[ base_url ]}`, then add a
   sub-environment per deployment target.

See [environments.md](environments.md). At that point `yaak -e ev_staging send
<wk_id>` runs the whole imported API against staging.

## Export

```bash
yaak export ./backup.json                  # the only workspace, when there is one
yaak export ./backup.json wk_abc123        # a specific workspace
yaak export ./backup.json wk_abc wk_def    # several
yaak export ./backup.json --all            # everything
```

Private environments are **excluded** unless you pass
`--include-private-environments`. That default exists so an export can be
committed to a repository without leaking credentials — do not add the flag
just to make an export look complete. Add it only when the user explicitly wants
a full backup, and say so when you do.

The output is Yaak's own format, so `yaak import ./backup.json` round-trips it.
