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
import type { ImportFileEntry, ImportFiles } from "@yaakapp/api";
import YAML from "yaml";
import { object, rows, text, type Obj } from "./common";

const ignored = new Set([".git", "node_modules", "__MACOSX"]);
const yaml = (value: string) => object(YAML.parse(value, { maxAliasCount: 0 }));

/** Assemble a collection from the virtual file tree. No direct filesystem access in the plugin. */
export function isBruRequestFile(fileName: string): boolean {
  return /\.bru$/i.test(fileName) && !["collection.bru", "folder.bru"].includes(fileName);
}

/** A lone .bru request, wrapped as a one-request bundled collection */
export function singleBruRequest(contents: string, fileName: string): Obj {
  return {
    opencollection: "1.0.0",
    bundled: true,
    info: { name: fileName.replace(/\.bru$/i, "") },
    items: [yaml(stringifyRequest(parseRequest(contents, { format: "bru" }), { format: "yml" }))],
  };
}

const markerNames = ["bruno.json", "opencollection.yml", "opencollection.yaml"];

export async function readBrunoCollection(files: ImportFiles): Promise<Obj | null> {
  const listings = new Map<string, ImportFileEntry[]>();
  const list = async (dir: string) => {
    let entries = listings.get(dir);
    if (entries == null) {
      entries = (await files.readDir(dir)).filter(
        (e) => !ignored.has(e.name) && !e.name.startsWith("."),
      );
      listings.set(dir, entries);
    }
    return entries;
  };
  const has = async (dir: string, name: string) =>
    (await list(dir)).some((e) => e.type === "file" && e.name === name);
  const hasMarker = async (dir: string) => {
    for (const name of markerNames) if (await has(dir, name)) return true;
    return false;
  };

  // The selected directory must be the collection itself. Subfolders are only checked to give a
  // better error than "not supported" when the user picked the folder above it.
  const rootPath = "";
  if (!(await hasMarker(rootPath))) {
    const top = await list(rootPath);
    const [only] = top;
    if (top.length === 1 && only?.type === "file" && isBruRequestFile(only.name)) {
      return singleBruRequest(await files.readTextFile(only.path), only.name);
    }
    for (const entry of top) {
      if (entry.type === "directory" && (await hasMarker(entry.path))) {
        throw new Error(
          "This folder contains Bruno collections. Select the collection directory itself.",
        );
      }
    }
    return null;
  }
  const at = (name: string) => name;
  const yamlMarker = (await has(rootPath, "opencollection.yml"))
    ? at("opencollection.yml")
    : (await has(rootPath, "opencollection.yaml"))
      ? at("opencollection.yaml")
      : undefined;
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
    for (const entry of await list(dir)) {
      if (dir === rootPath && entry.name === "environments") continue;
      if (entry.type === "directory") {
        let configPath: string | undefined;
        for (const name of isYaml ? ["folder.yml", "folder.yaml"] : ["folder.bru"]) {
          if (await has(entry.path, name)) {
            configPath = `${entry.path}/${name}`;
            break;
          }
        }
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
  const hasEnvDir = (await list(rootPath)).some(
    (e) => e.type === "directory" && e.name === "environments",
  );
  const envFiles = hasEnvDir
    ? (await list(at("environments"))).filter(
        (e) => e.type === "file" && (isYaml ? /\.ya?ml$/i.test(e.name) : /\.bru$/i.test(e.name)),
      )
    : [];
  for (const p of envFiles.map((e) => e.path)) {
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
  const collectionRoot = (await has(rootPath, "collection.bru"))
    ? parseCollection(await files.readTextFile(at("collection.bru")), { format: "bru" })
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
