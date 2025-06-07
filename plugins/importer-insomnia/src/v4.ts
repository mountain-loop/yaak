import { PartialImportResources } from '@yaakapp/api';
import { convertId, convertSyntax, isJSObject } from './common';

export function convertInsomniaV4(parsed: Record<string, any>) {
  if (!Array.isArray(parsed.resources)) return null;

  const resources: PartialImportResources = {
    environments: [],
    folders: [],
    grpcRequests: [],
    httpRequests: [],
    websocketRequests: [],
    workspaces: [],
  };

  // Import workspaces
  const workspacesToImport = parsed.resources.filter(r => isJSObject(r) && r._type === 'workspace');
  for (const w of workspacesToImport) {
    resources.workspaces.push({
      id: convertId(w._id),
      createdAt: w.created ? new Date(w.created).toISOString().replace('Z', '') : undefined,
      updatedAt: w.updated ? new Date(w.updated).toISOString().replace('Z', '') : undefined,
      model: 'workspace',
      name: w.name,
      description: w.description || undefined,
    });
    const environmentsToImport = parsed.resources.filter(
      (r: any) => isJSObject(r) && r._type === 'environment',
    );
    resources.environments.push(
      ...environmentsToImport.map((r: any) => importEnvironment(r, w._id)),
    );

    const nextFolder = (parentId: string) => {
      const children = parsed.resources.filter((r: any) => r.parentId === parentId);
      for (const child of children) {
        if (!isJSObject(child)) continue;

        if (child._type === 'request_group') {
          resources.folders.push(importFolder(child, w._id));
          nextFolder(child._id);
        } else if (child._type === 'request') {
          resources.httpRequests.push(
            importHttpRequest(child, w._id),
          );
        } else if (child._type === 'grpc_request') {
          resources.grpcRequests.push(
            importGrpcRequest(child, w._id),
          );
        }
      }
    };

    // Import folders
    nextFolder(w._id);
  }

  // Filter out any `null` values
  resources.httpRequests = resources.httpRequests.filter(Boolean);
  resources.grpcRequests = resources.grpcRequests.filter(Boolean);
  resources.environments = resources.environments.filter(Boolean);
  resources.workspaces = resources.workspaces.filter(Boolean);

  return { resources };
}

function importHttpRequest(
  r: any,
  workspaceId: string,
): PartialImportResources['httpRequests'][0] {
  let bodyType: string | null = null;
  let body = {};
  if (r.body.mimeType === 'application/octet-stream') {
    bodyType = 'binary';
    body = { filePath: r.body.fileName ?? '' };
  } else if (r.body?.mimeType === 'application/x-www-form-urlencoded') {
    bodyType = 'application/x-www-form-urlencoded';
    body = {
      form: (r.body.params ?? []).map((p: any) => ({
        enabled: !p.disabled,
        name: p.name ?? '',
        value: p.value ?? '',
      })),
    };
  } else if (r.body?.mimeType === 'multipart/form-data') {
    bodyType = 'multipart/form-data';
    body = {
      form: (r.body.params ?? []).map((p: any) => ({
        enabled: !p.disabled,
        name: p.name ?? '',
        value: p.value ?? '',
        file: p.fileName ?? null,
      })),
    };
  } else if (r.body?.mimeType === 'application/graphql') {
    bodyType = 'graphql';
    body = { text: convertSyntax(r.body.text ?? '') };
  } else if (r.body?.mimeType === 'application/json') {
    bodyType = 'application/json';
    body = { text: convertSyntax(r.body.text ?? '') };
  }

  let authenticationType: string | null = null;
  let authentication = {};
  if (r.authentication.type === 'bearer') {
    authenticationType = 'bearer';
    authentication = {
      token: convertSyntax(r.authentication.token),
    };
  } else if (r.authentication.type === 'basic') {
    authenticationType = 'basic';
    authentication = {
      username: convertSyntax(r.authentication.username),
      password: convertSyntax(r.authentication.password),
    };
  }

  return {
    id: convertId(r.meta?.id ?? r._id),
    createdAt: r.created ? new Date(r.created).toISOString().replace('Z', '') : undefined,
    updatedAt: r.modified ? new Date(r.modified).toISOString().replace('Z', '') : undefined,
    workspaceId: convertId(workspaceId),
    folderId: r.parentId === workspaceId ? null : convertId(r.parentId),
    model: 'http_request',
    sortPriority: r.metaSortKey,
    name: r.name,
    description: r.description || undefined,
    url: convertSyntax(r.url),
    body,
    bodyType,
    authentication,
    authenticationType,
    method: r.method,
    headers: (r.headers ?? [])
      .map((h: any) => ({
        enabled: !h.disabled,
        name: h.name ?? '',
        value: h.value ?? '',
      }))
      .filter(({ name, value }: any) => name !== '' || value !== ''),
  };
}

function importGrpcRequest(
  r: any,
  workspaceId: string,
): PartialImportResources['grpcRequests'][0] {
  const parts = r.protoMethodName.split('/').filter((p: any) => p !== '');
  const service = parts[0] ?? null;
  const method = parts[1] ?? null;

  return {
    id: convertId(r.meta?.id ?? r._id),
    createdAt: r.created ? new Date(r.created).toISOString().replace('Z', '') : undefined,
    updatedAt: r.modified ? new Date(r.modified).toISOString().replace('Z', '') : undefined,
    workspaceId: convertId(workspaceId),
    folderId: r.parentId === workspaceId ? null : convertId(r.parentId),
    model: 'grpc_request',
    sortPriority: r.metaSortKey,
    name: r.name,
    description: r.description || undefined,
    url: convertSyntax(r.url),
    service,
    method,
    message: r.body?.text ?? '',
    metadata: (r.metadata ?? [])
      .map((h: any) => ({
        enabled: !h.disabled,
        name: h.name ?? '',
        value: h.value ?? '',
      }))
      .filter(({ name, value }: any) => name !== '' || value !== ''),
  };
}

function importFolder(f: any, workspaceId: string): PartialImportResources['folders'][0] {
  return {
    id: convertId(f._id),
    createdAt: f.created ? new Date(f.created).toISOString().replace('Z', '') : undefined,
    updatedAt: f.modified ? new Date(f.modified).toISOString().replace('Z', '') : undefined,
    folderId: f.parentId === workspaceId ? null : convertId(f.parentId),
    workspaceId: convertId(workspaceId),
    description: f.description || undefined,
    model: 'folder',
    name: f.name,
  };
}

function importEnvironment(e: any, workspaceId: string, isParent?: boolean): PartialImportResources['environments'][0] {
  return {
    id: convertId(e._id),
    createdAt: e.created ? new Date(e.created).toISOString().replace('Z', '') : undefined,
    updatedAt: e.modified ? new Date(e.modified).toISOString().replace('Z', '') : undefined,
    workspaceId: convertId(workspaceId),
    // @ts-ignore
    sortPriority: e.metaSortKey, // Will be added to Yaak later
    base: isParent ?? e.parentId === workspaceId,
    model: 'environment',
    name: e.name,
    variables: Object.entries(e.data).map(([name, value]) => ({
      enabled: true,
      name,
      value: `${value}`,
    })),
  };
}
