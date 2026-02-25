import type { PluginDefinition } from '@yaakapp/api';

export const plugin: PluginDefinition = {
  folderActions: [
    {
      label: 'Send All',
      icon: 'send_horizontal',
      async onSelect(ctx, args) {
        const targetFolder = args.folder;

        // Get all folders and HTTP requests
        const [allFolders, allRequests] = await Promise.all([
          ctx.folder.list(),
          ctx.httpRequest.list(),
        ]);

        // Build the send order to match tree ordering:
        // sort siblings by sortPriority then updatedAt, and traverse folders depth-first.
        const compareByOrder = (
          a: Pick<typeof allFolders[number], 'sortPriority' | 'updatedAt'>,
          b: Pick<typeof allFolders[number], 'sortPriority' | 'updatedAt'>,
        ) => {
          if (a.sortPriority === b.sortPriority) {
            return a.updatedAt > b.updatedAt ? 1 : -1;
          }
          return a.sortPriority - b.sortPriority;
        };

        const childrenByFolderId = new Map<string, Array<typeof allFolders[number] | typeof allRequests[number]>>();
        for (const folder of allFolders) {
          if (folder.folderId == null) continue;
          const children = childrenByFolderId.get(folder.folderId) ?? [];
          children.push(folder);
          childrenByFolderId.set(folder.folderId, children);
        }
        for (const request of allRequests) {
          if (request.folderId == null) continue;
          const children = childrenByFolderId.get(request.folderId) ?? [];
          children.push(request);
          childrenByFolderId.set(request.folderId, children);
        }

        const requestsToSend: typeof allRequests = [];
        const collectRequests = (folderId: string) => {
          const children = (childrenByFolderId.get(folderId) ?? []).slice().sort(compareByOrder);
          for (const child of children) {
            if (child.model === 'folder') {
              collectRequests(child.id);
            } else if (child.model === 'http_request') {
              requestsToSend.push(child);
            }
          }
        };
        collectRequests(targetFolder.id);

        if (requestsToSend.length === 0) {
          await ctx.toast.show({
            message: 'No requests in folder',
            icon: 'info',
            color: 'info',
          });
          return;
        }

        // Send requests sequentially in the calculated folder order.
        let successCount = 0;
        let errorCount = 0;

        for (const request of requestsToSend) {
          try {
            await ctx.httpRequest.send({ httpRequest: request });
            successCount++;
          } catch (error) {
            errorCount++;
            console.error(`Failed to send request ${request.id}:`, error);
          }
        }

        // Show summary toast
        if (errorCount === 0) {
          await ctx.toast.show({
            message: `Sent ${successCount} request${successCount !== 1 ? 's' : ''}`,
            icon: 'send_horizontal',
            color: 'success',
          });
        } else {
          await ctx.toast.show({
            message: `Sent ${successCount}, failed ${errorCount}`,
            icon: 'alert_triangle',
            color: 'warning',
          });
        }
      },
    },
  ],
};
