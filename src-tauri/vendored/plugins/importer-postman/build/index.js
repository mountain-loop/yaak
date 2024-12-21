"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  pluginHookImport: () => pluginHookImport
});
module.exports = __toCommonJS(src_exports);
var POSTMAN_2_1_0_SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";
var POSTMAN_2_0_0_SCHEMA = "https://schema.getpostman.com/json/collection/v2.0.0/collection.json";
var VALID_SCHEMAS = [POSTMAN_2_0_0_SCHEMA, POSTMAN_2_1_0_SCHEMA];
function pluginHookImport(_ctx, contents) {
  const root = parseJSONToRecord(contents);
  if (root == null) return;
  const info = toRecord(root.info);
  const isValidSchema = VALID_SCHEMAS.includes(info.schema);
  if (!isValidSchema || !Array.isArray(root.item)) {
    return;
  }
  const globalAuth = importAuth(root.auth);
  const exportResources = {
    workspaces: [],
    environments: [],
    httpRequests: [],
    folders: []
  };
  const workspace = {
    model: "workspace",
    id: generateId("workspace"),
    name: info.name || "Postman Import",
    description: info.description?.content ?? info.description ?? ""
  };
  exportResources.workspaces.push(workspace);
  const environment = {
    model: "environment",
    id: generateId("environment"),
    name: "Global Variables",
    workspaceId: workspace.id,
    variables: root.variable?.map((v) => ({
      name: v.key,
      value: v.value
    })) ?? []
  };
  exportResources.environments.push(environment);
  const importItem = (v, folderId = null) => {
    if (typeof v.name === "string" && Array.isArray(v.item)) {
      const folder = {
        model: "folder",
        workspaceId: workspace.id,
        id: generateId("folder"),
        name: v.name,
        folderId
      };
      exportResources.folders.push(folder);
      for (const child of v.item) {
        importItem(child, folder.id);
      }
    } else if (typeof v.name === "string" && "request" in v) {
      const r = toRecord(v.request);
      const bodyPatch = importBody(r.body);
      const requestAuthPath = importAuth(r.auth);
      const authPatch = requestAuthPath.authenticationType == null ? globalAuth : requestAuthPath;
      const headers = toArray(r.header).map((h) => {
        return {
          name: h.key,
          value: h.value,
          enabled: !h.disabled
        };
      });
      for (const bodyPatchHeader of bodyPatch.headers) {
        const existingHeader = headers.find((h) => h.name.toLowerCase() === bodyPatchHeader.name.toLowerCase());
        if (existingHeader) {
          continue;
        }
        headers.push(bodyPatchHeader);
      }
      const { url, urlParameters } = convertUrl(r.url);
      const request = {
        model: "http_request",
        id: generateId("http_request"),
        workspaceId: workspace.id,
        folderId,
        name: v.name,
        method: r.method || "GET",
        url,
        urlParameters,
        body: bodyPatch.body,
        bodyType: bodyPatch.bodyType,
        authentication: authPatch.authentication,
        authenticationType: authPatch.authenticationType,
        headers
      };
      exportResources.httpRequests.push(request);
    } else {
      console.log("Unknown item", v, folderId);
    }
  };
  for (const item of root.item) {
    importItem(item);
  }
  return { resources: convertTemplateSyntax(exportResources) };
}
function convertUrl(url) {
  if (typeof url === "string") {
    return { url, urlParameters: [] };
  }
  url = toRecord(url);
  let v = "";
  if ("protocol" in url && typeof url.protocol === "string") {
    v += `${url.protocol}://`;
  }
  if ("host" in url) {
    v += `${Array.isArray(url.host) ? url.host.join(".") : url.host}`;
  }
  if ("port" in url && typeof url.port === "string") {
    v += `:${url.port}`;
  }
  if ("path" in url && Array.isArray(url.path) && url.path.length > 0) {
    v += `/${Array.isArray(url.path) ? url.path.join("/") : url.path}`;
  }
  const params = [];
  if ("query" in url && Array.isArray(url.query) && url.query.length > 0) {
    for (const query of url.query) {
      params.push({
        name: query.key ?? "",
        value: query.value ?? "",
        enabled: !query.disabled
      });
    }
  }
  if ("variable" in url && Array.isArray(url.variable) && url.variable.length > 0) {
    for (const v2 of url.variable) {
      params.push({
        name: ":" + (v2.key ?? ""),
        value: v2.value ?? "",
        enabled: !v2.disabled
      });
    }
  }
  if ("hash" in url && typeof url.hash === "string") {
    v += `#${url.hash}`;
  }
  return { url: v, urlParameters: params };
}
function importAuth(rawAuth) {
  const auth = toRecord(rawAuth);
  if ("basic" in auth) {
    return {
      authenticationType: "basic",
      authentication: {
        username: auth.basic.username || "",
        password: auth.basic.password || ""
      }
    };
  } else if ("bearer" in auth) {
    return {
      authenticationType: "bearer",
      authentication: {
        token: auth.bearer.token || ""
      }
    };
  } else {
    return { authenticationType: null, authentication: {} };
  }
}
function importBody(rawBody) {
  const body = toRecord(rawBody);
  if (body.mode === "graphql") {
    return {
      headers: [
        {
          name: "Content-Type",
          value: "application/json",
          enabled: true
        }
      ],
      bodyType: "graphql",
      body: {
        text: JSON.stringify(
          { query: body.graphql.query, variables: parseJSONToRecord(body.graphql.variables) },
          null,
          2
        )
      }
    };
  } else if (body.mode === "urlencoded") {
    return {
      headers: [
        {
          name: "Content-Type",
          value: "application/x-www-form-urlencoded",
          enabled: true
        }
      ],
      bodyType: "application/x-www-form-urlencoded",
      body: {
        form: toArray(body.urlencoded).map((f) => ({
          enabled: !f.disabled,
          name: f.key ?? "",
          value: f.value ?? ""
        }))
      }
    };
  } else if (body.mode === "formdata") {
    return {
      headers: [
        {
          name: "Content-Type",
          value: "multipart/form-data",
          enabled: true
        }
      ],
      bodyType: "multipart/form-data",
      body: {
        form: toArray(body.formdata).map(
          (f) => f.src != null ? {
            enabled: !f.disabled,
            contentType: f.contentType ?? null,
            name: f.key ?? "",
            file: f.src ?? ""
          } : {
            enabled: !f.disabled,
            name: f.key ?? "",
            value: f.value ?? ""
          }
        )
      }
    };
  } else if (body.mode === "raw") {
    return {
      headers: [
        {
          name: "Content-Type",
          value: body.options?.raw?.language === "json" ? "application/json" : "",
          enabled: true
        }
      ],
      bodyType: body.options?.raw?.language === "json" ? "application/json" : "other",
      body: {
        text: body.raw ?? ""
      }
    };
  } else if (body.mode === "file") {
    return {
      headers: [],
      bodyType: "binary",
      body: {
        filePath: body.file?.src
      }
    };
  } else {
    return { headers: [], bodyType: null, body: {} };
  }
}
function parseJSONToRecord(jsonStr) {
  try {
    return toRecord(JSON.parse(jsonStr));
  } catch (err) {
  }
  return null;
}
function toRecord(value) {
  if (Object.prototype.toString.call(value) === "[object Object]") return value;
  else return {};
}
function toArray(value) {
  if (Object.prototype.toString.call(value) === "[object Array]") return value;
  else return [];
}
function convertTemplateSyntax(obj) {
  if (typeof obj === "string") {
    return obj.replace(/{{\s*(_\.)?([^}]+)\s*}}/g, "${[$2]}");
  } else if (Array.isArray(obj) && obj != null) {
    return obj.map(convertTemplateSyntax);
  } else if (typeof obj === "object" && obj != null) {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, convertTemplateSyntax(v)])
    );
  } else {
    return obj;
  }
}
var idCount = {};
function generateId(model) {
  idCount[model] = (idCount[model] ?? -1) + 1;
  return `GENERATE_ID::${model.toUpperCase()}_${idCount[model]}`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  pluginHookImport
});
