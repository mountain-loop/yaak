import classNames from "classnames";
import type { ReactNode } from "react";
import { ACTIONS_BAR_CONTAINER, ActionsBar } from "../ActionsBar";
import { useEditorHost } from "../EditorHost";
import { IconButton } from "../IconButton";
import { BulkPairEditor } from "./BulkPairEditor";
import type { PairEditorProps } from "./PairEditor";
import { PairEditor } from "./PairEditor";

interface Props extends PairEditorProps {
  preferenceName: string;
  forcedEnvironmentId?: string;
  /**
   * Drawn after the bulk-edit toggle in one `ActionsBar`, like a view-mode switch. Giving it puts
   * the toggle in that bar rather than its own corner; once every site has moved, it always is
   */
  actions?: ReactNode;
}

export function PairOrBulkEditor({ preferenceName, actions, ...props }: Props) {
  const { useStoredValue } = useEditorHost();
  const [useBulk, setUseBulk] = useStoredValue<boolean>(
    ["bulk_edit", preferenceName],
    false,
    "global",
  );

  const editor = useBulk ? <BulkPairEditor {...props} /> : <PairEditor {...props} />;
  const toggleProps = {
    size: "sm",
    variant: "border",
    title: useBulk ? "Enable form edit" : "Enable bulk edit",
    onClick: () => setUseBulk((b) => !b),
    icon: useBulk ? "table" : "file_code",
  } as const;

  if (actions != null) {
    return (
      <div className={classNames(ACTIONS_BAR_CONTAINER, "h-full w-full")}>
        {editor}
        <ActionsBar>
          <IconButton {...toggleProps} />
          {actions}
        </ActionsBar>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full group/wrapper">
      {editor}
      <div className="absolute right-0 bottom-0">
        <IconButton
          {...toggleProps}
          className={classNames(
            "transition-opacity opacity-0 group-hover:opacity-80 hover:opacity-100! shadow",
            "bg-surface hover:text group-hover/wrapper:opacity-100",
          )}
        />
      </div>
    </div>
  );
}
