import { createFileRoute } from '@tanstack/react-router'
import Settings, { SettingsTab } from '../../components/Settings/Settings'

interface SettingsSearchSchema {
  tab?: SettingsTab
}

export const Route = createFileRoute('/workspaces/settings')({
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>): SettingsSearchSchema => ({
    tab: (search.tab ?? SettingsTab.General) as SettingsTab,
  }),
})

function RouteComponent() {
  return <Settings />
}
