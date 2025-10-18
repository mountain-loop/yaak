import type { Folder } from '@yaakapp-internal/models';
import { patchModel } from '@yaakapp-internal/models';
import { useMemo } from 'react';
import { openFolderSettings } from '../commands/openFolderSettings';
import { openWorkspaceSettings } from '../commands/openWorkspaceSettings';
import { Icon } from '../components/core/Icon';
import { IconTooltip } from '../components/core/IconTooltip';
import { InlineCode } from '../components/core/InlineCode';
import { HStack } from '../components/core/Stacks';
import type { TabItem } from '../components/core/Tabs/Tabs';
import { capitalize } from '../lib/capitalize';
import { showConfirm } from '../lib/confirm';
import { resolvedModelName } from '../lib/resolvedModelName';
import { useHttpAuthenticationSummaries } from './useHttpAuthentication';
import type { AuthenticatedModel } from './useInheritedAuthentication';
import { useInheritedAuthentication } from './useInheritedAuthentication';
import { useModelAncestors } from './useModelAncestors';

export function useAuthTab<T extends string>(tabValue: T, model: AuthenticatedModel | null) {
  const authentication = useHttpAuthenticationSummaries();
  const inheritedAuth = useInheritedAuthentication(model);
  const ancestors = useModelAncestors(model);
  const parentModel = ancestors[0] ?? null;

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
                  <IconTooltip
                    icon="magic_wand"
                    iconSize="xs"
                    content="Authentication was inherited from an ancestor"
                  />
                </HStack>
              ) : (
                'Auth'
              ),
            value: null,
          },
          { label: 'No Auth', shortLabel: 'No Auth', value: 'none' },
        ],
        itemsAfter:
          parentModel &&
          model.authenticationType &&
          model.authenticationType !== 'none' &&
          (parentModel.authenticationType == null || parentModel.authenticationType === 'none')
            ? [
                { type: 'separator', label: 'Actions' },
                {
                  label: `Promote to ${capitalize(parentModel.model)}`,
                  leftSlot: (
                    <Icon
                      icon={parentModel.model === 'workspace' ? 'corner_right_up' : 'folder_up'}
                    />
                  ),
                  onSelect: async () => {
                    const confirmed = await showConfirm({
                      id: 'promote-auth-confirm',
                      title: 'Promote Authentication',
                      confirmText: 'Promote',
                      description: (
                        <>
                          Move authentication config to{' '}
                          <InlineCode>{resolvedModelName(parentModel)}</InlineCode>?
                        </>
                      ),
                    });
                    if (confirmed) {
                      await patchModel(model, { authentication: {}, authenticationType: null });
                      await patchModel(parentModel, {
                        authentication: model.authentication,
                        authenticationType: model.authenticationType,
                      });

                      if (parentModel.model === 'folder') {
                        openFolderSettings(parentModel.id, 'auth');
                      } else {
                        openWorkspaceSettings('auth');
                      }
                    }
                  },
                },
              ]
            : undefined,
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
  }, [authentication, inheritedAuth, model, parentModel, tabValue]);
}
