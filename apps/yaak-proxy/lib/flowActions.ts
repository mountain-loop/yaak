import type { ExportHarRequest, Flow, FlowBody } from "@yaakapp-internal/proxy-lib";
import type { DropdownItem } from "@yaakapp-internal/ui";
import { save } from "@tauri-apps/plugin-dialog";
import { formatSize } from "@yaakapp-internal/lib/formatSize";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect } from "react";
import { base64ToBytes, bodyFileName } from "./body";
import { curlBodyText, toCurl } from "./curl";
import type { FlowQuery } from "./query";
import { rpc } from "./rpc";
import { activeQueryAtom, lockedAtom } from "./store";
import { subscribe } from "./tauri";
import { useShowToast } from "./toast";

/** The flow the save dialog is open for */
export const saveDialogFlowAtom = atom<Flow | null>(null);

/** A body as text, decoding what is not UTF-8 lossily, or null when there is none */
async function bodyText(flow: Flow, which: FlowBody): Promise<string | null> {
  const res = await rpc("get_flow_body", { flowId: flow.id, which });
  if (res.decodeError != null) throw new Error(res.decodeError);
  const bytes = base64ToBytes(res.data);
  return bytes.length === 0 ? null : new TextDecoder().decode(bytes);
}

/** Writes a flow's body to a file the person picks, as the viewer shows it */
export function useSaveFlowBody(): (flow: Flow, which: FlowBody) => Promise<void> {
  const showToast = useShowToast();
  return useCallback(
    async (flow: Flow, which: FlowBody) => {
      try {
        const path = await save({ defaultPath: bodyFileName(flow, which) });
        if (path == null) return;
        const saved = await rpc("save_flow_body", { flowId: flow.id, which, path });
        const notes = [
          saved.raw ? "as it was on the wire, since it failed to decode" : null,
          saved.truncated ? "cut at the capture limit" : null,
        ].filter((n) => n != null);
        showToast({
          message: `Saved ${formatSize(saved.size)}${notes.length > 0 ? `, ${notes.join(", ")}` : ""}`,
        });
      } catch (err) {
        showToast({ message: `Failed to save the ${which} body: ${String(err)}`, color: "danger" });
      }
    },
    [showToast],
  );
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

/** Exports every flow `query` covers, or all of them, as HAR, saying how many it wrote */
function useExportHarOf(): (query: FlowQuery | null) => Promise<void> {
  const showToast = useShowToast();
  return useCallback(
    async (query: FlowQuery | null) => {
      try {
        const written = await exportHar(query == null ? {} : { filter: query }, "flows.har");
        if (written != null) {
          showToast({
            message: written === 1 ? "Exported 1 flow as HAR" : `Exported ${written} flows as HAR`,
          });
        }
      } catch (err) {
        showToast({ message: `Failed to export HAR: ${String(err)}`, color: "danger" });
      }
    },
    [showToast],
  );
}

/**
 * Exporting every flow the list covers as HAR, all of them or the search's, for the list's and
 * the search box's menus: it acts on flows, so it lives where they are chosen.
 */
export function useExportShownHar(): () => DropdownItem {
  const exportOf = useExportHarOf();
  const query = useAtomValue(activeQueryAtom);
  // Nothing can be read to export while captured traffic is locked.
  const locked = useAtomValue(lockedAtom) != null;
  return useCallback(
    () => ({
      label: query == null ? "Export All Flows as HAR" : "Export Matching Flows as HAR",
      icon: "download",
      disabled: locked,
      onSelect: () => exportOf(query),
    }),
    [query, locked, exportOf],
  );
}

/** File's Export All Flows as HAR, which the app menu sends as an event */
export function useMenuExportHar() {
  const exportOf = useExportHarOf();
  const locked = useAtomValue(lockedAtom) != null;
  useEffect(
    () =>
      subscribe<null>(MENU_EXPORT_HAR_EVENT, () => {
        if (!locked) void exportOf(null);
      }),
    [exportOf, locked],
  );
}

/** `EXPORT_HAR_EVENT` in the app's `window_menu.rs` */
const MENU_EXPORT_HAR_EVENT = "menu_export_har";

/** What a flow's context menu and the detail pane's menu offer */
export function useFlowActions(): (flow: Flow) => DropdownItem[] {
  const showToast = useShowToast();
  const openSave = useSetAtom(saveDialogFlowAtom);
  const saveBody = useSaveFlowBody();

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
      const noResponse = (flow.error != null || flow.cancelled) && flow.status == null;
      // A failed TLS handshake, recorded without a request, has nothing to replay.
      const noRequest = flow.method === "";
      return [
        {
          label: flow.savedRequestId == null ? "Save as Yaak Request" : "Save to Yaak Again",
          icon: "bookmark",
          disabled: noRequest,
          onSelect: () => openSave(flow),
        },
        { type: "separator" },
        {
          label: "Copy as cURL",
          icon: "square_terminal",
          disabled: noRequest,
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
              if (res.decodeError != null) {
                showToast({ message: `Failed to copy cURL: ${res.decodeError}`, color: "danger" });
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
          label: "Save Request Body to File",
          icon: "download",
          disabled: flow.requestSize === 0,
          onSelect: () => saveBody(flow, "request"),
        },
        {
          label: "Save Response Body to File",
          icon: "download",
          disabled: noResponse || flow.responseSize === 0,
          onSelect: () => saveBody(flow, "response"),
        },
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
    [openSave, saveBody, showToast],
  );
}
