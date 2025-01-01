import { createFileRoute } from '@tanstack/react-router'
import Settings from '../../../components/Settings/Settings'
import { SettingsTab } from '../../../components/Settings/SettingsTab'

interface SettingsSearchSchema {
  tab?: SettingsTab
}

export const Route = createFileRoute('/workspaces/$workspaceId/settings')({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): SettingsSearchSchema => ({
    tab: (search.tab ?? SettingsTab.General) as SettingsTab,
  }),
})

function RouteComponent() {
  return <Settings />
}
