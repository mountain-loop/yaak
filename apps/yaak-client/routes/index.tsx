import { createFileRoute } from "@tanstack/react-router";
import { Onboarding } from "../components/Onboarding";
import { RedirectToLatestWorkspace } from "../components/RedirectToLatestWorkspace";

type IndexSearchSchema = {
  /** Show the home screen even when workspaces exist. Set by the dev menu. */
  home?: true;
};

export const Route = createFileRoute("/")({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): IndexSearchSchema =>
    search.home === true ? { home: true } : {},
});

function RouteComponent() {
  const { home } = Route.useSearch();
  return home ? <Onboarding /> : <RedirectToLatestWorkspace />;
}
