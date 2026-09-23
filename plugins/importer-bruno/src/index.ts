import type { HttpRequestHeader, PartialImportResources, PluginDefinition } from "@yaakapp/api";
import type { ImportPluginResponse } from "@yaakapp/api/lib/plugins/ImporterPlugin";
import YAML from "yaml";
import { auth, manualAuth } from "./auth";
import { body, urlAndParams } from "./body";
import { environments } from "./environments";
import { readBrunoCollection } from "./files";
import {
  description,
  headers,
  object,
  rows,
  selected,
  template,
  text,
  variables,
  type Obj,
} from "./common";

export const plugin: PluginDefinition = {
  importer: {
    name: "Bruno",
    description: "Import Bruno collections",
    async onImportFiles(_ctx, { files }) {
      if (files.kind === "file") {
        const [entry] = await files.readDir();
        if (!entry) return null;
        const bytes = await files.readFile(entry.path);
        let contents: string;
        try {
          contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          return null;
        }
        const imported = convertBruno(contents);
        if (imported) return imported;
      }
      const root = await readBrunoCollection(files);
      return root ? convertBruno(YAML.stringify(root)) : null;
    },
  },
};

export function convertBruno(contents: string): ImportPluginResponse {
  let root: Obj;
  try {
    // Bundled exports don't need aliases. Disallow cycles before walking the item tree.
    root = object(YAML.parse(contents, { maxAliasCount: 0 }));
  } catch {
    return null;
  }
  if (typeof root.opencollection !== "string") return null;
  if (root.opencollection !== "1.0.0")
    throw new Error(`Unsupported Bruno collection format version: ${root.opencollection}`);
  if (root.bundled === false || (!Array.isArray(root.items) && root.bundled !== true)) {
    throw new Error(
      "Select the collection using Choose folder, or export a single YAML file from Bruno's Share menu. A collection configuration file alone does not contain the requests.",
    );
  }
  const resources: PartialImportResources = {
    workspaces: [],
    environments: [],
    folders: [],
    httpRequests: [],
    grpcRequests: [],
    websocketRequests: [],
  };
  let nextId = 0;
  const id = () => `GENERATE_ID::${++nextId}`;
  const workspaceId = id();
  const defaults = object(root.request);
  const config = object(root.config);
  const environmentSettings = rows(config.environments)
    .map((e) => ({
      name: e.name,
      externalSecrets: e.externalSecrets,
      dotEnvFilePath: e.dotEnvFilePath,
      clientCertificates: e.clientCertificates,
    }))
    .filter((e) => e.externalSecrets || e.dotEnvFilePath || e.clientCertificates);
  resources.workspaces.push({
    model: "workspace",
    id: workspaceId,
    name: text(object(root.info).name) || "Bruno Import",
    headers: headers(defaults.headers),
    ...auth(defaults.auth),
    description: description(root, {
      scripts: defaults.scripts,
      actions: defaults.actions,
      settings: defaults.settings,
      auth: manualAuth(defaults.auth),
      ...(environmentSettings.length ? { environmentSettings } : {}),
      ...Object.fromEntries(Object.entries(config).filter(([key]) => key !== "environments")),
    }),
  });
  resources.environments.push({
    model: "environment",
    id: id(),
    workspaceId,
    name: "Base Environment",
    parentModel: "workspace",
    parentId: null,
    variables: variables(defaults.variables),
  });
  resources.environments.push(...environments(config.environments, workspaceId, id));

  const visit = (
    items: unknown,
    folderId: string | null,
    depth = 0,
    inheritedHeaders: HttpRequestHeader[] = headers(defaults.headers),
  ) => {
    if (depth > 100) throw new Error("Bruno folders are nested too deeply");
    for (const [index, item] of rows(items).entries()) {
      const info = object(item.info);
      const type = text(info.type);
      const common = {
        id: id(),
        workspaceId,
        folderId,
        name: text(info.name) || "Untitled",
        sortPriority: typeof info.seq === "number" && Number.isFinite(info.seq) ? info.seq : index,
      };
      if (type === "folder" || (type === "" && Array.isArray(item.items))) {
        const request = object(item.request);
        resources.folders.push({
          ...common,
          model: "folder",
          headers: headers(request.headers),
          ...auth(request.auth, item.request == null),
          description: description(item, {
            scripts: request.scripts,
            actions: request.actions,
            settings: request.settings,
            auth: manualAuth(request.auth),
          }),
        });
        if (Array.isArray(request.variables) && request.variables.length) {
          resources.environments.push({
            model: "environment",
            id: id(),
            workspaceId,
            name: "Folder Environment",
            parentModel: "folder",
            parentId: common.id,
            variables: variables(request.variables),
          });
        }
        visit(item.items, common.id, depth + 1, [...inheritedHeaders, ...headers(request.headers)]);
        continue;
      }
      const r = object(item[type]);
      const settings = object(item.settings);
      const desc = description(item, {
        runtime: item.runtime,
        examples: item.examples,
        settings: item.settings,
        auth: manualAuth(r.auth),
        ...(Array.isArray(r.body) || object(r.body).type === "file"
          ? { bodyVariants: r.body }
          : type === "http" &&
              r.body != null &&
              !["json", "xml", "text", "sparql", "form-urlencoded", "multipart-form"].includes(
                text(object(r.body).type),
              )
            ? { unsupportedBody: r.body }
            : {}),
      });
      if (type === "http" || type === "graphql") {
        resources.httpRequests.push({
          ...common,
          model: "http_request",
          description: desc,
          ...urlAndParams(r.url, r.params),
          method: text(r.method) || (type === "graphql" ? "POST" : "GET"),
          ...auth(r.auth),
          ...body(r.body, type === "graphql", r.headers, inheritedHeaders),
          ...(typeof settings.followRedirects === "boolean"
            ? { settingFollowRedirects: { enabled: true, value: settings.followRedirects } }
            : {}),
          ...(typeof settings.timeout === "number" &&
          Number.isInteger(settings.timeout) &&
          settings.timeout >= 0 &&
          settings.timeout <= 2147483647
            ? { settingRequestTimeout: { enabled: true, value: settings.timeout } }
            : {}),
        });
      } else if (type === "grpc") {
        const [service, method] = text(r.method).replace(/^\//, "").split("/");
        resources.grpcRequests.push({
          ...common,
          model: "grpc_request",
          url: template(r.url),
          service: service || null,
          method: method || null,
          message: template(selected(r.message, "message")),
          metadata: headers(r.metadata),
          ...auth(r.auth),
          description: description(item, {
            runtime: item.runtime,
            protoFilePath: r.protoFilePath,
            messageVariants: Array.isArray(r.message) ? r.message : undefined,
            auth: manualAuth(r.auth),
          }),
        });
      } else if (type === "websocket") {
        const message = object(selected(r.message, "message"));
        resources.websocketRequests.push({
          ...common,
          model: "websocket_request",
          url: template(r.url),
          headers: headers(r.headers),
          ...auth(r.auth),
          message: message.type === "binary" ? "" : template(message.data),
          description: description(item, {
            runtime: item.runtime,
            settings: item.settings,
            message: r.message,
            auth: manualAuth(r.auth),
          }),
        });
      } else {
        // Unknown items remain visible in the import instead of silently disappearing.
        resources.folders.push({
          ...common,
          model: "folder",
          description: description(item, { unsupportedItem: item }),
        });
      }
    }
  };
  visit(root.items, null);
  // OpenCollection has no persistent resource IDs. Let the host derive source keys.
  return { resources };
}
