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

        // Build a set of all folder IDs that are descendants of the target folder
        const folderIds = new Set<string>([targetFolder.id]);
        const addDescendants = (parentId: string) => {
          for (const folder of allFolders) {
            if (folder.folderId === parentId && !folderIds.has(folder.id)) {
              folderIds.add(folder.id);
              addDescendants(folder.id);
            }
          }
        };
        addDescendants(targetFolder.id);

        // Filter HTTP requests to those in the target folder or its descendants
        const requestsToSend = allRequests.filter(
          (req) => req.folderId != null && folderIds.has(req.folderId),
        );

        if (requestsToSend.length === 0) {
          await ctx.toast.show({
            message: 'No requests in folder',
            icon: 'info',
            color: 'info',
          });
          return;
        }

        // Send each request sequentially
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
