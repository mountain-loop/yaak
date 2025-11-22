import type { PartialImportResources } from '@yaakapp/api';
import { convertId, convertTemplateSyntax, isJSObject } from './common';

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export function convertInsomniaV5(parsed: any) {
  // Assert parsed is object
  if (parsed == null || typeof parsed !== 'object') {
    return null;
  }

  if (!('collection' in parsed) || !Array.isArray(parsed.collection)) {
    return null;
  }

  const resources: PartialImportResources = {
    environments: [],
    folders: [],
    grpcRequests: [],
    httpRequests: [],
    websocketRequests: [],
    workspaces: [],
  };

  // Import workspaces
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  const meta = ('meta' in parsed ? parsed.meta : {}) as Record<string, any>;
  resources.workspaces.push({
    id: convertId(meta.id ?? 'collection'),
    createdAt: meta.created ? new Date(meta.created).toISOString().replace('Z', '') : undefined,
    updatedAt: meta.modified ? new Date(meta.modified).toISOString().replace('Z', '') : undefined,
    model: 'workspace',
    name: parsed.name,
    description: meta.description || undefined,
    ...importHeaders(parsed),
    ...importAuthentication(parsed),
  });

  // Import environments
  resources.environments.push(
    importEnvironment(parsed.environments, meta.id, true),
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    ...(parsed.environments.subEnvironments ?? []).map((r: any) => importEnvironment(r, meta.id)),
  );

  // Import folders
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  const nextFolder = (children: any[], parentId: string) => {
    for (const child of children ?? []) {
      if (!isJSObject(child)) continue;

      if (Array.isArray(child.children)) {
        const { folder, environment } = importFolder(child, meta.id, parentId);
        resources.folders.push(folder);
        if (environment) resources.environments.push(environment);
        nextFolder(child.children, child.meta.id);
      } else if (child.method) {
        resources.httpRequests.push(importHttpRequest(child, meta.id, parentId));
      } else if (child.protoFileId) {
        resources.grpcRequests.push(importGrpcRequest(child, meta.id, parentId));
      } else if (child.url) {
        resources.websocketRequests.push(importWebsocketRequest(child, meta.id, parentId));
      }
    }
  };

  // Import folders
  nextFolder(parsed.collection ?? [], meta.id);

  // Filter out any `null` values
  resources.httpRequests = resources.httpRequests.filter(Boolean);
  resources.grpcRequests = resources.grpcRequests.filter(Boolean);
  resources.environments = resources.environments.filter(Boolean);
  resources.workspaces = resources.workspaces.filter(Boolean);

  return { resources: convertTemplateSyntax(resources) };
}

function importHttpRequest(
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  r: any,
  workspaceId: string,
  parentId: string,
): PartialImportResources['httpRequests'][0] {
  const id = r.meta?.id ?? r._id;
  const created = r.meta?.created ?? r.created;
  const updated = r.meta?.modified ?? r.updated;
  const sortKey = r.meta?.sortKey ?? r.sortKey;

  let bodyType: string | null = null;
  let body = {};
  if (r.body?.mimeType === 'application/octet-stream') {
    bodyType = 'binary';
    body = { filePath: r.body.fileName ?? '' };
  } else if (r.body?.mimeType === 'application/x-www-form-urlencoded') {
    bodyType = 'application/x-www-form-urlencoded';
    body = {
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      form: (r.body.params ?? []).map((p: any) => ({
        enabled: !p.disabled,
        name: p.name ?? '',
        value: p.value ?? '',
      })),
    };
  } else if (r.body?.mimeType === 'multipart/form-data') {
    bodyType = 'multipart/form-data';
    body = {
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      form: (r.body.params ?? []).map((p: any) => ({
        enabled: !p.disabled,
        name: p.name ?? '',
        value: p.value ?? '',
        file: p.fileName ?? null,
      })),
    };
  } else if (r.body?.mimeType === 'application/graphql') {
    bodyType = 'graphql';
    body = { text: r.body.text ?? '' };
  } else if (r.body?.mimeType === 'application/json') {
    bodyType = 'application/json';
    body = { text: r.body.text ?? '' };
  }

  return {
    id: convertId(id),
    workspaceId: convertId(workspaceId),
    createdAt: created ? new Date(created).toISOString().replace('Z', '') : undefined,
    updatedAt: updated ? new Date(updated).toISOString().replace('Z', '') : undefined,
    folderId: parentId === workspaceId ? null : convertId(parentId),
    sortPriority: sortKey,
    model: 'http_request',
    name: r.name,
    description: r.meta?.description || undefined,
    url: r.url,
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    urlParameters: (r.parameters ?? []).map((p: any) => ({
      enabled: !p.disabled,
      name: p.name ?? '',
      value: p.value ?? '',
    })),
    body,
    bodyType,
    method: r.method,
    ...importHeaders(r),
    ...importAuthentication(r),
  };
}

