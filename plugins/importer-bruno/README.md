# Bruno importer

Import Bruno's **Single File (YAML)** or **Bruno Collection (ZIP)** exports, or select a collection directory. Both OpenCollection `1.0.0` YAML collections and legacy `.bru` collections are supported. Individual `.bru` request files also work. A directory/ZIP must contain one collection root (`opencollection.yml`, `opencollection.yaml`, or `bruno.json`); a wrapper directory in the ZIP is allowed. Use **Choose folder** for an on-disk collection, rather than selecting its configuration file alone.

The importer consumes the shared [file-tree API](../../packages/plugin-runtime-types/IMPORTERS.md). It skips `.git`, `node_modules`, `__MACOSX`, and hidden entries. It does not install dependencies, load dotenv files, or run collection scripts.

Supported:

- Nested folders, ordering, descriptions, collection/folder headers, and variables.
- Environments, disabled variables, typed values, and secret placeholders. Environment inheritance is flattened into each selectable environment because Yaak does not have nested selectable environments.
- HTTP URLs, query/path parameters, headers, raw bodies, URL-encoded forms, multipart files, and selected binary files.
- GraphQL query and variables in Yaak's sendable body shape.
- gRPC URL, service/method, metadata, and selected message; WebSocket URL, headers, and selected message.
- Explicit auth inheritance, no auth, basic, bearer, digest, NTLM, API key, AWS credentials, common OAuth 1.0 header signing, and OAuth 2.0 flows with header tokens.
- Plain `{{variable}}` references converted to Yaak templates. Expressions, dynamic variables, and `process.env` references stay unchanged.

Scripts, assertions, actions, request-scoped variables, examples, advanced settings, and unsupported authentication configurations are retained in resource descriptions for manual migration, not executed. Alternative bodies/messages use the selected variant (or the first when unspecified); retained source variants remain in descriptions. File paths are preserved without reading files; relative paths and gRPC proto files may need to be configured after import. External secret providers, certificates, proxies, OAuth token caches, and WebSocket binary messages are not activated by the importer.

OpenCollection does not export persistent resource IDs, so Yaak derives the import source keys using its existing fallback matching.

Implementation references:

- [OpenCollection types and schema](https://github.com/opencollection-dev/opencollection)
- [Bruno's bundled export converter](https://github.com/usebruno/bruno/blob/main/packages/bruno-converters/src/opencollection/bruno-to-opencollection.ts)
- [Bruno's Share exporter](https://github.com/usebruno/bruno/blob/main/packages/bruno-app/src/utils/exporters/opencollection.js)

Legacy `.bru` parsing uses Bruno's official `@usebruno/filestore` (backed by `@usebruno/lang`). Its YAML serializers normalize parsed collections to OpenCollection before they enter the same Yaak conversion path. YAML collections are assembled directly to preserve their fields.
