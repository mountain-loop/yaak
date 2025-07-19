import type { GrpcRequest, PluginDefinition } from '@yaakapp/api';
import path from 'node:path';

const NEWLINE = '\\\n ';

export const plugin: PluginDefinition = {
  grpcRequestActions: [
    {
      label: 'Copy as gRPCurl',
      icon: 'copy',
      async onSelect(ctx, args) {
        const rendered_request = await ctx.grpcRequest.render({
          grpcRequest: args.grpcRequest,
          purpose: 'preview',
        });
        const data = await convert(rendered_request, args.protoFiles);
        await ctx.clipboard.copyText(data);
        await ctx.toast.show({
          message: 'Command copied to clipboard',
          icon: 'copy',
          color: 'success',
        });
      },
    },
  ],
};

export async function convert(request: Partial<GrpcRequest>, allProtoFiles: string[]) {
  const xs = ['grpcurl'];

  if (request.url?.startsWith('http://')) {
    xs.push('-plaintext');
  }

  const protoIncludes = allProtoFiles.filter((f) => !f.endsWith('.proto'));
  const protoFiles = allProtoFiles.filter((f) => f.endsWith('.proto'));

  const inferredIncludes = new Set<string>();
  for (const f of protoFiles) {
    const protoDir = findParentProtoDir(f);
    if (protoDir) {
      inferredIncludes.add(protoDir);
    } else {
      inferredIncludes.add(path.join(f, '..'));
      inferredIncludes.add(path.join(f, '..', '..'));
    }
  }

  for (const f of protoIncludes) {
    xs.push('-import-path', quote(f));
    xs.push(NEWLINE);
  }

  for (const f of inferredIncludes.values()) {
    xs.push('-import-path', quote(f));
    xs.push(NEWLINE);
  }

  for (const f of protoFiles) {
    xs.push('-proto', quote(f));
    xs.push(NEWLINE);
  }

  // Add headers
  for (const h of (request.metadata ?? []).filter(onlyEnabled)) {
    xs.push('-H', quote(`${h.name}: ${h.value}`));
    xs.push(NEWLINE);
  }

  // Add basic authentication
  if (request.authenticationType === 'basic') {
    const user = request.authentication?.username ?? '';
    const pass = request.authentication?.password ?? '';
    const encoded = btoa(`${user}:${pass}`);
    xs.push('-H', quote(`Authorization: Basic ${encoded}`));
    xs.push(NEWLINE);
  } else if (request.authenticationType === 'bearer') {
    // Add bearer authentication
    xs.push('-H', quote(`Authorization: Bearer ${request.authentication?.token ?? ''}`));
    xs.push(NEWLINE);
  }

  // Add form params
  if (request.message) {
    xs.push('-d', `${quote(JSON.stringify(JSON.parse(request.message)))}`);
    xs.push(NEWLINE);
  }

  // Add the server address
  if (request.url) {
    const server = request.url.replace(/^https?:\/\//, ''); // remove protocol
    xs.push(server);
    xs.push(NEWLINE);
  }

  // Add service + method
  if (request.service && request.method) {
    xs.push(`${request.service}/${request.method}`);
    xs.push(NEWLINE);
  }

  // Remove trailing newline
  if (xs[xs.length - 1] === NEWLINE) {
    xs.splice(xs.length - 1, 1);
  }

  return xs.join(' ');
}

function quote(arg: string): string {
  const escaped = arg.replace(/'/g, "\\'");
  return `'${escaped}'`;
}

function onlyEnabled(v: { name?: string; enabled?: boolean }): boolean {
  return v.enabled !== false && !!v.name;
}

function findParentProtoDir(startPath: string): string | null {
  let dir = path.resolve(startPath);

  while (true) {
    if (path.basename(dir) === 'proto') {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return null; // Reached root
    }

    dir = parent;
  }
}
