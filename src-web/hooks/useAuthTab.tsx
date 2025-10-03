import type { Folder } from '@yaakapp-internal/models';
import { patchModel } from '@yaakapp-internal/models';
import { useMemo } from 'react';
import { openFolderSettings } from '../commands/openFolderSettings';
import { openWorkspaceSettings } from '../commands/openWorkspaceSettings';
import { Icon } from '../components/core/Icon';
import { HStack } from '../components/core/Stacks';
import { Tooltip } from '../components/core/Tooltip';
import type { TabItem } from '../components/core/Tabs/Tabs';
import { useHttpAuthenticationSummaries } from './useHttpAuthentication';
import type { AuthenticatedModel } from './useInheritedAuthentication';
import { useInheritedAuthentication } from './useInheritedAuthentication';

export function useAuthTab<T extends string>(tabValue: T, model: AuthenticatedModel | null) {
  const authentication = useHttpAuthenticationSummaries();
  const inheritedAuth = useInheritedAuthentication(model);

  return useMemo<TabItem[]>(() => {
    if (model == null) return [];

    const tab: TabItem = {
      value: tabValue,
      label: 'Auth',
      options: {
        value: model.authenticationType,
        items: [
          ...authentication.map((a) => ({
            label: a.label || 'UNKNOWN',
            shortLabel: a.shortLabel,
            value: a.name,
          })),
          { type: 'separator' },
          {
            label: 'Inherit from Parent',
            shortLabel:
              inheritedAuth != null && inheritedAuth.authenticationType != 'none' ? (
                <HStack space={1.5}>
                  {authentication.find((a) => a.name === inheritedAuth.authenticationType)
                    ?.shortLabel ?? 'UNKNOWN'}
                  <Tooltip
                    content={`Authentication inherited from ${inheritedAuth.model === 'folder' ? 'folder' : 'workspace'} "${inheritedAuth.name}". Click to open settings.`}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (inheritedAuth.model === 'folder') {
                          openFolderSettings(inheritedAuth.id, 'auth');
                        } else {
                          openWorkspaceSettings('auth');
                        }
                      }}
                      className="inline-flex items-center opacity-60 hover:opacity-100 transition-opacity"
                    >
                      <Icon icon="magic_wand" size="xs" />
                    </button>
                  </Tooltip>
                </HStack>
              ) : (
                'Auth'
              ),
            value: null,
          },
          { label: 'No Auth', shortLabel: 'No Auth', value: 'none' },
        ],
        onChange: async (authenticationType) => {
          let authentication: Folder['authentication'] = model.authentication;
          if (model.authenticationType !== authenticationType) {
            authentication = {
              // Reset auth if changing types
            };
          }
          await patchModel(model, { authentication, authenticationType });
        },
      },
    };

    return [tab];
  }, [authentication, inheritedAuth, model, tabValue]);
}
