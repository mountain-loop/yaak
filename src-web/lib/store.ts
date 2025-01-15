import type {
  CookieJar,
  Environment,
  Folder,
  GrpcRequest,
  HttpRequest,
  Plugin,
  Settings,
  Workspace,
  WorkspaceMeta,
} from '@yaakapp-internal/models';
import { invokeCmd } from './tauri';

export async function getSettings(): Promise<Settings> {
  return invokeCmd('cmd_get_settings', {});
}

export async function getGrpcRequest(id: string | null): Promise<GrpcRequest | null> {
  if (id === null) return null;
  const request: GrpcRequest = (await invokeCmd('cmd_get_grpc_request', { id })) ?? null;
  if (request == null) {
    return null;
  }
  return request;
}

export async function getHttpRequest(id: string | null): Promise<HttpRequest | null> {
  if (id === null) return null;
  const request: HttpRequest = (await invokeCmd('cmd_get_http_request', { id })) ?? null;
  if (request == null) {
    return null;
  }
  return request;
}

export async function getEnvironment(id: string | null): Promise<Environment | null> {
  if (id === null) return null;
  const environment: Environment = (await invokeCmd('cmd_get_environment', { id })) ?? null;
  if (environment == null) {
    return null;
  }
  return environment;
}

export async function getFolder(id: string | null): Promise<Folder | null> {
  if (id === null) return null;
  const folder: Folder = (await invokeCmd('cmd_get_folder', { id })) ?? null;
  if (folder == null) {
    return null;
  }
  return folder;
}

export async function getWorkspace(id: string | null): Promise<Workspace | null> {
  if (id === null) return null;
  const workspace: Workspace = (await invokeCmd('cmd_get_workspace', { id })) ?? null;
  if (workspace == null) {
    return null;
  }
  return workspace;
}

export async function getWorkspaceMeta(workspaceId: string) {
  return invokeCmd<WorkspaceMeta>('cmd_get_workspace_meta', { workspaceId });
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const workspaces: Workspace[] = (await invokeCmd('cmd_list_workspaces')) ?? [];
  return workspaces;
}

export async function listPlugins(): Promise<Plugin[]> {
  const plugins: Plugin[] = (await invokeCmd('cmd_list_plugins')) ?? [];
  return plugins;
}

export async function getCookieJar(id: string | null): Promise<CookieJar | null> {
  if (id === null) return null;
  const cookieJar: CookieJar = (await invokeCmd('cmd_get_cookie_jar', { id })) ?? null;
  if (cookieJar == null) {
    return null;
  }
  return cookieJar;
}
