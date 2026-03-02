import type {
  Folder,
  GrpcRequest,
  HttpRequest,
  HttpRequestHeader,
  WebsocketRequest,
  Workspace,
} from '@yaakapp-internal/models';
import { foldersAtom, workspacesAtom } from '@yaakapp-internal/models';
import { atom, useAtomValue } from 'jotai';
import { defaultHeaders } from '../lib/defaultHeaders';

const ancestorsAtom = atom((get) => [...get(foldersAtom), ...get(workspacesAtom)]);

export type HeaderModel = HttpRequest | GrpcRequest | WebsocketRequest | Folder | Workspace;

export type HeaderSource = {
  id: string;
  name: string;
  model: 'workspace' | 'folder' | 'default';
};

export type InheritedHeader = HttpRequestHeader & {
  source: HeaderSource;
};

export function useInheritedHeaders(baseModel: HeaderModel | null): InheritedHeader[] {
  const parents = useAtomValue(ancestorsAtom);

  const defaultSource: HeaderSource = { id: 'default', name: 'Default', model: 'default' };

  if (baseModel == null) return [];
  if (baseModel.model === 'workspace') {
    return defaultHeaders.map((h) => ({ ...h, source: defaultSource }));
  }

  const next = (child: HeaderModel): InheritedHeader[] => {
    // Short-circuit at workspace level - return global defaults + workspace headers
    if (child.model === 'workspace') {
      const workspaceSource: HeaderSource = { id: child.id, name: child.name, model: 'workspace' };
      return [
        ...defaultHeaders.map((h) => ({ ...h, source: defaultSource })),
        ...child.headers.map((h) => ({ ...h, source: workspaceSource })),
      ];
    }

    // Recurse up the tree
    const parent = parents.find((p) => {
      if (child.folderId) return p.id === child.folderId;
      return p.id === child.workspaceId;
    });

    // Failed to find parent (should never happen)
    if (parent == null) {
      return [];
    }

    const headers = next(parent);
    const parentSource: HeaderSource = {
      id: parent.id,
      name: parent.name,
      model: parent.model as 'workspace' | 'folder',
    };
    return [...headers, ...parent.headers.map((h) => ({ ...h, source: parentSource }))];
  };

  const allHeaders = next(baseModel);

  // Deduplicate by header name (case-insensitive), keeping the latest (most specific) value
  const headersByName = new Map<string, InheritedHeader>();
  for (const header of allHeaders) {
    headersByName.set(header.name.toLowerCase(), header);
  }

  return Array.from(headersByName.values());
}
