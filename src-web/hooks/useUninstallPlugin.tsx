import React from 'react';
import { InlineCode } from '../components/core/InlineCode';
import { showConfirmDelete } from '../lib/confirm';
import { invokeCmd } from '../lib/tauri';
import { useFastMutation } from './useFastMutation';

export function useUninstallPlugin() {
  return useFastMutation({
    mutationKey: ['uninstall_plugin'],
    mutationFn: async ({ pluginId, name }: { pluginId: string; name: string }) => {
      const confirmed = await showConfirmDelete({
        id: 'uninstall-plugin-' + name,
        title: 'Uninstall Plugin',
        description: (
          <>
            Permanently uninstall <InlineCode>{name}</InlineCode>?
          </>
        ),
      });
      if (confirmed) {
        await invokeCmd('cmd_uninstall_plugin', { pluginId });
      }
    },
  });
}
