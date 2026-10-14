import type { AssertionReport, HttpResponse } from "@yaakapp-internal/models";
import classNames from "classnames";
import { EmptyStateText } from "./EmptyStateText";

export function HttpAssertionResults({ response }: { response: HttpResponse }) {
  const report = response.assertionResults;
  if (!report)
    return <EmptyStateText>Assertions were not evaluated for this response.</EmptyStateText>;
  if (!report.error && report.results.length === 0)
    return <EmptyStateText>Waiting for the response to finish.</EmptyStateText>;
  return (
    <div className="h-full overflow-auto space-y-2 pb-3">
      <p className="text-xs text-text-subtle">Checks saved with this response.</p>
      <HttpAssertionReport report={report} />
    </div>
  );
}

export function HttpAssertionReport({ report }: { report: AssertionReport }) {
  const passed = report.results.filter((r) => r.outcome === "passed").length;
  const failed = report.results.filter((r) => r.outcome === "failed").length;
  const errors = report.results.filter(
    (r) => r.outcome === "error" || r.outcome === "invalid",
  ).length;
  const skipped = report.results.filter((r) => r.outcome === "skipped").length;
  return (
    <div className="space-y-2">
      <p className="text-sm">
        {passed} passed · {failed} failed · {errors} errors · {skipped} skipped
      </p>
      {report.error && <p className="text-sm text-danger">{report.error}</p>}
      {report.results.map((result, index) => {
        const check = report.definition.checks[index];
        return (
          <div
            key={`${result.assertionId}:${index}`}
            className="border border-border-subtle rounded-md p-2 text-sm space-y-1"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono break-all">
                {check?.target === "status" ? "Status" : check?.selector}
              </span>
              <span
                className={classNames(
                  "capitalize shrink-0",
                  result.outcome === "passed"
                    ? "text-success"
                    : result.outcome === "skipped"
                      ? "text-text-subtle"
                      : "text-danger",
                )}
              >
                {result.outcome}
              </span>
            </div>
            {check && (
              <p className="text-xs break-all">
                {check.operator.replaceAll("_", " ")}
                {check.operator !== "exists" && (
                  <>
                    {" "}
                    {check.expectedType === "null"
                      ? "null"
                      : check.expectedType === "text"
                        ? JSON.stringify(check.expected)
                        : check.expected}{" "}
                    ({check.expectedType})
                  </>
                )}
              </p>
            )}
            <p className="text-xs text-text-subtle">{result.reason}</p>
            {result.actual != null && (
              <p className="font-mono text-xs break-all">Actual: {JSON.stringify(result.actual)}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
