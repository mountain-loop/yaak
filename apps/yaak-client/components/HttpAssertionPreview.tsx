import deepEqual from "@gilbarbara/deep-equal";
import { useMutation } from "@tanstack/react-query";
import type { AssertionReport, HttpAssertions, HttpResponse } from "@yaakapp-internal/models";
import { format } from "date-fns";
import { rpc } from "../lib/rpc";
import { Button } from "./core/Button";
import { HttpAssertionReport } from "./HttpAssertionResults";

interface Props {
  assertions: HttpAssertions;
  response: HttpResponse | null;
}

export function HttpAssertionPreview(props: Props) {
  // A response switch (including a new send) discards results and in-flight UI
  // state. The old evaluation may finish, but it cannot label the new response.
  return <ResponsePreview key={`${props.response?.id}:${props.response?.updatedAt}`} {...props} />;
}

function ResponsePreview({ assertions, response }: Props) {
  const preview = useMutation({
    mutationFn: (definition: HttpAssertions) =>
      rpc<AssertionReport>("cmd_preview_http_assertions", {
        responseId: response?.id,
        assertions: definition,
      }),
    retry: false,
    gcTime: 0,
  });
  const unavailable = !response
    ? "Send a request first to get a response to try."
    : response.state !== "closed"
      ? "Wait for the response to finish."
      : !assertions.checks.some((check) => check.enabled)
        ? "Enable an assertion to try it."
        : null;
  const changed = preview.data != null && !deepEqual(preview.data.definition, assertions);

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="border"
        disabled={unavailable != null || preview.isPending}
        onClick={() => preview.mutate(assertions)}
      >
        {preview.isPending ? "Trying assertions…" : "Try assertions"}
      </Button>
      <p className="text-xs text-text-subtle">
        {unavailable ?? "Preview against the selected response without sending again."}
      </p>
      {preview.isError && (
        <p className="text-sm text-danger" role="alert">
          Could not preview assertions:{" "}
          {preview.error instanceof Error ? preview.error.message : String(preview.error)}
        </p>
      )}
      {preview.data && response && (
        <section
          aria-label="Assertion preview"
          aria-live="polite"
          className="border border-border-subtle rounded-md p-3 space-y-2"
        >
          <p className="text-sm font-medium">Preview</p>
          <p className="text-xs text-text-subtle">
            Response from {format(`${response.createdAt}Z`, "MMM d, h:mm:ss a")}. Recorded results
            are unchanged.
          </p>
          {changed && (
            <p className="text-xs text-warning" role="status">
              Assertions changed. Try again to update this preview.
            </p>
          )}
          <HttpAssertionReport report={preview.data} />
        </section>
      )}
    </div>
  );
}
