import type { ExportHarRequest, Flow, FlowBody } from "@yaakapp-internal/proxy-lib";
import type { DropdownItem } from "@yaakapp-internal/ui";
import { save } from "@tauri-apps/plugin-dialog";
import { atom, useSetAtom } from "jotai";
import { useCallback } from "react";
import { base64ToBytes } from "./body";
import { curlBodyText, toCurl } from "./curl";
import { rpc } from "./rpc";
import { useShowToast } from "./toast";

/** The flow the save dialog is open for */
export const saveDialogFlowAtom = atom<Flow | null>(null);

/** A body as text, decoding what is not UTF-8 lossily, or null when there is none */
async function bodyText(flow: Flow, which: FlowBody): Promise<string | null> {
  const res = await rpc("get_flow_body", { flowId: flow.id, which });
  const bytes = base64ToBytes(res.data);
  return bytes.length === 0 ? null : new TextDecoder().decode(bytes);
}

/**
 * Writes flows to a HAR file the person picks: `ids`, or every flow `filter` covers. Returns how
 * many were written, or null when the save panel was cancelled.
 */
export async function exportHar(
  req: Omit<ExportHarRequest, "path">,
  defaultName: string,
): Promise<number | null> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: "HTTP Archive", extensions: ["har"] }],
  });
  if (path == null) return null;
  return rpc("export_har", { ...req, path });
}

/** What a flow's context menu and the detail pane's menu offer */
export function useFlowActions(): (flow: Flow) => DropdownItem[] {
  const showToast = useShowToast();
  const openSave = useSetAtom(saveDialogFlowAtom);

  return useCallback(
    (flow: Flow) => {
      const copy = async (label: string, text: () => Promise<string | null> | string) => {
        try {
          const value = await text();
          if (value == null) {
            showToast({ message: `There is no ${label} to copy`, color: "info" });
            return;
          }
          await navigator.clipboard.writeText(value);
          showToast({ message: `Copied ${label}` });
        } catch (err) {
          showToast({ message: `Failed to copy ${label}: ${String(err)}`, color: "danger" });
        }
      };
      const noResponse = flow.error != null && flow.status == null;
      return [
        {
          label: flow.savedRequestId == null ? "Save as Yaak Request" : "Save to Yaak Again",
          icon: "bookmark",
          onSelect: () => openSave(flow),
        },
        { type: "separator" },
        {
          label: "Copy as cURL",
          icon: "square_terminal",
          onSelect: async () => {
            let body: string | null = null;
            if (flow.requestSize > 0) {
              let res;
              try {
                res = await rpc("get_flow_body", { flowId: flow.id, which: "request" });
              } catch (err) {
                showToast({ message: `Failed to copy cURL: ${String(err)}`, color: "danger" });
                return;
              }
              body = curlBodyText(base64ToBytes(res.data), res.truncated);
              // A command that sends other bytes than the app did would mislead.
              if (body == null) {
                showToast({
                  message: "Body is binary or truncated; export HAR instead",
                  color: "info",
                });
                return;
              }
            }
            await copy("cURL", () => toCurl(flow, body));
          },
        },
        { label: "Copy URL", icon: "copy", onSelect: () => copy("URL", () => flow.url) },
        {
          label: "Copy Request Body",
          icon: "copy",
          disabled: flow.requestSize === 0,
          onSelect: () => copy("request body", () => bodyText(flow, "request")),
        },
        {
          label: "Copy Response Body",
          icon: "copy",
          disabled: noResponse,
          onSelect: () => copy("response body", () => bodyText(flow, "response")),
        },
        { type: "separator" },
        {
          label: "Export HAR",
          icon: "download",
          onSelect: async () => {
            try {
              const written = await exportHar({ ids: [flow.id] }, "flow.har");
              if (written != null) showToast({ message: "Exported the flow as HAR" });
            } catch (err) {
              showToast({ message: `Failed to export HAR: ${String(err)}`, color: "danger" });
            }
          },
        },
      ];
    },
    [openSave, showToast],
  );
}
