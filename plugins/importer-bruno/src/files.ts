import path from "node:path";
import {
  parseCollection,
  parseEnvironment,
  parseFolder,
  parseRequest,
  stringifyCollection,
  stringifyEnvironment,
  stringifyFolder,
  stringifyRequest,
} from "@usebruno/filestore";
import type { ImportFiles } from "@yaakapp/api";
import YAML from "yaml";
import { object, rows, text, type Obj } from "./common";

const ignored = new Set([".git", "node_modules", "__MACOSX"]);
const yaml = (value: string) => object(YAML.parse(value, { maxAliasCount: 0 }));

/** Assemble a collection from the virtual file tree. No direct filesystem access in the plugin. */
export async function readBrunoCollection(files: ImportFiles): Promise<Obj | null> {
  const paths: string[] = [];
  let entryCount = 0;
  const walk = async (dir = "", depth = 0) => {
    if (depth > 100) throw new Error("Bruno collection is nested too deeply");
    for (const entry of await files.readDir(dir)) {
      if (ignored.has(entry.name) || entry.name.startsWith(".")) continue;
      if (++entryCount > 10_000) throw new Error("Bruno collection contains too many files");
      if (entry.type === "directory") await walk(entry.path, depth + 1);
      else paths.push(entry.path);
    }
  };
  await walk();
  const markers = paths.filter((p) =>
    ["bruno.json", "opencollection.yml", "opencollection.yaml"].includes(path.posix.basename(p)),
  );
  const roots = [...new Set(markers.map((p) => path.posix.dirname(p)))];
  if (!roots.length) {
    // ZIPs may also contain just a bundled OpenCollection export or an individual .bru request.
    if (paths.length === 1) {
      const p = paths[0]!;
      if (/\.ya?ml$/i.test(p) || /\.json$/i.test(p)) {
        const root = yaml(await files.readTextFile(p));
        return root.opencollection ? root : null;
      }
      if (/\.bru$/i.test(p) && !["collection.bru", "folder.bru"].includes(path.posix.basename(p))) {
        return {
          opencollection: "1.0.0",
          bundled: true,
          info: { name: path.posix.basename(p, ".bru") },
          items: [
            yaml(
              stringifyRequest(parseRequest(await files.readTextFile(p), { format: "bru" }), {
                format: "yml",
              }),
            ),
          ],
        };
      }
    }
    return null;
  }
  if (roots.length > 1)
    throw new Error(
      "This source contains multiple Bruno collections. Select a single collection directory or ZIP.",
    );
  const rootPath = roots[0]! === "." ? "" : roots[0]!;
  const at = (name: string) => (rootPath ? `${rootPath}/${name}` : name);
  const yamlMarker = [at("opencollection.yml"), at("opencollection.yaml")].find((p) =>
    paths.includes(p),
  );
  const isYaml = yamlMarker != null;
  const root = isYaml
    ? yaml(await files.readTextFile(yamlMarker))
    : object(JSON.parse(await files.readTextFile(at("bruno.json"))));
  if (isYaml && root.opencollection !== "1.0.0")
    throw new Error(`Unsupported Bruno collection format version: ${text(root.opencollection)}`);
  const load = async (p: string, parse: (s: string) => Obj) => {
    try {
      return parse(await files.readTextFile(p));
    } catch (error) {
      throw new Error(
        `Unable to import ${p}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const assemble = async (dir: string): Promise<Obj[]> => {
    const items: Obj[] = [];
    for (const entry of await files.readDir(dir)) {
      if (
        ignored.has(entry.name) ||
        entry.name.startsWith(".") ||
        (dir === rootPath && entry.name === "environments")
      )
        continue;
      if (entry.type === "directory") {
        const configPath = isYaml
          ? ["folder.yml", "folder.yaml"]
              .map((name) => `${entry.path}/${name}`)
              .find((p) => paths.includes(p))
          : paths.includes(`${entry.path}/folder.bru`)
            ? `${entry.path}/folder.bru`
            : undefined;
        const folder = configPath
          ? await load(configPath, (s) =>
              isYaml
                ? yaml(s)
                : yaml(stringifyFolder(parseFolder(s, { format: "bru" }), { format: "yml" })),
            )
          : {};
        const children = await assemble(entry.path);
        items.push({
          ...folder,
          info: { name: entry.name, ...object(folder.info), type: "folder" },
          items: children,
        });
      } else if (
        isYaml &&
        /\.ya?ml$/i.test(entry.name) &&
        !["opencollection.yml", "opencollection.yaml", "folder.yml", "folder.yaml"].includes(
          entry.name,
        )
      ) {
        const item = await load(entry.path, yaml);
        if (object(item.info).type || item.http || item.graphql || item.grpc || item.websocket)
          items.push(item);
      } else if (
        !isYaml &&
        /\.bru$/i.test(entry.name) &&
        !["collection.bru", "folder.bru"].includes(entry.name)
      ) {
        items.push(
          await load(entry.path, (s) =>
            yaml(stringifyRequest(parseRequest(s, { format: "bru" }), { format: "yml" })),
          ),
        );
      }
    }
    return items;
  };
  const environments: Obj[] = [];
  const envPrefix = `${at("environments")}/`;
  for (const p of paths.filter(
    (p) =>
      p.startsWith(envPrefix) &&
      !p.slice(envPrefix.length).includes("/") &&
      (isYaml ? /\.ya?ml$/i.test(p) : /\.bru$/i.test(p)),
  )) {
    const env = await load(p, (s) =>
      isYaml
        ? yaml(s)
        : yaml(stringifyEnvironment(parseEnvironment(s, { format: "bru" }), { format: "yml" })),
    );
    environments.push({ ...env, name: path.posix.basename(p).replace(/\.(?:bru|ya?ml)$/i, "") });
  }
  const items = await assemble(rootPath);
  if (isYaml)
    return {
      ...root,
      bundled: true,
      items: [...rows(root.items), ...items],
      config: {
        ...object(root.config),
        environments: [...rows(object(root.config).environments), ...environments],
      },
    };
  const collectionPath = at("collection.bru");
  const collectionRoot = paths.includes(collectionPath)
    ? parseCollection(await files.readTextFile(collectionPath), { format: "bru" })
    : undefined;
  const normalized = yaml(
    stringifyCollection(
      collectionRoot ?? {},
      { ...root, name: text(root.name) || files.name },
      { format: "yml" },
    ),
  );
  return {
    ...normalized,
    bundled: true,
    items,
    config: { ...object(normalized.config), environments },
  };
}
