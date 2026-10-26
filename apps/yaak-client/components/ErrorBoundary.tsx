import { ErrorBoundary as BaseErrorBoundary } from "@yaakapp-internal/ui";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { showDialog } from "../lib/dialog";
import RouteError from "./RouteError";

export function ErrorBoundary({ name, children }: { name: string; children: ReactNode }) {
  return (
    <BaseErrorBoundary name={name} onShowError={showErrorDialog}>
      {children}
    </BaseErrorBoundary>
  );
}

function showErrorDialog(error: unknown) {
  showDialog({ id: "error-boundary", render: () => <RouteError error={error} /> });
}

export function ErrorBoundaryTestThrow() {
  useEffect(() => {
    throw new Error("test error");
  });

  return <div>Hello</div>;
}
