# Upstream Bruno fixtures

These two complete fixture directories are copied byte-for-byte from
[usebruno/bruno](https://github.com/usebruno/bruno) at commit
[`4eb7e585f0fb318b2ef8d88b34635da633f3acf4`](https://github.com/usebruno/bruno/commit/4eb7e585f0fb318b2ef8d88b34635da633f3acf4).

- `bru-migration/`: [`tests/collection/migrate-to-yml/fixtures/collection`](https://github.com/usebruno/bruno/tree/4eb7e585f0fb318b2ef8d88b34635da633f3acf4/tests/collection/migrate-to-yml/fixtures/collection). Exercises collection/folder headers, environments, request variables, JSON bodies, and retained scripts/assertions.
- `yaml-docs/`: [`packages/bruno-cli/tests/commands/docs/fixtures/yml-collection`](https://github.com/usebruno/bruno/tree/4eb7e585f0fb318b2ef8d88b34635da633f3acf4/packages/bruno-cli/tests/commands/docs/fixtures/yml-collection). Exercises YAML collection metadata, ordering, and repeated request names in different folders.

The upstream MIT license is preserved in [LICENSE.md](./LICENSE.md). This directory
is excluded from formatting so upstream inputs remain unchanged. To refresh,
copy both complete directories from a new pinned revision and update these links;
do not edit the inputs to accommodate importer behavior.

The tests only import the fixtures. They do not send requests or execute the
embedded Bruno scripts. Existing synthetic fixtures cover additional edge cases.
