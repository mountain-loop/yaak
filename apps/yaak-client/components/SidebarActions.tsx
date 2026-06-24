import { HStack } from "@yaakapp-internal/ui";
import { useMemo } from "react";
import { useFloatingSidebarHidden } from "../hooks/useFloatingSidebarHidden";
import { useSidebarHidden } from "../hooks/useSidebarHidden";
import { CreateDropdown } from "./CreateDropdown";
import { IconButton } from "./core/IconButton";

interface Props {
  floating?: boolean;
}

export function SidebarActions({ floating = false }: Props) {
  const [sidebarHidden, setSidebarHidden] = useSidebarHidden();
  const [floatingHidden, setFloatingHidden] = useFloatingSidebarHidden();

  const hidden = floating ? floatingHidden : sidebarHidden;
  const setHidden = useMemo(
    () => (floating ? setFloatingHidden : setSidebarHidden),
    [floating, setFloatingHidden, setSidebarHidden],
  );

  return (
    <HStack className="h-full">
      <IconButton
        onClick={async () => {
          await setHidden(!hidden);
        }}
        className="pointer-events-auto"
        size="sm"
        title="Toggle sidebar"
        icon={hidden ? "left_panel_hidden" : "left_panel_visible"}
        iconColor="secondary"
      />
      <CreateDropdown hotKeyAction="model.create">
        <IconButton size="sm" icon="plus_circle" iconColor="secondary" title="Add Resource" />
      </CreateDropdown>
    </HStack>
  );
}
