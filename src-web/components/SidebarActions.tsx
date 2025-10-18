import { useMemo } from 'react';
import { useFloatingSidebarHidden } from '../hooks/useFloatingSidebarHidden';
import { useShouldFloatSidebar } from '../hooks/useShouldFloatSidebar';
import { useSidebarHidden } from '../hooks/useSidebarHidden';
import { IconButton } from './core/IconButton';
import { HStack } from './core/Stacks';
import { CreateDropdown } from './CreateDropdown';

export function SidebarActions() {
  const floating = useShouldFloatSidebar();
  const [normalHidden, setNormalHidden] = useSidebarHidden();
  const [floatingHidden, setFloatingHidden] = useFloatingSidebarHidden();

  const hidden = floating ? floatingHidden : normalHidden;
  const setHidden = useMemo(
    () => (floating ? setFloatingHidden : setNormalHidden),
    [floating, setFloatingHidden, setNormalHidden],
  );

  return (
    <HStack className="h-full">
      <IconButton
        onClick={async () => {
          // NOTE: We're not using the (h) => !h pattern here because the data
          //  might be different if another window changed it (out of sync)
          await setHidden(!hidden);
        }}
        className="pointer-events-auto"
        size="sm"
        title="Show sidebar"
        icon={hidden ? 'left_panel_hidden' : 'left_panel_visible'}
        iconColor="secondary"
      />
      <CreateDropdown hotKeyAction="model.create">
        <IconButton size="sm" icon="plus_circle" iconColor="secondary" title="Add Resource" />
      </CreateDropdown>
    </HStack>
  );
}
