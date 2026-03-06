import { createFileRoute } from '@tanstack/react-router';
import type { SettingsTab } from '../../../components/Settings/Settings';
import Settings from '../../../components/Settings/Settings';

interface SettingsSearchSchema {
  tab?: SettingsTab;
}

export const Route = createFileRoute('/workspaces/$workspaceId/settings')({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): SettingsSearchSchema => ({
    tab: (search.tab ?? 'general') as SettingsTab,
  }),
});

function RouteComponent() {
  return <Settings />;
}
