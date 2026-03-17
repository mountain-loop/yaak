import type { Environment } from "@yaakapp-internal/models";
import { patchModel } from "@yaakapp-internal/models";
import { EnvironmentColorPicker } from "../components/EnvironmentColorPicker";
import { showDialog } from "./dialog";

export function showColorPicker(environment: Environment) {
  showDialog({
    title: "Цвет окружения",
    id: "color-picker",
    size: "sm",
    render: ({ hide }) => {
      return (
        <EnvironmentColorPicker
          color={environment.color}
          onChange={async (color) => {
            await patchModel(environment, { color });
            hide();
          }}
        />
      );
    },
  });
}
