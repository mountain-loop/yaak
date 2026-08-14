import { platform, useCapability } from "@yaakapp-internal/platform";
import { Icon } from "@yaakapp-internal/ui";
import * as m from "motion/react-m";
import { useEffect, useState } from "react";
import { importCurl, looksLikeCurl } from "../commands/importCurl";
import { useWindowFocus } from "../hooks/useWindowFocus";
import { showToast } from "../lib/toast";
import { Button } from "./core/Button";

/**
 * Offers to create a request from a Curl command on the clipboard. A host that can read
 * the clipboard on its own offers it whenever the window is focused; one that would have
 * to prompt for permission first waits for the user to paste instead.
 */
export function ImportCurl() {
  return useCapability("clipboardRead") ? <ImportCurlButton /> : <ImportCurlOnPaste />;
}

function ImportCurlButton() {
  const focused = useWindowFocus();
  const [clipboardText, setClipboardText] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // oxlint-disable-next-line react-hooks/exhaustive-deps -- none
  useEffect(() => {
    void platform.clipboard.readText().then(setClipboardText);
  }, [focused]);

  if (!looksLikeCurl(clipboardText)) {
    return null;
  }

  return (
    <m.div
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.5 }}
    >
      <Button
        size="2xs"
        variant="border"
        color="success"
        className="rounded-full"
        rightSlot={<Icon icon="import" size="sm" />}
        isLoading={isLoading}
        title="Import Curl command from clipboard"
        onClick={async () => {
          setIsLoading(true);
          try {
            await importCurl.mutateAsync({ command: clipboardText });
            setClipboardText(""); // Hide the button until the clipboard changes
          } catch (e) {
            console.log("Failed to import curl", e);
          } finally {
            setIsLoading(false);
          }
        }}
      >
        Import Curl
      </Button>
    </m.div>
  );
}

function ImportCurlOnPaste() {
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const command = e.clipboardData?.getData("text/plain") ?? "";
      if (!looksLikeCurl(command)) return;

      // Editable targets keep the text as text. The URL editor imports it itself.
      if (isEditable(e.target)) return;

      showToast({
        id: "curl-paste",
        color: "success",
        message: (
          <div>
            <h2 className="font-semibold">Curl command detected</h2>
            <p className="text-text-subtle text-sm">Create a request from the pasted command?</p>
          </div>
        ),
        action: ({ hide }) => (
          <Button
            size="xs"
            color="success"
            className="mr-auto min-w-20"
            rightSlot={<Icon icon="import" size="sm" />}
            onClick={() => {
              hide();
              importCurl.mutate({ command });
            }}
          >
            Create Request
          </Button>
        ),
      });
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, []);

  return null;
}

function isEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest(".cm-editor") != null) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
