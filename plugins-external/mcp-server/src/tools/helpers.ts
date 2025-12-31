import type { McpServerContext } from '../types.js';

export async function getWorkspaceContext(
  ctx: McpServerContext,
  workspaceId?: string,
): Promise<McpServerContext> {
  const workspaces = await ctx.yaak.workspace.list();

  if (!workspaceId && workspaces.length > 1) {
    const workspaceList = workspaces.map((w, i) => `${i + 1}. ${w.name} (ID: ${w.id})`).join('\n');
    throw new Error(
      `Multiple workspaces are open. Please specify which workspace to use.\n\n` +
        `Currently open workspaces:\n${workspaceList}\n\n` +
        `You can use the list_workspaces tool to get workspace IDs, then use other tools ` +
        `with the workspace context. For example, ask the user which workspace they want ` +
        `to work with by presenting them with the numbered list above.`,
    );
  }

  const workspace = workspaceId ? workspaces.find((w) => w.id === workspaceId) : workspaces[0];
  if (!workspace) {
    const workspaceList = workspaces.map((w) => `- ${w.name} (ID: ${w.id})`).join('\n');
    throw new Error(
      `Workspace with ID "${workspaceId}" not found.\n\n` +
        `Available workspaces:\n${workspaceList}`,
    );
  }

  return {
    yaak: ctx.yaak.workspace.withContext(workspace),
  };
}