function importGrpcRequest(
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  r: any,
  workspaceId: string,
  parentId: string,
): PartialImportResources['grpcRequests'][0] {
  const id = r.meta?.id ?? r._id;
  const created = r.meta?.created ?? r.created;
  const updated = r.meta?.modified ?? r.updated;
  const sortKey = r.meta?.sortKey ?? r.sortKey;

  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  const parts = r.protoMethodName.split('/').filter((p: any) => p !== '');
  const service = parts[0] ?? null;
  const method = parts[1] ?? null;

  return {
    model: 'grpc_request',
    id: convertId(id),
    workspaceId: convertId(workspaceId),
    createdAt: created ? new Date(created).toISOString().replace('Z', '') : undefined,
    updatedAt: updated ? new Date(updated).toISOString().replace('Z', '') : undefined,
    folderId: parentId === workspaceId ? null : convertId(parentId),
    sortPriority: sortKey,
    name: r.name,
    description: r.description || undefined,
    url: r.url,
    service,
    method,
    message: r.body?.text ?? '',
    metadata: (r.metadata ?? [])
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      .map((h: any) => ({
        enabled: !h.disabled,
        name: h.name ?? '',
        value: h.value ?? '',
      }))
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      .filter(({ name, value }: any) => name !== '' || value !== ''),
  };
}

function importWebsocketRequest(
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  r: any,
  workspaceId: string,
  parentId: string,
): PartialImportResources['websocketRequests'][0] {
  const id = r.meta?.id ?? r._id;
  const created = r.meta?.created ?? r.created;
  const updated = r.meta?.modified ?? r.updated;
  const sortKey = r.meta?.sortKey ?? r.sortKey;

  return {
    model: 'websocket_request',
    id: convertId(id),
    workspaceId: convertId(workspaceId),
    createdAt: created ? new Date(created).toISOString().replace('Z', '') : undefined,
    updatedAt: updated ? new Date(updated).toISOString().replace('Z', '') : undefined,
    folderId: parentId === workspaceId ? null : convertId(parentId),
    sortPriority: sortKey,
    name: r.name,
    description: r.description || undefined,
    url: r.url,
    message: r.body?.text ?? '',
    ...importHeaders(r),
    ...importAuthentication(r),
  };
}

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
function importHeaders(obj: any) {
  const headers = (obj.headers ?? [])
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    .map((h: any) => ({
      enabled: !h.disabled,
      name: h.name ?? '',
      value: h.value ?? '',
    }))
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    .filter(({ name, value }: any) => name !== '' || value !== '');
  return { headers } as const;
}

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
function importAuthentication(obj: any) {
  let authenticationType: string | null = null;
  let authentication = {};
  if (obj.authentication?.type === 'bearer') {
    authenticationType = 'bearer';
    authentication = {
      token: obj.authentication.token,
    };
  } else if (obj.authentication?.type === 'basic') {
    authenticationType = 'basic';
    authentication = {
      username: obj.authentication.username,
      password: obj.authentication.password,
    };
  }

  return { authenticationType, authentication } as const;
}

function importFolder(
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  f: any,
  workspaceId: string,
  parentId: string,
): {
  folder: PartialImportResources['folders'][0];
  environment: PartialImportResources['environments'][0] | null;
} {
  const id = f.meta?.id ?? f._id;
  const created = f.meta?.created ?? f.created;
  const updated = f.meta?.modified ?? f.updated;
  const sortKey = f.meta?.sortKey ?? f.sortKey;

  let environment: PartialImportResources['environments'][0] | null = null;
  if (Object.keys(f.environment ?? {}).length > 0) {
    environment = {
      id: convertId(`${id}folder`),
      createdAt: created ? new Date(created).toISOString().replace('Z', '') : undefined,
      updatedAt: updated ? new Date(updated).toISOString().replace('Z', '') : undefined,
      workspaceId: convertId(workspaceId),
      public: true,
      parentModel: 'folder',
      parentId: convertId(id),
      model: 'environment',
      name: 'Folder Environment',
      variables: Object.entries(f.environment ?? {}).map(([name, value]) => ({
        enabled: true,
        name,
        value: `${value}`,
      })),
    };
  }

  return {
    folder: {
      model: 'folder',
      id: convertId(id),
      createdAt: created ? new Date(created).toISOString().replace('Z', '') : undefined,
      updatedAt: updated ? new Date(updated).toISOString().replace('Z', '') : undefined,
      folderId: parentId === workspaceId ? null : convertId(parentId),
      sortPriority: sortKey,
      workspaceId: convertId(workspaceId),
      description: f.description || undefined,
      name: f.name,
      ...importAuthentication(f),
      ...importHeaders(f),
    },
    environment,
  };
}

function importEnvironment(
  // biome-ignore lint/suspicious/noExplicitAny: <explanation>
  e: any,
  workspaceId: string,
  isParent?: boolean,
): PartialImportResources['environments'][0] {
  const id = e.meta?.id ?? e._id;
  const created = e.meta?.created ?? e.created;
  const updated = e.meta?.modified ?? e.updated;
  const sortKey = e.meta?.sortKey ?? e.sortKey;

  return {
    id: convertId(id),
    createdAt: created ? new Date(created).toISOString().replace('Z', '') : undefined,
    updatedAt: updated ? new Date(updated).toISOString().replace('Z', '') : undefined,
    workspaceId: convertId(workspaceId),
    public: !e.isPrivate,
    sortPriority: sortKey,
    parentModel: isParent ? 'workspace' : 'environment',
    parentId: null,
    model: 'environment',
    name: e.name,
    variables: Object.entries(e.data ?? {}).map(([name, value]) => ({
      enabled: true,
      name,
      value: `${value}`,
    })),
  };
}
