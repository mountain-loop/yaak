import { createFileRoute } from "@tanstack/react-router";
import { HttpHistoryPage } from "../../../components/HttpHistoryPage";

export const Route = createFileRoute("/workspaces/$workspaceId/history")({
  component: RouteComponent,
});

function RouteComponent() {
  return <HttpHistoryPage />;
}
