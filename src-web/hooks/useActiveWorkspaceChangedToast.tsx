import { useAtomValue } from 'jotai';
import { useEffect, useState } from 'react';
import { InlineCode } from '../components/core/InlineCode';
import { showToast } from '../lib/toast';
import { activeWorkspaceAtom } from './useActiveWorkspace';

export function useActiveWorkspaceChangedToast() {
  const activeWorkspace = useAtomValue(activeWorkspaceAtom);
  const [id, setId] = useState<string | null>(activeWorkspace?.id ?? null);

  useEffect(() => {
    // Early return if same or invalid active workspace
    if (id === activeWorkspace?.id || activeWorkspace == null) return;

    setId(activeWorkspace?.id ?? null);

    // Don't notify on the first load
    if (id === null) return;

    showToast({
      id: `workspace-changed-${activeWorkspace.id}`,
      timeout: 3000,
      message: (
        <>
          Activated workspace{' '}
          <InlineCode className="whitespace-nowrap">{activeWorkspace.name}</InlineCode>
        </>
      ),
    });
  }, [activeWorkspace, id]);
}
