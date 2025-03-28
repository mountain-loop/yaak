import { listModels, patchModel } from '@yaakapp-internal/models';
import { memo, useMemo } from 'react';
import { useActiveCookieJar } from '../hooks/useActiveCookieJar';
import { useCreateCookieJar } from '../hooks/useCreateCookieJar';
import { useDeleteCookieJar } from '../hooks/useDeleteCookieJar';
import { showDialog } from '../lib/dialog';
import { showPrompt } from '../lib/prompt';
import { setWorkspaceSearchParams } from '../lib/setWorkspaceSearchParams';
import { CookieDialog } from './CookieDialog';
import { Dropdown, type DropdownItem } from './core/Dropdown';
import { Icon } from './core/Icon';
import { IconButton } from './core/IconButton';
import { InlineCode } from './core/InlineCode';

export const CookieDropdown = memo(function CookieDropdown() {
  const activeCookieJar = useActiveCookieJar();
  const deleteCookieJar = useDeleteCookieJar(activeCookieJar ?? null);
  const createCookieJar = useCreateCookieJar();
  const cookieJars = listModels('cookie_jar');

  const items = useMemo((): DropdownItem[] => {
    return [
      ...(cookieJars ?? []).map((j) => ({
        key: j.id,
        label: j.name,
        leftSlot: <Icon icon={j.id === activeCookieJar?.id ? 'check' : 'empty'} />,
        onSelect: () => {
          setWorkspaceSearchParams({ cookie_jar_id: j.id });
        },
      })),
      ...(((cookieJars ?? []).length > 0 && activeCookieJar != null
        ? [
            { type: 'separator', label: activeCookieJar.name },
            {
              key: 'manage',
              label: 'Manage Cookies',
              leftSlot: <Icon icon="cookie" />,
              onSelect: () => {
                if (activeCookieJar == null) return;
                showDialog({
                  id: 'cookies',
                  title: 'Manage Cookies',
                  size: 'full',
                  render: () => <CookieDialog cookieJarId={activeCookieJar.id} />,
                });
              },
            },
            {
              key: 'rename',
              label: 'Rename',
              leftSlot: <Icon icon="pencil" />,
              onSelect: async () => {
                const name = await showPrompt({
                  id: 'rename-cookie-jar',
                  title: 'Rename Cookie Jar',
                  description: (
                    <>
                      Enter a new name for <InlineCode>{activeCookieJar?.name}</InlineCode>
                    </>
                  ),
                  label: 'Name',
                  confirmText: 'Save',
                  placeholder: 'New name',
                  defaultValue: activeCookieJar?.name,
                });
                if (name == null) return;
                await patchModel(activeCookieJar, { name });
              },
            },
            ...(((cookieJars ?? []).length > 1 // Never delete the last one
              ? [
                  {
                    label: 'Delete',
                    leftSlot: <Icon icon="trash" />,
                    color: 'danger',
                    onSelect: deleteCookieJar.mutate,
                  },
                ]
              : []) as DropdownItem[]),
          ]
        : []) as DropdownItem[]),
      { type: 'separator' },
      {
        key: 'create-cookie-jar',
        label: 'New Cookie Jar',
        leftSlot: <Icon icon="plus" />,
        onSelect: () => createCookieJar.mutate(),
      },
    ];
  }, [activeCookieJar, cookieJars, createCookieJar, deleteCookieJar]);

  return (
    <Dropdown items={items}>
      <IconButton size="sm" icon="cookie" iconColor="secondary" title="Cookie Jar" />
    </Dropdown>
  );
});
