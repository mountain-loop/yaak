# Yaak Proxy prose pass, round one

Read-only proposal. Nothing in the source has changed. Strike or edit rows by their number (for example "drop 2.14", "4.7: use X instead"), then round two applies what is left.

The table has 409 rows holding about 645 strings (a row with " / " holds the variants of one string). About 234 strings in 214 rows have a proposed change; the rest are "keep", 12 of them your own wording.

## Voice guide, from the Yaak client

Client paths are under `apps/yaak-client/`. `ui/` means `packages/ui/src/components/`.

1. **Buttons:** Title Case, one to three words, verb first, no period. "Add Certificate" (`components/Settings/SettingsCertificates.tsx:226`), "Save to File" (`components/responseViewers/BinaryViewer.tsx:32`), "Apply and Restart" (`ui/settings/SettingsInterface.tsx:209`).
2. **Menu items:** Title Case, verb plus noun. "Clear Send History" (`components/WorkspaceActionsDropdown.tsx:126`), "Expand All Folders" (`components/Sidebar.tsx:632`), "Check for Updates" (`components/SettingsDropdown.tsx:69`). Inconsistent: "Keyboard shortcuts" (`components/SettingsDropdown.tsx:34`), "Delete all" (`components/RecentHttpResponsesDropdown.tsx:106`). Title Case is the majority.
3. **Ellipses on actions:** none. Items that open a dialog are bare: "Manage Cookies" (`components/CookieDropdown.tsx:34`), "Import Data" (`components/SettingsDropdown.tsx:53`), "Workspace Settings" (`components/WorkspaceActionsDropdown.tsx:111`). Only the Git menu adds them ("Commit...", `components/git/GitDropdown.tsx:205`), a minority. Where an ellipsis does appear it is three periods, never "…".
4. **Dialog and confirm titles:** Title Case, the action as verb plus noun, never a question. "Rename Cookie Jar" (`components/CookieDropdown.tsx:48`), "Reset Changes" (`components/git/GitDropdown.tsx:228`), "Uninstall Plugin" (`hooks/useUninstallPlugin.tsx:16`). One stray: "Branch not fully merged" (`components/git/GitDropdown.tsx:408`).
5. **Confirms and destructive actions:** the question goes in the body, in one line, and the button repeats the title's verb. "Permanently delete `name`?" with "Delete" (`lib/deleteModelWithConfirm.tsx:29`, `lib/confirm.ts:31`), "Permanently uninstall `name`?" with "Uninstall" (`hooks/useUninstallPlugin.tsx:17-20`), "This will discard all uncommitted changes. This cannot be undone." with "Reset" (`components/git/GitDropdown.tsx:229-230`). "Permanently <verb> X?" is the majority.
6. **Tooltips on icon buttons:** sentence case, imperative verb plus object, no period. "Toggle sidebar" (`components/SidebarActions.tsx:30`), "Save response to file" (`components/HttpResponsePane.tsx:220`), "Show response history" (`components/RecentHttpResponsesDropdown.tsx:126`). Inconsistent: "Send Request" (`components/FolderLayout.tsx:118`), "Main Menu" (`components/SettingsDropdown.tsx:105`). Sentence case is the majority.
7. **Toasts:** one fragment, past tense or a state, no trailing period, names in inline code. "Copied to clipboard" (`lib/copy.ts:19`), "Already up-to-date" (`components/git/git-util.ts:13`), "Response saved to `path`" (`hooks/useSaveResponse.tsx:36`).
8. **Toasts with more to say** use a bold title over one subtle line, never a second sentence about what happens next. "Yaak 2026.1 is available" over "Download and install the update?" (`lib/initGlobalListeners.tsx:252-254`), "3 plugin updates available" over the plugin names (`lib/initGlobalListeners.tsx:292`).
9. **Errors:** "Failed to <verb>" inline, or a short title over the raw error, which is appended and never paraphrased. "Failed to copy" (`components/CopyIconButton.tsx:20`), "Export Failed" (`hooks/useExportData.tsx:14`), "Error pushing changes" over `String(err)` (`components/git/GitDropdown.tsx:179-180`). Titles split between "X Failed" and "Error <verb>ing X"; "Failed to <verb>" is the commonest one-line form.
10. **Empty states:** "No <noun>" or one imperative, no period. "No authentication" (`components/HttpAuthenticationEditor.tsx:46`), "No plugins found" (`components/Settings/SettingsPlugins.tsx:317`), "Select a commit to view diff" (`components/git/FileHistoryDialog.tsx:78`). Casing is mixed ("No Content", `components/WebsocketResponsePane.tsx:236`; "No Headers", `ui/http/ResponseHeaders.tsx:26`); sentence case is the majority. Two with periods (`components/CookieDialog.tsx:174,177`) are outliers.
11. **No results:** "No results for `x`" (`components/Sidebar.tsx:703`), and with suggestions "No results, but found matches for `a` or `b`" (`components/Sidebar.tsx:680`).
12. **Settings pages:** a one-word title and one sentence with a period. "Tweak settings related to the user interface." (`ui/settings/SettingsInterface.tsx:54`), "Configure general settings for update behavior and more." (`ui/settings/SettingsGeneral.tsx:29`).
13. **Settings section headings:** Title Case nouns. "App Info" (`ui/settings/SettingsGeneral.tsx:48`), "Custom Proxy" (`components/Settings/SettingsProxy.tsx:61`), "Workspaces" (`components/Settings/SettingsInterface.tsx:28`).
14. **Setting rows:** title in sentence case, a verb phrase for a switch; the description is one short sentence with a period saying what it does. "Wrap editor lines" with "Wrap long lines in request and response editors." (`ui/settings/SettingsInterface.tsx:143-144`), "Enable proxy" with "Temporarily disable the proxy without losing the configuration." (`components/Settings/SettingsProxy.tsx:64-65`). Rows whose title says it all have none: "Interface font" (`ui/settings/SettingsInterface.tsx:60`), "Automatically download updates" (`ui/settings/SettingsGeneral.tsx:141`). Inconsistent: Title Case rows "Update Channel", "Data Directory" (`ui/settings/SettingsGeneral.tsx:102,53`). Sentence case is the majority.
15. **Select options:** sentence case. "Always ask", "Open in current window" (`components/Settings/SettingsInterface.tsx:46-47`), "No proxy" (`components/Settings/SettingsProxy.tsx:53`), "Automatic" (`components/ModelSettingsEditor.tsx:339`).
16. **Placeholders:** an example value or a one-word label. "api.example.com" (`components/DnsOverridesEditor.tsx:140`), "Search" (`components/Sidebar.tsx:586`), "Filter cookies" (`components/CookieDialog.tsx:152`). Some end in "..." ("Search plugins...", `components/Settings/SettingsPlugins.tsx:306`); bare is the majority.
17. **Progress:** a gerund, sometimes with "...". "Cloning..." (`components/CloneGitRepositoryDialog.tsx:139`), "Restarting..." (`lib/initGlobalListeners.tsx:169`), "Sending Request" (`ui/http/ResponseBodyViewer.tsx:58`).
18. **Verbs:** a small fixed set, each with one meaning. Delete destroys a thing ("Delete", `components/Sidebar.tsx:527`), Remove takes it off a list ("Remove", `components/responseViewers/RecentFiltersDropdown.tsx:43`), Clear empties a history ("Clear Send History"), Reset goes back to a default ("Reset to Default", `components/Settings/SettingsHotkeys.tsx:239`). Also New, Rename, Duplicate, Copy, Save, Import, Export, Show, Hide, Enable, Reveal, Retry ("Retry", `components/GrpcEditor.tsx:189`).
19. **Nouns:** the thing's own name, no articles in labels. "Copy workspace ID" (`components/WorkspaceSettingsDialog.tsx:182`), "Delete override" (`components/DnsOverridesEditor.tsx:184`), "Reveal in Finder" / "Show in Explorer" / "Show in File Manager" (`lib/reveal.ts:6-9`).
20. **Names and literal values** go in inline code, not quotes. "Switched branch `x`" (`components/git/GitDropdown.tsx:109`), "Enter a new name for `x`" (`components/CookieDropdown.tsx:51`), "No results for `x`" (`components/Sidebar.tsx:703`).
21. **Never:** apologies (none in the client), exclamation marks (one in the whole client, "Thanks for the feedback!", `components/FeedbackToast.tsx:39`), "yet" and "coming soon". "Please" exists only in eight long banners, mostly licensing (`ui/settings/SettingsLicense.tsx:178`, `components/EnvironmentEditDialog.tsx:82`); never in a button, menu, tooltip, toast or setting row. Hedging appears twice, both "may impact performance" (`components/ConfirmLargeRequestBody.tsx:35`, `ui/http/ConfirmLargeResponse.tsx:53`).
22. **Never explains mechanism:** it says what a control does, not how the app does it. The longest explanation is one sentence. "Encrypt workspace secrets and sensitive values at rest." (`components/WorkspaceEncryptionSetting.tsx:137`), "Send proxy credentials with proxied requests." (`components/Settings/SettingsProxy.tsx:107`), "An empty workspace for your first request" (`components/Onboarding.tsx:92`).
23. **Does not address the reader** in labels. "You" and "your" show only in a few alerts: "You have uncommitted changes." (`components/git/uncommitted.tsx:8`), "You are currently on the latest version" (`hooks/useCheckForUpdates.tsx:19`). A heading asks a question only in upsell banners ("Using Git for work?", `components/git/GitCommitDialog.tsx:221`).
24. **Punctuation:** periods only on full sentences in descriptions and dialog bodies; no colon-led labels; no semicolons; counts inline ("Clear 3 Connections", `components/RecentWebsocketConnectionsDropdown.tsx:95`); "and", never "&".
25. **Length:** buttons one to three words, menu items one to four, tooltips two to four, toasts two to five, empty states two to six, setting descriptions five to twelve, confirm bodies one sentence.

## Terminology decisions

One word per thing, applied through the table.

| Thing | The app says | Never |
| --- | --- | --- |
| A row in the list, and the stored records as a whole | **flow**, **flows** ("All Flows", "Clear Flows", "Flows are locked") | "traffic", "captured traffic", "captured data". "Requests" stays only in your encrypted-card line and for Yaak requests ("Save as Yaak Request"). |
| Keeping flows | **Recording** and **Paused**; verbs "Pause Recording", "Resume Recording"; flows are "recorded" | "stored", "captured", "kept" |
| Reading HTTPS | verbs **Decrypt** and **Stop Decrypting**; the feature is **decryption**; states **Encrypted** and **Decrypted** | "passed through", "not on the decrypt list", "tunnelled" |
| A `!` entry | **Exclude**, **Stop Excluding**, **Excluded**, **exclusions** | "built-in exclusions" and "Apple services and apps that pin" as two names for one clause: it is "Except exclusions" |
| Emptying | **Clear** empties flows or a history; **Remove** takes one item off a list; **Delete** destroys a saved search; **Reset** goes back to a default | "dropped", "removed" for flows; "Clear Sorting" beside "Reset Sort" |
| What sent a flow | **app** | "program", "client", "process". "Client" and "Server" stay only as the two HTTP sides in the Info tab. |
| `*.example.com` and an exact name | **domain** and **host** | "site" |
| The header box and what is saved from it | **search** ("Recent searches", "Save Search") | "filter" for the same thing. "Filter" stays in your three menu items and in the body viewer's JSONPath filter. |
| A body over the size the proxy keeps | **truncated** | "cut", "kept", "the capture limit" (a limit Settings never shows) |
| The CA | **certificate**; "Yaak Proxy CA" only as its literal keychain name | "the proxy's certificate", "proxy CA" |
| The macOS proxy setting | **Override system proxy**, on or off | "routing", "turn on the system proxy" |
| Settings | **Settings** is the app's; **System Settings** is macOS's, always in full | "Settings" for the macOS pane |
| A handshake the app turned down | **rejected** | "refused" |
| Trying once more | **Retry** | "Try Again" |
| A macOS password prompt in flight | **Waiting for macOS** | "Waiting for your password" |
| The other owner | **the CLI** | "the yaak CLI" |
| Showing a file | **Reveal in Finder**, **Show in Explorer**, **Show in File Manager** (Yaak's three) | "Show in Folder" |

## The table

Paths: `components/`, `lib/` and `hooks/` are under `apps/yaak-proxy/`. `ui/` is `packages/ui/src/components/`. `proxy-lib/` is `crates-proxy/yaak-proxy-lib/src/`. `engine/` is `crates/yaak-proxy/src/`. `tauri/` is `crates-tauri/yaak-app-proxy/src/`. `{braces}` mark a value filled in at run time. A row with " / " holds the variants of one string.

### 1. First-run setup

| # | Where | What | Current | Proposed | Note |
| --- | --- | --- | --- | --- | --- |
| 1.1 | `components/FirstRun.tsx:49` | heading | Set up Yaak Proxy | keep | |
| 1.2 | `components/FirstRun.tsx:52` | description | Two steps, once. Then every app on this Mac sends its traffic here. | Record flows from every app on this Mac | Only one step is the user's. See flag F1. |
| 1.3 | `components/FirstRun.tsx:53` | description | Traffic appears here as apps send it. | Flows appear as apps send requests | Shown where the system proxy is unsupported. |
| 1.4 | `components/FirstRun.tsx:60` | step title | Turn on the system proxy | Override system proxy | One name for the switch. |
| 1.5 | `components/FirstRun.tsx:60` | step title, done | System proxy on | System proxy overridden | |
| 1.6 | `components/FirstRun.tsx:64` | step description | The CLI owns the proxy. Take over to turn this on from here. | Running from the CLI | The strip above already offers Take Over. |
| 1.7 | `components/FirstRun.tsx:65` | step description | Another Yaak Proxy window owns the engine. Quit it to use this one. | Running in another Yaak Proxy. Quit it to use this one. | Same wording as 2.33 and 2.35. |
| 1.8 | `components/FirstRun.tsx:76` | button | Turn On | Enable | Yaak says "Enable" for switches. |
| 1.9 | `components/FirstRun.tsx:76` | button | Try Again | Retry | |
| 1.10 | `components/FirstRun.tsx:87` | step title | Encrypting stored traffic, {percent} | Encrypting flows, {percent} | Same string as 2.9 and 12.1. |
| 1.11 | `components/FirstRun.tsx:89` | step title | Waiting for traffic | Waiting for flows | |
| 1.12 | `components/FirstRun.tsx:90` | step title | See traffic | Record flows | |
| 1.13 | `components/FirstRun.tsx:94` | step description | Traffic captured before this version is being encrypted on disk. Recording starts when it's done. | Recording starts when done | Mechanism cut. Same string as 2.10. |
| 1.14 | `components/FirstRun.tsx:96` | error | The proxy has not started. | Failed to start the proxy | Fallback when there is no reason. Same as 2.17. |
| 1.15 | `components/FirstRun.tsx:98` | step description | Recording is paused, so traffic passes through without being stored. | Paused | The button beside it says Resume Recording. |
| 1.16 | `components/FirstRun.tsx:100` | step description | Open a website or send a request, and its flow appears here. | Open a website or send a request | |
| 1.17 | `components/FirstRun.tsx:101` | step description | Flows appear here as apps send requests. | Flows appear as apps send requests | |
| 1.18 | `components/FirstRun.tsx:111` | button | Retry | keep | |
| 1.19 | `components/FirstRun.tsx:119` | button | Resume Recording | keep | |
| 1.20 | `components/FirstRun.tsx:126` | description | Only need one terminal or one app? Copy the environment instead. | Or proxy a single terminal | Question and address cut. |
| 1.21 | `components/FirstRun.tsx:134` | button | Copy Environment | keep | |
| 1.22 | `components/FirstRun.tsx:138` | description | Working with an agent? `yaak mcp` gives it the proxy's flows and actions. | Connect an agent with `yaak mcp` | |
| 1.23 | `components/FirstRun.tsx:142` | description | Captured traffic is encrypted on disk with a key kept in your keychain, so macOS may ask to let Yaak Proxy use it. | Flows are encrypted on disk. macOS may ask for keychain access. | Shown on every platform. See flag F2. |

### 2. Header and status menu

| # | Where | What | Current | Proposed | Note |
| --- | --- | --- | --- | --- | --- |
| 2.1 | `components/ProxyLayout.tsx:82`, `:154` | tooltip | Toggle sidebar | keep | Same as Yaak's. |
| 2.2 | `components/ProxyLayout.tsx:106` | tooltip | Change to vertical layout / Change to horizontal layout | keep | Same as Yaak's. |
| 2.3 | `components/ProxyLayout.tsx:117` | tooltip | Settings | keep | |
| 2.4 | `components/ClearFlowsButton.tsx:52` | tooltip, disabled | Clear flows (traffic is locked) | Clear flows | The locked state is on screen. |
| 2.5 | `components/ClearFlowsButton.tsx:54` | tooltip, disabled | Clear flows (none yet) | Clear flows | |
| 2.6 | `components/ClearFlowsButton.tsx:56-57` | tooltip | Clear flows / Clear flows {hotkey} | keep | |
| 2.7 | `components/ProxyStatus.tsx:190-206` | status pill | Encrypting / CLI / Recording / Paused / Not running | keep | |
| 2.8 | `components/ProxyStatus.tsx:126` | menu item, right | Copied | keep | |
| 2.9 | `components/ProxyStatus.tsx:68` | menu row title | Encrypting stored traffic, {percent} | Encrypting flows, {percent} | |
| 2.10 | `components/ProxyStatus.tsx:69` | menu row description | Traffic captured before this version is being encrypted on disk. Recording starts when it's done. | Recording starts when done | |
| 2.11 | `components/ProxyStatus.tsx:74` | menu row title | Running from the CLI | keep | |
| 2.12 | `components/ProxyStatus.tsx:75` | menu row description | Started by yaak proxy start, pid {pid}, since {time}. Port {port}. | pid {pid}, since {time} | The port is the menu's first item. |
| 2.13 | `components/ProxyStatus.tsx:80` | menu row title | Recording on port {port} / Paused on port {port} | keep | |
| 2.14 | `components/ProxyStatus.tsx:83` | menu row description | Every flow is stored as it passes. | (remove) | Needs the row to allow no description. |
| 2.15 | `components/ProxyStatus.tsx:84` | menu row description | Traffic passes through untouched, and nothing is stored. | Flows are not recorded | Same as 4.30. |
| 2.16 | `components/ProxyStatus.tsx:90` | menu row title | Not running | keep | |
| 2.17 | `components/ProxyStatus.tsx:93` | error | The proxy has not started. | Failed to start the proxy | |
| 2.18 | `components/ProxyStatus.tsx:106` | button | Retry | keep | |
| 2.19 | `lib/systemProxy.ts:134` | menu item | Pause Recording / Resume Recording | keep | |
| 2.20 | `components/ProxyStatus.tsx:152`, `:168` | menu row title | Override system proxy | keep | |
| 2.21 | `lib/systemProxy.ts:47` | menu row description, on | Routing this Mac's web traffic through Yaak Proxy | Records every app on this Mac | |
| 2.22 | `lib/systemProxy.ts:48` | menu row description, off | Not routing. Only apps pointed at port {port} are captured | Records only apps pointed at port {port} | |
| 2.23 | `lib/systemProxy.ts:31` | menu row description, pending | Changing the system proxy | Changing... | |
| 2.24 | `lib/systemProxy.ts:31` | menu row description, pending | Waiting for your password | Waiting for macOS | Same event as 2.29. |
| 2.25 | `lib/systemProxy.ts:40` | error | Cancelled in the password prompt | Cancelled | See flag D2. |
| 2.26 | `components/ProxyStatus.tsx:160` | notice | macOS asks for your password each time until the helper is approved in Settings. | Requires a password each time without the helper | See flag F3. |
| 2.27 | `components/ProxyStatus.tsx:235`, `:256`, `:267` | menu row title | Decrypt everything | keep | A row title, so sentence case; the button is "Decrypt Everything". |
| 2.28 | `components/ProxyStatus.tsx:215`, `:236` | pill and description | Certificate not trusted | keep | |
| 2.29 | `components/ProxyStatus.tsx:247`, `:259` | button and description | Waiting for macOS / Trust | keep | |
| 2.30 | `components/ProxyStatus.tsx:261` | menu row description, on | Except Apple services and apps that pin | Except exclusions | See flag F4. |
| 2.31 | `components/ProxyStatus.tsx:262`, `lib/decrypt.ts:226-227` | menu row description, off | {n} apps, {n} hosts | keep | |
| 2.32 | `components/ProxyStatus.tsx:262` | menu row description, off | Nothing listed | No hosts or apps | Same as 10.34. |
| 2.33 | `components/TakeOverBanner.tsx:20` | banner | Running from the CLI / Running in another Yaak Proxy | keep | |
| 2.34 | `components/TakeOverBanner.tsx:27` | banner, code | yaak proxy start | keep | |
| 2.35 | `components/TakeOverBanner.tsx:32` | banner | Another Yaak Proxy window owns the engine. Quit it to use this one. | Quit it to use this one | The lead beside it already says where it runs. See flag D1. |
| 2.36 | `components/TakeOverBanner.tsx:36` | banner | pid {pid}, since {time}. Flows still list here, read from the capture database. | pid {pid}, since {time} | |
| 2.37 | `components/TakeOverBanner.tsx:47` | button | Take over | Take Over | |
| 2.38 | `components/HttpsStrip.tsx:58` | banner | Certificate not trusted | keep | |
| 2.39 | `components/HttpsStrip.tsx:59` | banner | Required to decrypt | keep | |
| 2.40 | `components/HttpsStrip.tsx:67` | button | Waiting for macOS / Trust | keep | |
| 2.41 | `components/HttpsStrip.tsx:120` | banner | HTTPS is encrypted | keep | |
| 2.42 | `lib/httpsStrip.ts:47` | banner count | {n} connection / {n} connections | keep | |
| 2.43 | `components/HttpsStrip.tsx:127` | tooltip | New connections, except Apple services and apps that pin | New connections, except exclusions | |
| 2.44 | `components/HttpsStrip.tsx:143` | button | Decrypt Everything | keep (user's wording) | |
| 2.45 | `components/HttpsStrip.tsx:148` | button | Choose… | Choose | No ellipsis on a button that opens a menu. |
| 2.46 | `components/HttpsStrip.tsx:74` | menu heading | Apps | keep | |
| 2.47 | `components/HttpsStrip.tsx:96` | menu heading | Sites | Domains | |
| 2.48 | `components/HttpsStrip.tsx:112` | menu item | Edit List in Settings… | Decryption Settings | As Yaak's "Workspace Settings". |
| 2.49 | `components/HttpsStrip.tsx:155` | tooltip | Not now | Dismiss | As Yaak's toast and banner. |

### 3. Search box and search history

| # | Where | What | Current | Proposed | Note |
| --- | --- | --- | --- | --- | --- |
| 3.1 | `components/SearchBar.tsx:527-528` | placeholder | Search flows / Search {n} flows | keep | |
| 3.2 | `components/SearchBar.tsx:175` | placeholder, locked | Traffic is locked | Flows are locked | |
| 3.3 | `components/SearchBar.tsx:208` | menu item | Save search | Save Search | |
| 3.4 | `lib/flowActions.ts:97` | menu item | Export All Flows as HAR / Export Matching Flows as HAR | keep | |
| 3.5 | `components/SearchBar.tsx:222` | tooltip | Search actions | keep | |
| 3.6 | `components/SearchBar.tsx:230` | tooltip | Clear search | keep | |
| 3.7 | `components/SearchBar.tsx:314` | tooltip | Recent filters | Recent searches | |
| 3.8 | `components/SearchBar.tsx:278` | menu item, empty | No recent filters | No recent searches | As Yaak's "No recent requests". |
| 3.9 | `components/SearchBar.tsx:290` | tooltip | Save search | keep | |
| 3.10 | `components/SearchBar.tsx:296` | tooltip | Remove | keep | |
| 3.11 | `components/SearchBar.tsx:303` | menu item | Clear History | keep | |
| 3.12 | `components/SearchBar.tsx:327` | completion detail | Recent | keep | |
| 3.13 | `lib/searchBox.ts:42-43` | lint label | Unknown field / Invalid value | keep | |
| 3.14 | `lib/searchBox.ts:44` | lint label | Not yet | Not supported | "Yet" is a hedge. |
| 3.15 | `proxy-lib/query.rs:86` | completion info | Host, wildcards allowed | Host | The example beside it shows the wildcard. |
| 3.16 | `proxy-lib/query.rs:87` | completion info | URL path, /* for below | URL path | The example shows it. |
| 3.17 | `proxy-lib/query.rs:88` | completion info | GET, POST, … | HTTP method | |
| 3.18 | `proxy-lib/query.rs:89-90` | completion info | Response status / Content type | keep | |
| 3.19 | `proxy-lib/query.rs:91` | completion info | App or program | App | |
| 3.20 | `proxy-lib/query.rs:95` | completion info | error, pending, system, encrypted, rejected, … | keep | A list of its values. |
| 3.21 | `proxy-lib/query.rs:98` | completion info | A header on either side | Request or response header | |
| 3.22 | `proxy-lib/query.rs:99-100` | completion info | A request header / A response header | Request header / Response header | |
| 3.23 | `proxy-lib/query.rs:101-103` | completion info | Response body size / Request body size / Response body size | keep | |
| 3.24 | `proxy-lib/query.rs:104` | completion info | Total time | Time | The column's name. See flag N3. |
| 3.25 | `proxy-lib/query.rs:105` | completion info | When the flow started | Time since start | |
| 3.26 | `proxy-lib/query.rs:106` | completion info | The whole URL | Full URL | |
| 3.27 | `proxy-lib/query.rs:107` | completion info | A query parameter | Query parameter | |
| 3.28 | `proxy-lib/query.rs:108-111` | completion info | http or https / Port / h1, h2, ws, sse, grpc / Flow number | keep | |
| 3.29 | `proxy-lib/query.rs:112` | completion info | Working folder | Working directory | The Info tab says "Directory". |
| 3.30 | `proxy-lib/query.rs:113` | completion info | Process id | Process ID | |
| 3.31 | `proxy-lib/query.rs:117-121` | completion info | GraphQL operation name / gRPC service / gRPC method | keep | |
| 3.32 | `proxy-lib/query.rs:122-124` | completion info | Not yet | Not supported | |
| 3.33 | `components/AddColumnDialog.tsx:105`, `:110` | input label and placeholder | Field / @header.x-request-id | keep | The dialog itself is 9.9. |
| 3.34 | `lib/columns.ts:107-110` | validation | Missing name / Invalid name / Incomplete / Unknown field | keep | |

### 4. Flow list and its menus

| # | Where | What | Current | Proposed | Note |
| --- | --- | --- | --- | --- | --- |
| 4.1 | `lib/columns.ts:66-82` | column headers | App, Method, Host, Path, Query, Status, Type, Request Size, Size, Time, Latency, Started, Remote Address, HTTP Version, TLS Version, Operation | keep | See flag N3 for Time and Latency. |
| 4.2 | `components/FlowListHeader.tsx:133`, `:251` | menu heading and tooltip | Columns | keep | |
| 4.3 | `components/FlowListHeader.tsx:152`, `:208` | menu item | Remove Column | keep | |
| 4.4 | `components/FlowListHeader.tsx:162` | menu item | Add Column… | Add Column | |
| 4.5 | `components/FlowListHeader.tsx:164` | menu item | Reset Sort | keep (user's wording) | |
| 4.6 | `components/FlowListHeader.tsx:165`, `:215` | menu item | Reset Column Widths | keep | |
| 4.7 | `components/FlowListHeader.tsx:167` | menu item | Reset Column Order | keep | |
| 4.8 | `components/FlowListHeader.tsx:178-181` | menu item | Sort Ascending / Sort Descending / Add to Sort Ascending / Add to Sort Descending | keep | |
| 4.9 | `components/FlowListHeader.tsx:182` | menu item | Clear Sorting | Reset Sort | The same action as 4.5. |
| 4.10 | `components/FlowListHeader.tsx:185`, `:190` | menu item | Move Left / Move Right | keep | |
| 4.11 | `components/FlowListHeader.tsx:196`, `:201` | menu item | Hide Column / Hide Other Columns | keep | |
| 4.12 | `components/FlowList.tsx:531` | divider | {n} new | keep | |
| 4.13 | `components/FlowList.tsx:551` | button | 1 new flow / {n} new flows | keep | |
| 4.14 | `components/FlowList.tsx:914-915` | tooltip | Encrypted: excluded by default / Encrypted: excluded by {entry} | keep | |
| 4.15 | `components/FlowList.tsx:917` | tooltip | Encrypted: passed through after a client rejected the certificate | Encrypted: an app rejected the certificate | |
| 4.16 | `components/FlowList.tsx:919` | tooltip | Encrypted: not on the decrypt list | Encrypted: decryption not enabled | Follows your card line. |
| 4.17 | `components/FlowList.tsx:932` | tooltip | Rejected the proxy's certificate | Rejected the certificate | Same as 12.32. |
| 4.18 | `components/FlowList.tsx:933-936` | tooltip | Failed: {error} / Cancelled by the app / Streaming | keep | |
| 4.19 | `components/FlowList.tsx:937` | tooltip | Body cut at the capture limit | Body truncated | |
| 4.20 | `components/FlowList.tsx:938` | tooltip | Saved to Yaak | keep | |
| 4.21 | `components/FlowList.tsx:1109`, `:1209` | cell | Rejected certificate / Cancelled | keep | |
| 4.22 | `components/FlowList.tsx:1361-1367` | menu item | Filter by This Value / Exclude This Value / Copy Value | keep (user's wording) | |
| 4.23 | `lib/flowActions.ts:148` | menu item | Save as Yaak Request / Save to Yaak Again | keep | |
| 4.24 | `lib/flowActions.ts:155-193` | menu item | Copy as cURL / Copy URL / Copy Request Body / Copy Response Body | keep | |
| 4.25 | `lib/flowActions.ts:200`, `:206` | menu item | Save Request Body to File / Save Response Body to File | keep | |
| 4.26 | `lib/flowActions.ts:212` | menu item | Export HAR | Export as HAR | As "Export All Flows as HAR". |
| 4.27 | `components/FlowListEmpty.tsx:31` | empty state | No flows yet | No flows | |
| 4.28 | `components/FlowListEmpty.tsx:31` | empty state | Recording is paused | Paused | |
| 4.29 | `components/FlowListEmpty.tsx:34` | empty state | The proxy is not running. Retry from the menu by the state. | Not running. Retry from the status menu. | |
| 4.30 | `components/FlowListEmpty.tsx:36` | empty state | Traffic passes through without being stored. | Flows are not recorded | |
| 4.31 | `components/FlowListEmpty.tsx:37` | empty state | Recording on port {port}. Flows appear as apps send requests. | Recording on port {port} | |
| 4.32 | `components/FlowListEmpty.tsx:59-60` | list row | Paused at {time}. Traffic passes through without being stored. | Paused at {time} | |
| 4.33 | `components/FlowListEmpty.tsx:105-106` | empty state | No flows match. Found matches for {query} ({n}), or {query} ({n}) | No results, but found matches for {query} ({n}) or {query} ({n}) | Yaak's sidebar wording. Alone: "No results". |
| 4.34 | `components/FlowListEmpty.tsx:111` | empty state, code | all traffic | all flows | |

### 5. Sidebar and its menus

| # | Where | What | Current | Proposed | Note |
| --- | --- | --- | --- | --- | --- |
| 5.1 | `lib/sidebarTree.ts:350` | row | All traffic | All Flows | |
| 5.2 | `lib/sidebarTree.ts:357`, `:301-303`, `:395` | rows | Saved / Apps / Domains / System / Encrypted | keep | |
| 5.3 | `components/Sidebar.tsx:103` | tooltip | Encrypted | keep | |
| 5.4 | `components/Sidebar.tsx:198-201` | menu item | Filter by This Value / Exclude This Value / Copy Value | keep (user's wording) | |
| 5.5 | `lib/decrypt.ts:395` | menu item | Decrypt {name} / Stop Decrypting {name} | keep | |
| 5.6 | `lib/decrypt.ts:425-427` | menu item, several rows | Decrypt {n} Apps / {n} Hosts / {n} Sites / {n} Selected | Decrypt {n} Apps / {n} Hosts / {n} Domains / {n} Selected | Also in its toast, lower case. |
| 5.7 | `lib/opener.ts:26-27` | menu item | Reveal in Finder / Show in Explorer | keep | |
| 5.8 | `lib/opener.ts:28` | menu item | Show in Folder | Show in File Manager | Yaak's name on Linux. Also `components/Settings.tsx:230`. |
| 5.9 | `components/Sidebar.tsx:178` | menu item | Copy path | Copy Path | |
| 5.10 | `components/Sidebar.tsx:225`, `:248` | menu item | Show in All Traffic | Show in All Flows | |
| 5.11 | `components/Sidebar.tsx:235` | menu item | Decrypt Everything | keep (user's wording) | |
| 5.12 | `components/Sidebar.tsx:261`, `:270` | menu item | Rename / Delete | keep | |

### 6. Detail card and its tabs

| # | Where | What | Current | Proposed | Note |
| --- | --- | --- | --- | --- | --- |
| 6.1 | `components/FlowDetail.tsx:31-35` | empty state | Select a flow / Pause or resume recording / Clear flows | keep | The keys beside them are fixed to macOS. See flag F6. |
| 6.2 | `components/FlowCard.tsx:144`, `:153`, `:225` | tab | Cookies / Info / Body | keep | |
| 6.3 | `lib/messages.ts:124` | tab | Events / Messages | keep | |
| 6.4 | `lib/flowViews.ts:240-248` | tab | Auth / Basic / Bearer / Digest / Negotiate | keep | |
| 6.5 | `components/FlowCard.tsx:308` | empty state | Waiting for a response | Waiting for response | No articles in labels. |
| 6.6 | `components/FlowCard.tsx:326` | badge | Body cut | Truncated | |
| 6.7 | `components/FlowCard.tsx:326` | badge | First {size} kept | First {size} shown | |
| 6.8 | `components/FlowCard.tsx:336` | tooltip | Save to Yaak / Saved to Yaak | keep | |
| 6.9 | `components/FlowCard.tsx:341`, `components/EncryptedCard.tsx:298` | tooltip | Actions | keep | |
| 6.10 | `lib/flowViews.ts:122` | error | Cancelled by the client | Cancelled by the app | The list says "app" (4.18). |
| 6.11 | `components/FlowInfo.tsx:31-72` | section heading | Connection / App / Timing / Size | keep | |
| 6.12 | `components/FlowInfo.tsx:78` | section heading | Record | Flow | "Record" is the app's verb. |
| 6.13 | `components/FlowInfo.tsx:33-38` | row label | Remote Address / Client Version / Server Version / TLS / Cipher / Client Port | keep | Client and Server as the two HTTP sides. |
| 6.14 | `components/FlowInfo.tsx:45-58` | row label | Name / Bundle ID / Path / PID / Directory | keep | |
| 6.15 | `components/FlowInfo.tsx:65` | row label | Started | keep | |
| 6.16 | `components/FlowInfo.tsx:68` | row label | Headers | Latency | The column's name. See flag N3. |
| 6.17 | `components/FlowInfo.tsx:69` | row label | Total | Time | The column's name. |
| 6.18 | `components/FlowInfo.tsx:74-81` | row label | Request / Response / Number / ID | keep | |
| 6.18a | `components/FlowInfo.tsx:82` | row label | Saved As | Yaak Request ID | Its value is an ID, not a name. See flag F9. |
| 6.19 | `components/FlowInfo.tsx:103` | section heading | Timeline | keep | |
| 6.20 | `lib/phases.ts:37-58` | timeline step | Started / Connected / TLS handshake / Request sent / Headers received, {status} / Failed / Cancelled / Body received / Closed | keep | |
| 6.21 | `lib/body.ts:222-247` | tab badge | GraphQL / Binary / Multipart / Form / Image / Audio / Video / Font / Markdown / Protobuf / Text | keep | |
| 6.22 | `lib/body.ts:44` | empty state | No body. See Messages. | keep | |
| 6.23 | `lib/body.ts:45` | empty state | No request body / Empty | keep | Same as Yaak's panes. |
| 6.24 | `components/FlowBodyViewer.tsx:241` | banner | {error}. Showing the body as it was on the wire. | {error}. Showing the raw body. | |
| 6.25 | `components/FlowBodyViewer.tsx:247` | banner | Showing the first {size} of {size}, the capture limit. The app received all of it. | Showing first {size} of {size} | |
| 6.26 | `components/FlowBodyViewer.tsx:248` | banner | Showing the first {size} of the decoded body, the capture limit. The app received all of it. | Showing first {size} of the decoded body | |
| 6.27 | `components/FlowRequestBody.tsx:47` | banner | First {size} of {size} kept | Showing first {size} of {size} | The same fact as 6.25 in other words. |
| 6.28 | `components/FlowRequestBody.tsx:45` | tooltip | The app sent all of it | (remove) | |
| 6.29 | `components/FlowBodyViewer.tsx:276-277` | label | Binary body, {size}, first {size} shown | keep | As Yaak's "Binary body, {size}". |
| 6.30 | `components/FlowBodyViewer.tsx:285` | button | Save to File | keep | |
| 6.31 | `ui/http/BodyViewModeSwitch.tsx:10-17` | switch labels | Pretty / Table / Parts / Preview / Form / Raw | keep | Proxy only. |
| 6.32 | `ui/http/BodyViewModeSwitch.tsx:10-17` | tooltip | Formatted / As a table / Split into parts / Rendered / As fields / As received | keep | |
| 6.33 | `ui/http/ResponseCookies.tsx:123`, `:149`, `:173`, `:227` | headings and empty state | Sent Cookies / Received Cookies / Deleted / No Cookies | keep | Proxy only. |
| 6.34 | `components/FlowMessages.tsx:15-33` | column headers | Type / Message / Event / Data | keep | |
| 6.35 | `components/FlowMessages.tsx:52` | button | {n} new messages / {n} new events | keep | |
| 6.36 | `components/FlowMessages.tsx:94-98` | status | CONNECTED / ERROR / CLOSED | keep | As Yaak's WebSocket pane. |
| 6.37 | `components/FlowMessages.tsx:104` | count | {n} Messages / {n} Events | keep | |
| 6.38 | `components/FlowMessages.tsx:123` | empty state | Waiting for the first message / Waiting for the first event | Waiting for messages / Waiting for events | |
| 6.39 | `components/FlowMessages.tsx:123` | empty state | No Messages / No Events | No messages / No events | |
| 6.40 | `components/FlowMessages.tsx:79-81` | view options | Decoded / Schemaless / Raw bytes | keep | |
| 6.41 | `components/FlowMessages.tsx:71` | note | Decoded as {type} | keep | |
| 6.42 | `lib/messages.ts:38`, `:46` | note | No status / No status code | keep | |
| 6.43 | `lib/messages.ts:66-82` | detail title | Event Received / Closed by the App / Closed by the Server / Ping / Pong / Call Status | keep | |
| 6.44 | `ui/events/EventStreamViewer.tsx:484` | banner | The message is cut at the capture limit. | Message truncated | |
| 6.45 | `proxy-lib/grpc.rs:370-388` | note | No schema for {service} on {host} | keep | |
| 6.46 | `proxy-lib/grpc.rs:390` | note | No schema for {service}; reflection failed: {error} | No schema for {service}. Reflection failed: {error} | No semicolons. |
| 6.47 | `proxy-lib/grpc.rs:454` | note | Did not decode as {type}: {error} | Failed to decode as {type}: {error} | |
| 6.48 | `engine/grpc.rs:187` | message error | The body ended partway through this message, {n} of its {n} bytes in | Incomplete message: {n} of {n} bytes | |
| 6.49 | `engine/grpc.rs:229`, `:240` | message error | Compressed with {encoding}, not decoded / Too large to decompress | keep | |
| 6.50 | `engine/grpc.rs:241`, `engine/ws.rs:351`, `:399` | message error | Failed to decompress the message: {error} / Failed to inflate the message: {error} | Failed to decompress message: {error} | Two words for one failure. |
| 6.51 | `engine/ws.rs:357` | message error | Not inflated: an earlier message failed to, which lost the context | Not decompressed: an earlier message failed | |

### 7. Encrypted and rejected cards

| # | Where | What | Current | Proposed | Note |
| --- | --- | --- | --- | --- | --- |
| 7.1 | `components/EncryptedCard.tsx:278` | status | ENCRYPTED / REJECTED | keep | |
| 7.2 | `components/EncryptedCard.tsx:282` | status | open {duration} | keep | |
| 7.3 | `lib/encryptedCard.ts:276-278` | why line | **Encrypted Content:** Enable decryption to see requests to {host} | keep (user's wording) | |
| 7.4 | `lib/encryptedCard.ts:272` | why line | Nothing is decrypted yet | **Encrypted Content:** Enable decryption to see requests to {host} | The same case and buttons as 7.3, so the same line. |
| 7.5 | `lib/encryptedCard.ts:274` | why line | Not on the decrypt list | Opened before {entry} was decrypted | Shown when the list does decrypt it now. Merge with 7.6. See flag F5. |
| 7.6 | `lib/encryptedCard.ts:177` | fact line | Opened before {entry} was decrypted / Opened before everything was decrypted | (remove, merged into 7.5) | Needs the two lines merged. |
| 7.7 | `lib/encryptedCard.ts:266`, `:268` | why line | Excluded by default / Excluded by {entry} | keep | |
| 7.8 | `lib/encryptedCard.ts:265` | why line, after | Apple service / pins its certificate | keep | |
| 7.9 | `components/EncryptedCard.tsx:178` | tooltip | HTTPS is encrypted between the app and the server. Yaak Proxy shows requests only for hosts and apps you decrypt, from their next connection on. | Decryption applies from the next connection | |
| 7.10 | `lib/encryptedCard.ts:292`, `:304` | button | Decrypt {name} / Stop Decrypting {name} | keep | |
| 7.11 | `lib/encryptedCard.ts:209` | button | Decrypt Everything | keep (user's wording) | |
| 7.12 | `lib/encryptedCard.ts:226-227` | button | Stop Excluding {name} / Stop Excluding {n} Entries | keep | |
| 7.13 | `lib/encryptedCard.ts:168` | button | Reconnect | keep | |
| 7.14 | `components/EncryptedCard.tsx:150` | button | Waiting for macOS | keep | |
| 7.15 | `lib/encryptedCard.ts:197` | foot | macOS may refuse it / {app} may refuse it | macOS may reject it / {app} may reject it | |
| 7.16 | `lib/encryptedCard.ts:240` | foot | Asks for your password once | Requires a password once | |
| 7.17 | `lib/encryptedCard.ts:379` | why line | Certificate not trusted | keep | |
| 7.18 | `lib/encryptedCard.ts:383` | button | Trust Certificate | keep | |
| 7.19 | `lib/encryptedCard.ts:394`, `:415` | why line | {app} rejected the certificate / {app} rejected the certificate for this host | keep | |
| 7.20 | `lib/encryptedCard.ts:416` | why line | A client rejected the certificate | An app rejected the certificate | |
| 7.21 | `lib/encryptedCard.ts:395`, `:418` | why line, after | uses its own trust store / likely pinned | keep | |
| 7.22 | `lib/encryptedCard.ts:400-401` | button and hint | Copy Environment / SSL_CERT_FILE, … | keep | |
| 7.23 | `lib/encryptedCard.ts:373` | button and hint | Try Again / next connection | Retry / next connection | |
| 7.24 | `lib/encryptedCard.ts:408` | foot | Then rerun {app} | keep | |
| 7.25 | `lib/encryptedCard.ts:386` | foot | Passed through until trusted | Encrypted until trusted | |
| 7.26 | `lib/encryptedCard.ts:424` | foot | Passed through until relaunch | Encrypted until relaunch | |
| 7.27 | `lib/encryptedCard.ts:374` | foot | No longer passed through | Decrypted from the next connection | |

### 8. Toasts

| # | Where | What | Current | Proposed | Note |
| --- | --- | --- | --- | --- | --- |
| 8.1 | `components/ProxyStatus.tsx:276`, `components/HttpsStrip.tsx:138`, `components/Sidebar.tsx:241`, `lib/encryptedCard.ts:212`, `components/DecryptListEditor.tsx:84` | toast | Decrypting everything | keep | |
| 8.2 | `components/ProxyStatus.tsx:277`, `components/HttpsStrip.tsx:139`, `components/Sidebar.tsx:242`, `lib/encryptedCard.ts:212`, `components/DecryptListEditor.tsx:85` | toast, second line | Except Apple services and apps that pin | Except exclusions | See flag F4. |
| 8.3 | `components/ProxyStatus.tsx:279`, `components/DecryptListEditor.tsx:84` | toast | Stopped decrypting everything | keep | |
| 8.4 | `components/HttpsStrip.tsx:92`, `:106`, `components/Sidebar.tsx:303`, `lib/encryptedCard.ts:295`, `:308`, `components/DecryptListEditor.tsx:70`, `:103` | toast | Decrypting {name} / Stopped decrypting {name} | keep | |
| 8.5 | `components/DecryptListEditor.tsx:69`, `:102`, `lib/encryptedCard.ts:234` | toast | Excluding {name} / Stopped excluding {name} | keep | |
| 8.6 | `lib/decryptChoice.ts:84` | toast, second line | {n} open connections stay encrypted | keep | |
| 8.7 | `hooks/useDecrypt.tsx:151`, `:162` | toast button | Undo / Reconnect | keep | |
| 8.8 | `hooks/useDecrypt.tsx:123` | warning toast | Certificate not trusted | keep | |
| 8.9 | `hooks/useDecrypt.tsx:49` | error toast | Certificate not trusted: {error} | Failed to trust certificate: {error} | Tells it apart from 8.8. |
| 8.10 | `components/Sidebar.tsx:294` | notice toast | Excluded by {entry} | keep | |
| 8.11 | `components/ProxyStatus.tsx:353` | toast | Copied the environment. Paste it into a terminal to proxy what runs there. | Copied to clipboard | Yaak's one copy toast. |
| 8.12 | `components/FlowList.tsx:1372`, `components/Sidebar.tsx:206` | toast | Copied value | Copied to clipboard | |
| 8.13 | `lib/flowActions.ts:138` | toast | Copied cURL / Copied URL / Copied request body / Copied response body | Copied to clipboard | |
| 8.14 | `components/ProxyStatus.tsx:356`, `components/FlowList.tsx:1374`, `components/Sidebar.tsx:208`, `lib/flowActions.ts:140` | error toast | Failed to copy: {error} / Failed to copy value: {error} / Failed to copy {thing}: {error} | Failed to copy | Yaak's one copy error. |
| 8.15 | `lib/flowActions.ts:165`, `:169` | error toast | Failed to copy cURL: {error} | keep | The reason matters here. |
| 8.16 | `lib/flowActions.ts:134` | info toast | There is no {thing} to copy | Nothing to copy | |
| 8.17 | `lib/flowActions.ts:176` | info toast | Body is binary or truncated; export HAR instead | Body is binary or truncated. Export as HAR instead. | No semicolons. |
| 8.18 | `lib/flowActions.ts:40` | toast | Saved {size} | keep | |
| 8.19 | `lib/flowActions.ts:36` | toast, appended | as it was on the wire, since it failed to decode | not decoded | |
| 8.20 | `lib/flowActions.ts:37` | toast, appended | cut at the capture limit | truncated | |
| 8.21 | `lib/flowActions.ts:43` | error toast | Failed to save the {request or response} body: {error} | Failed to save {request or response} body: {error} | |
| 8.22 | `lib/flowActions.ts:75` | toast | Exported 1 flow as HAR / Exported {n} flows as HAR | keep | |
| 8.23 | `lib/flowActions.ts:217`, `components/SaveDialog.tsx:254` | toast | Exported the flow as HAR | Exported 1 flow as HAR | The same event as 8.22. |
| 8.24 | `lib/flowActions.ts:79`, `:219`, `components/SaveDialog.tsx:257` | error toast | Failed to export HAR: {error} | keep | |
| 8.25 | `components/SaveDialog.tsx:105-106` | toast | Saved {name} to {workspace}, in {folder}. Yaak picks it up within a second. | Saved {name} to {workspace} | |
| 8.26 | `components/SettingsProxy.tsx:283` | toast | Captured data reset | Data reset | |
| 8.27 | `lib/opener.ts:11` | error toast | Failed to show {path}: {error} | Failed to reveal {path}: {error} | |
| 8.28 | `lib/opener.ts:20` | error toast | Failed to open {url}: {error} | keep | |

### 9. Dialogs

| # | Where | What | Current | Proposed | Note |
| --- | --- | --- | --- | --- | --- |
| 9.1 | `components/ClearFlowsButton.tsx:69` | dialog title | Clear traffic? | Clear Flows | Titles are never questions. |
| 9.2 | `components/ClearFlowsButton.tsx:106-107` | dialog body | 1 flow will be removed. / {n} flows will be removed. | Permanently clear 1 flow? / Permanently clear {n} flows? | Yaak's confirm form. |
| 9.3 | `components/ClearFlowsButton.tsx:109` | checkbox | Don't ask again | keep (user's wording) | |
| 9.4 | `components/ClearFlowsButton.tsx:113-114` | button | Cancel / Clear | keep | |
| 9.5 | `components/SavedSearchDialog.tsx:50` | dialog title | Save search / Rename search | Save Search / Rename Search | |
| 9.6 | `components/SavedSearchDialog.tsx:61` | input label | Name | keep | |
| 9.7 | `components/SavedSearchDialog.tsx:70-72` | button | Cancel / Save / Rename | keep | |
| 9.8 | `proxy-lib/saved_queries.rs:64`, `:74` | error toast | A saved search needs a name / Nothing to save | Name is required / Nothing to save | |
| 9.9 | `components/AddColumnDialog.tsx:92` | dialog title | Add Column | keep | |
| 9.10 | `components/AddColumnDialog.tsx:126-127` | button | Cancel / Add | keep | |
| 9.11 | `components/SaveDialog.tsx:43` | dialog title | Save as Yaak request | Save as Yaak Request | |
| 9.12 | `components/SaveDialog.tsx:44` | dialog description | A new request in Yaak with this flow's method, URL, headers and body. | (remove) | The form below shows all four. |
| 9.13 | `components/SaveDialog.tsx:118` | banner | Yaak has no workspaces yet. Create one in Yaak, then save here. | No workspaces. Create one in Yaak first. | |
| 9.14 | `components/SaveDialog.tsx:145-173` | form labels | Workspace / Folder / No folder / Name | keep | |
| 9.15 | `components/SaveDialog.tsx:178-179` | heading | 1 header left out / {n} headers left out | keep | |
| 9.16 | `components/SaveDialog.tsx:322` | heading, after | Yaak sets these itself when it sends | Set by Yaak when sending | |
| 9.17 | `components/SaveDialog.tsx:324` | heading, after | Yaak sets these itself, or they only meant something to the proxy | Set by Yaak, or only for the proxy | |
| 9.18 | `components/SaveDialog.tsx:311-315` | tooltip | Yaak sets it when it sends / Only meant for the proxy / The body is saved decoded | Set by Yaak when sending / Only for the proxy / Body is saved decoded | |
| 9.19 | `components/SaveDialog.tsx:201`, `:234` | row label | Kept / Note | keep | |
| 9.20 | `components/SaveDialog.tsx:203-204` | row value | {n} headers, and no body / {n} headers, and the body as {type} | {n} headers, no body / {n} headers, body as {type} | |
| 9.21 | `proxy-lib/lib.rs:2781-2791` | row value, type | JSON / XML / GraphQL / text | keep | |
| 9.22 | `proxy-lib/lib.rs:2787-2788` | row value, type | form URL-encoded with 1 field / form URL-encoded with {n} fields | a form with 1 field / a form with {n} fields | |
| 9.23 | `proxy-lib/convert.rs:68` | note | The Authorization header is saved as captured, in plain text. | Authorization header is saved in plain text | The dialog matches on the word "Authorization" to colour it. |
| 9.24 | `proxy-lib/convert.rs:73` | note | The body was cut at the capture limit, so only its first {n} bytes are saved. | Body truncated. Only the first {n} bytes are saved. | |
| 9.25 | `proxy-lib/convert.rs:173` | note | The body is binary and is saved as text, so bytes that are not UTF-8 are replaced. | Binary body saved as text. Bytes that are not UTF-8 are replaced. | |
| 9.26 | `proxy-lib/convert.rs:199` | note | The multipart body is saved as text with its Content-Type, not as form fields. | Multipart body saved as text, not form fields | |
| 9.27 | `components/SaveDialog.tsx:213` | footer | Yaak picks it up within a second | (remove) | Mechanism. Said again in the toast. See flag D3. |
| 9.28 | `components/SaveDialog.tsx:216` | button | Cancel | keep | |
| 9.29 | `components/SaveDialog.tsx:218` | button | Save request | Save | |
| 9.30 | `components/SaveDialog.tsx:265` | dialog heading | Saving needs Yaak | Yaak Required | As Yaak's "Credentials Required". |
| 9.31 | `components/SaveDialog.tsx:267-269` | dialog body | This flow becomes a request in one of Yaak's workspaces, and Yaak has not been opened on this Mac. Yaak is free for personal use and opens the request with the same viewers you see here. | Install Yaak and open it once to save flows as requests. | "This Mac" shows on every platform. See flag F2. |
| 9.32 | `components/SaveDialog.tsx:246` | footer | Or keep the flow as a file | (remove) | The button says it. |
| 9.33 | `components/SaveDialog.tsx:249` | button | Export HAR | Export as HAR | |
| 9.34 | `components/SaveDialog.tsx:261` | button | Download Yaak | keep | |
| 9.35 | `components/HelperDialog.tsx:51` | dialog title | Turn on Yaak Proxy under Allow in the Background | Approve Helper | The instruction moves to the description. |
| 9.36 | `components/HelperDialog.tsx:52` | dialog description | In System Settings > General > Login Items. Newer macOS calls the list Background App Activity. | Turn on Yaak Proxy under Allow in the Background, in System Settings > General > Login Items. | See flag F7. |
| 9.37 | `components/HelperDialog.tsx:80` | status | Waiting for approval | keep | |
| 9.38 | `components/HelperDialog.tsx:85-87` | button | Cancel / Close / Open System Settings | keep | |

### 10. Settings

The General, Theme and Interface tabs are Yaak's own shared pages and are not reviewed here.

| # | Where | What | Current | Proposed | Note |
| --- | --- | --- | --- | --- | --- |
| 10.1 | `components/Settings.tsx:156-181` | tab | General / Theme / Interface / Proxy / License | keep | |
| 10.2 | `components/Settings.tsx:182` | empty state | Coming soon | keep | Better to hide the tab until it has content; that is a behaviour change. |
| 10.3 | `components/Settings.tsx:226-230` | button | Reveal in Finder / Show in Explorer / Show in Folder | Reveal in Finder / Show in Explorer / Show in File Manager | |
| 10.4 | `components/SettingsProxy.tsx:61` | page title | Proxy | keep | |
| 10.5 | `components/SettingsProxy.tsx:61` | page description | Listening, decryption, traffic and terminals | Configure the port, decryption, and recorded flows. | Yaak's page descriptions are sentences. |
| **Proxy** | | | | | |
| 10.6 | `components/SettingsProxy.tsx:63` | section heading | Proxy | keep | |
| 10.7 | `components/SettingsProxy.tsx:150` | row title | Port | keep | |
| 10.8 | `components/SettingsProxy.tsx:150` | row description | Restarts the proxy | Restarts the proxy. | A consequence worth saying. |
| 10.9 | `components/SettingsProxy.tsx:67` | row title | HTTP version | keep | |
| 10.10 | `components/SettingsProxy.tsx:68` | row description | For new connections | (remove) | |
| 10.11 | `components/SettingsProxy.tsx:73-74` | option | Auto / HTTP/1.1 only | Automatic / HTTP/1.1 | As Yaak's own HTTP version select. |
| 10.12 | `components/SettingsProxy.tsx:80-81` | row title and description | Override system proxy / At launch | Override system proxy at launch / (remove) | One phrase split across two strings. |
| 10.13 | `components/SettingsProxy.tsx:182` | row title | Helper | keep | Ambiguous alone, so it keeps a description. |
| 10.14 | `lib/systemProxy.ts:79-80` | row description | Not installed. Changes use the password prompt. | Not installed. System proxy changes require a password. | |
| 10.15 | `lib/systemProxy.ts:85-86` | row description | Awaiting approval. Changes use the password prompt. | Awaiting approval. System proxy changes require a password. | |
| 10.16 | `lib/systemProxy.ts:91-94` | row description | Enabled. No password prompts. | Installed. System proxy changes need no password. | |
| 10.17 | `lib/systemProxy.ts:95` | row description | Enabled. One more password prompt puts back your settings. | Installed. One more password restores the previous settings. | |
| 10.18 | `lib/systemProxy.ts:66-67` | row description | Not in dev builds. Changes use the password prompt. | Not available in dev builds. | |
| 10.19 | `lib/systemProxy.ts:73-74` | row description | Not found by macOS. Changes use the password prompt. | Not found by macOS. | |
| 10.20 | `components/SettingsProxy.tsx:200-203` | button | Install / Approve / Unregister | Install / Approve / Uninstall | The pair of Install. |
| **Decryption** | | | | | |
| 10.21 | `components/SettingsProxy.tsx:91` | section heading | Decryption | keep | |
| 10.22 | `components/DecryptListEditor.tsx:130`, `:135` | row title and description | Certificate / Yaak Proxy CA | keep | Its literal name in the keychain. |
| 10.23 | `components/DecryptListEditor.tsx:140-147` | status and button | Trusted / Not trusted / Trust / Waiting for macOS | keep | |
| 10.24 | `components/DecryptListEditor.tsx:159` | button | Reveal | Reveal in Finder / Show in Explorer / Show in File Manager | The app's other reveal buttons name the place. |
| 10.25 | `components/DecryptListEditor.tsx:77` | row title | Decrypt everything | keep | |
| 10.26 | `components/DecryptListEditor.tsx:78` | row description | Except built-in exclusions | Except exclusions. | |
| 10.27 | `components/DecryptListEditor.tsx:91` | heading | Hosts and apps | keep | |
| 10.28 | `components/DecryptListEditor.tsx:92` | hint | New connections | Applies to new connections | Takes over from the tooltip, 10.29. |
| 10.29 | `components/DecryptListEditor.tsx:302` | tooltip | Applies to new connections | (remove) | Said twice. See flag D4. |
| 10.30 | `components/DecryptListEditor.tsx:310` | placeholder | Add host or app | keep | |
| 10.31 | `lib/decrypt.ts:474-476` | completion info | Exclude / Host or *.site | Exclude / Host or *.domain | |
| 10.32 | `lib/decrypt.ts:477` | completion info | App name or bundle id | App name or bundle ID | |
| 10.33 | `components/DecryptListEditor.tsx:289` | validation | Not a host or app | Invalid host or app | |
| 10.34 | `components/DecryptListEditor.tsx:109` | empty state | Nothing listed | No hosts or apps | |
| 10.35 | `lib/decrypt.ts:103-104` | list row | Everything / Nothing | keep | |
| 10.36 | `components/DecryptListEditor.tsx:190`, `:179` | list row | {n} built-in exclusions / Apple, pinned apps | keep | |
| 10.37 | `components/DecryptListEditor.tsx:223`, `:235` | tooltip and badge | Excluded / Decrypted / Apple / Pinned | keep | |
| 10.38 | `components/DecryptListEditor.tsx:242` | tooltip | Remove {entry} | keep | |
| **Flows** | | | | | |
| 10.39 | `components/SettingsProxy.tsx:95` | section heading | Traffic | Flows | |
| 10.40 | `components/SettingsProxy.tsx:220` | row title | Captured traffic | Flows on launch | |
| 10.41 | `components/SettingsProxy.tsx:226-227` | option | Clear on launch / Keep between launches | Clear / Keep | The title carries "on launch". |
| 10.42 | `components/SettingsProxy.tsx:243` | row title | Size limit | keep | |
| 10.43 | `components/SettingsProxy.tsx:243` | row description | Oldest flows dropped past it | Oldest flows are cleared first. | |
| 10.44 | `components/SettingsProxy.tsx:247`, `lib/settings.ts:141` | value and option | {size} used / Unlimited | keep | |
| 10.45 | `components/SettingsProxy.tsx:270` | row title | Confirm before clearing | keep | |
| 10.46 | `components/SettingsProxy.tsx:288` | row title | Reset captured data | Reset data | |
| 10.47 | `components/SettingsProxy.tsx:288` | row description | Deletes all flows and their keys | Delete all flows and their encryption keys. | |
| 10.48 | `components/SettingsProxy.tsx:290` | button | Reset… | Reset | |
| 10.49 | `components/SettingsProxy.tsx:296` | dialog title | Reset captured data? | Reset Data | |
| 10.50 | `components/SettingsProxy.tsx:297` | dialog body | Every captured flow and the keys that encrypt them are deleted. | Permanently delete all flows and their encryption keys? | |
| 10.51 | `components/SettingsProxy.tsx:302-304` | button | Cancel / Reset | keep | |
| **Terminal** | | | | | |
| 10.52 | `components/SettingsProxy.tsx:102` | section heading | Terminal | keep | |
| 10.53 | `components/SettingsProxy.tsx:333` | row title | Environment | keep | |
| 10.54 | `components/SettingsProxy.tsx:366` | row description | Proxies one terminal instead of the system | Proxy a single terminal instead of the system. | |
| 10.55 | `components/SettingsProxy.tsx:342`, `lib/env.ts:6-9` | tooltip and options | Shell / bash / zsh / fish / PowerShell / cmd | keep | |
| 10.56 | `components/SettingsProxy.tsx:363` | button | Open Terminal | keep | |
| 10.57 | `components/SettingsProxy.tsx:354` | tooltip | A new Terminal window with these set | (remove) | The button says it. |
| 10.58 | `components/SettingsProxy.tsx:355` | tooltip, disabled | Not available on this platform yet | macOS only | |

### 11. App menu

| # | Where | What | Current | Proposed | Note |
| --- | --- | --- | --- | --- | --- |
| 11.1 | `tauri/window_menu.rs:59-161` | menu titles | File / Edit / View / Go / Window / Help | keep | |
| 11.2 | `tauri/window_menu.rs:109` | menu item | Quit Yaak Proxy | keep | |
| 11.3 | `tauri/window_menu.rs:127` | menu item | Export All Flows as HAR | keep | |
| 11.4 | `tauri/window_menu.rs:164`, `:168` | menu item | Back / Forward | keep | |
| 11.5 | `tauri/lib.rs:139`, `:235` | window title | Yaak Proxy Settings / Yaak Proxy | keep | |
| 11.6 | `proxy-lib/actions.rs:38`, `:46` | action label | Pause or Resume Recording / Clear Flows | keep | Not shown anywhere today. |

### 12. Errors and the locked state

| # | Where | What | Current | Proposed | Note |
| --- | --- | --- | --- | --- | --- |
| **Locked state** | | | | | |
| 12.1 | `components/LockedState.tsx:31` | heading | Encrypting stored traffic, {percent} | Encrypting flows, {percent} | |
| 12.2 | `components/LockedState.tsx:43` | description | Earlier traffic shows here once it's encrypted. | Recording starts when done | The same line as 1.13 and 2.10. |
| 12.3 | `components/LockedState.tsx:38` | heading | Traffic is locked | Flows are locked | |
| 12.4 | `lib/locked.ts:24` | description | Allow Yaak Proxy to use its key in Keychain Access, then retry. | keep | Names Credential Manager or the keyring off macOS. |
| 12.5 | `components/LockedState.tsx:54` | button | Retry | keep | |
| 12.6 | `proxy-lib/lib.rs:2062` | error prefix | Traffic is locked: {reason} | Flows are locked: {reason} | `lib/locked.ts:4` strips this prefix, so both change together. |
| 12.7 | `proxy-lib/lib.rs:236` | error reason | traffic captured before this version is being encrypted. | flows are being encrypted. | |
| 12.8 | `proxy-lib/lib.rs:239` | error reason | its key has not been read yet. | the key has not been read. | |
| 12.9 | `proxy-lib/lib.rs:278` | error reason | {12.12}, so the traffic it stored can't be encrypted yet. Take over or quit it, then retry. | {12.12}. Take over or quit it, then retry. | |
| 12.10 | `proxy-lib/db.rs:158` | error reason | The proxy's captured traffic is encrypted, but its key is missing from {folder} | The encryption key is missing from {folder} | |
| 12.11 | `proxy-lib/db.rs:328-332` | error reason | Yaak Proxy stores traffic encrypted and couldn't read its key from the keychain: {reason}. Allow it access, then retry. | Failed to read the encryption key from the keychain: {reason}. Allow access, then retry. | Matched by its opening words in `db.rs:337`; one constant, so safe. |
| **Starting and taking over** | | | | | |
| 12.12 | `proxy-lib/control.rs:392` | error | The proxy is already running in {owner} (pid {pid}) | Already running in {owner} (pid {pid}) | |
| 12.13 | `proxy-lib/control.rs:397-398` | error, owner | Yaak Proxy / the yaak CLI | Yaak Proxy / the CLI | |
| 12.14 | `engine/lib.rs:569` | error | Failed to bind port {port}: {error} | keep | |
| 12.15 | `proxy-lib/lib.rs:723` | error | The proxy in {owner} (pid {pid}) stopped but did not let go of it | Failed to take over from {owner} (pid {pid}) | |
| 12.16 | `proxy-lib/lib.rs:949` | error | {12.12}. Quit it first. | keep | |
| 12.17 | `proxy-lib/lib.rs:855` | error toast | The port must be from 1 to 65535 | Port must be between 1 and 65535 | |
| **System proxy and helper** | | | | | |
| 12.18 | `proxy-lib/macos.rs:282` | macOS password prompt | Yaak Proxy wants to change your system proxy settings. | keep | macOS's own form for this prompt. |
| 12.19 | `proxy-lib/macos.rs:290` | error | Cancelled in the password dialog | Cancelled | See flag D2. |
| 12.20 | `proxy-lib/lib.rs:811` | error | The proxy is not running, so there is nothing to route to | The proxy is not running | |
| 12.21 | `proxy-lib/helper.rs:136-137` | error | Failed to install the helper: {error} | keep | |
| 12.22 | `proxy-lib/helper.rs:156` | error | Failed to remove the helper: {error} | Failed to uninstall the helper: {error} | Matches the button, 10.20. |
| 12.23 | `proxy-lib/helper.rs:161` | error | The helper is only available in the installed app, not a dev build | The helper is not available in dev builds | |
| 12.24 | `proxy-lib/helper.rs:173` | error | The helper is not running: {error} | keep | |
| 12.25 | `proxy-lib/helper.rs:184` | error | The helper hung up: {error} | The helper disconnected: {error} | |
| 12.26 | `proxy-lib/helper.rs:188` | error | The helper did not answer: {error} | The helper did not respond: {error} | |
| 12.27 | `proxy-lib/helper.rs:190` | error | The helper's answer was not understood: {error} | Invalid response from the helper: {error} | |
| 12.28 | `proxy-lib/ca.rs:106`, `proxy-lib/macos.rs:504` | error | Trusting the certificate from the app is only supported on macOS / Setting the system proxy is only supported on macOS | keep | |
| 12.29 | `proxy-lib/helper.rs:217`, `:222` | error | The helper is only available on macOS | The helper is only supported on macOS | One form for all four. |
| 12.30 | `proxy-lib/terminal.rs:47` | error | Opening a terminal with the proxy set is only supported on macOS so far | Opening a terminal is only supported on macOS | |
| 12.31 | `proxy-lib/ca.rs:73`, `:92`, `proxy-lib/macos.rs:287`, `:300`, `proxy-lib/terminal.rs:36` | error | security exited with {status} / Failed to run {command}: {error} | keep | |
| **Flows and bodies** | | | | | |
| 12.32 | `proxy-lib/lib.rs:3236` | flow error | Rejected the proxy's certificate | Rejected the certificate | See flag D9. |
| 12.33 | `proxy-lib/lib.rs:3226`, `:3229` | flow error | Yaak Proxy stopped before the stream ended / Yaak Proxy stopped before the connection closed | keep | |
| 12.34 | `proxy-lib/lib.rs:3232-3233` | error | Not a request: the client's TLS handshake failed before it sent one | Not a request. The TLS handshake failed. | |
| 12.35 | `proxy-lib/bodies.rs:115` | banner | Failed to decode {encoding} body: {error} | keep | |
| 12.36 | `engine/decode.rs:104` | banner, reason | No output from the deflate body within the capture limit | No output from the deflate body | |
| 12.37 | `engine/decode.rs:135`, `:203` | banner, reason | The gzip header is too long / Not a gzip stream | keep | |
| 12.38 | `proxy-lib/bodies.rs:16` | error toast | A WebSocket has no body after its 101 response. Its frames are its messages. | A WebSocket has no body | Reaches the UI when saving such a body to a file. |
| 12.39 | `proxy-lib/flows.rs:701` | error toast | Failed to clear flows: {error} | keep | |
| 12.40 | `proxy-lib/flows.rs:722` | error | Failed to delete captured traffic: {error} | Failed to clear flows: {error} | |
| 12.41 | `proxy-lib/filter_history.rs:21` | error toast | Failed to {read, record, clear} the filter history: {error} | Failed to {read, record, clear} the search history: {error} | |
| 12.42 | `proxy-lib/lib.rs:2832-2887` | error toast | Failed to create {path}: {error} / Failed to write {path}: {error} | keep | |
| **Saving to Yaak, and settings** | | | | | |
| 12.43 | `proxy-lib/save.rs:73` | banner | Yaak's database was not found at {path}. Install Yaak and open it once. | keep | |
| 12.44 | `proxy-lib/save.rs:79`, `:84`, `:144` | banner | Failed to open Yaak's database: {error} / Failed to save the request to Yaak: {error} | keep | |
| 12.45 | `proxy-lib/save.rs:119-125` | banner | No workspace {id} in Yaak / No folder {id} in Yaak / Folder {id} is not in workspace {id} | keep | |
| 12.46 | `proxy-lib/lib.rs:1489` | banner | Failed to record the saved request on the flow: {error} | keep | |
| 12.47 | `proxy-lib/settings.rs:232-244` | error toast | Invalid settings in {path}: {error} / Failed to read {path}: {error} / Failed to write {path}: {error} | keep | |
| 12.48 | `tauri/lib.rs:134` | error toast | The main window is not open to open Settings over | Failed to open Settings. The main window is closed. | |

Left out as developer-only or never reaching the window: the control API's and the CLI client's errors (`proxy-lib/control.rs`, `proxy-lib/client.rs`), gRPC schema attachment (`proxy-lib/grpc.rs:101-305`), app icon failures (`proxy-lib/attribution.rs`), "No flow {id}" lookups, decrypt-entry parse errors (`engine/decrypt.rs`, the input validates first), and the text the proxy sends back to the proxied app (`engine/request.rs`).

## Flags

### Wrong or misleading as facts

- **F1.** `components/FirstRun.tsx:52` says "Two steps, once." Only the first step is the user's; the second is a wait for flows.
- **F2.** Two strings name macOS on every platform. `components/FirstRun.tsx:142` says "macOS may ask" with no platform check, while `lib/locked.ts` already names Credential Manager and the keyring. `components/SaveDialog.tsx:268` says "on this Mac" in a dialog Windows and Linux also show.
- **F3.** `components/ProxyStatus.tsx:160` says the password is asked "until the helper is approved in Settings". It also shows when the helper is not installed at all, where there is nothing to approve, and "Settings" reads as the app's while the approval is given in System Settings.
- **F4.** "Except Apple services and apps that pin" is fixed text in eight places. It is false once the built-in exclusions are removed (as in your dev app), and it leaves out the user's own exclusions, which apply too. "Except exclusions" is always true.
- **F5.** `lib/encryptedCard.ts:274` shows "Not on the decrypt list" in exactly the case where the list now decrypts the connection; the line under it then says it opened before that.
- **F6.** Keys are fixed to macOS: `components/FlowDetail.tsx:32-36` shows ⌘R and ⌘⇧K where Windows and Linux bind Ctrl+Shift+R and Ctrl+Shift+K (`proxy-lib/actions.rs:40,48`), and `components/SearchBar.tsx:201` shows ⌘F.
- **F7.** `components/HelperDialog.tsx:52` says "Newer macOS calls the list Background App Activity" beside a title that calls it "Allow in the Background". I could not check which name the current macOS uses; the proposal keeps the title's.
- **F8.** `components/TakeOverBanner.tsx:32` and `components/FirstRun.tsx:65` say "Another Yaak Proxy window". The other owner is another running copy of the app, not a window of this one.
- **F9.** `components/FlowInfo.tsx:82` labels a request ID "Saved As", which reads as a name. "Yaak Request ID" would be exact.
- **F10.** `components/FlowListEmpty.tsx:37` reads "Recording on port --" when the port is not known.
- **F11.** The search field `@time` means when a flow started (the Started column), while the Time column is `@duration`. Prose cannot fix that; it needs an alias or a rename.

### Duplicated messages for one event

- **D1.** The take-over strip says where the proxy runs twice: "Running in another Yaak Proxy" then "Another Yaak Proxy window owns the engine" (`components/TakeOverBanner.tsx:20,32`).
- **D2.** A cancelled password prompt is worded in Rust ("Cancelled in the password dialog", `proxy-lib/macos.rs:290`) and reworded in the window by matching on "cancel" ("Cancelled in the password prompt", `lib/systemProxy.ts:40`).
- **D3.** "Yaak picks it up within a second" is in the save dialog's footer and again in its toast (`components/SaveDialog.tsx:106,213`).
- **D4.** "New connections" as a hint and "Applies to new connections" as a tooltip sit on the same input (`components/DecryptListEditor.tsx:92,302`).
- **D5.** "Not running" has three wordings: the pill and row title, "The proxy has not started." under that title (`components/ProxyStatus.tsx:90-93`), and "The proxy is not running." in the list (`components/FlowListEmpty.tsx:34`).
- **D6.** Encrypting older flows is explained four ways (`components/FirstRun.tsx:94`, `components/ProxyStatus.tsx:69`, `components/LockedState.tsx:43`, `proxy-lib/lib.rs:236`).
- **D7.** Paused is explained four ways (`components/ProxyStatus.tsx:84`, `components/FirstRun.tsx:98`, `components/FlowListEmpty.tsx:36` and `:59`).
- **D8.** A truncated body is said eight ways: "Body cut at the capture limit", "Body cut", "First {size} kept", "Showing the first {size} of {size}, the capture limit", "First {size} of {size} kept", "cut at the capture limit", "The message is cut at the capture limit.", "The body was cut at the capture limit" (rows 4.19, 6.6, 6.7, 6.25, 6.27, 8.20, 6.44, 9.24).
- **D9.** "Rejected the proxy's certificate" is built once in Rust as the flow's error and again in the list's tooltip (`proxy-lib/lib.rs:3236`, `components/FlowList.tsx:932`).
- **D10.** Exporting one flow says "Exported the flow as HAR" from the flow's menu and "Exported 1 flow as HAR" from the list's (`lib/flowActions.ts:217,75`).
- **D11.** Copying has five success toasts and four failure toasts (rows 8.11 to 8.14) where Yaak has one of each.
- **D12.** A macOS password prompt in flight reads "Waiting for macOS" for the certificate and "Waiting for your password" for the system proxy (`components/ProxyStatus.tsx:247`, `lib/systemProxy.ts:31`).
- **D13.** "Certificate not trusted" is both a state (pill, strip, warning toast) and the lead of an error toast when trusting fails (`hooks/useDecrypt.tsx:49,123`).

### One thing with two names

- **N1.** flows, traffic, captured traffic, captured data.
- **N2.** search and filter for the header box: "Search flows", "Save search", "Clear search" beside "Recent filters", "No recent filters" and Rust's "filter history".
- **N3.** Time (column), Total (Info tab), Total time (search help). Latency (column), Headers (Info tab).
- **N4.** domain and site: the sidebar's "Domains" beside the Choose menu's "Sites", "Decrypt 3 Sites" and "Host or *.site".
- **N5.** app, program, client: "App or program", "A client rejected the certificate", "Cancelled by the client" beside "Cancelled by the app".
- **N6.** "Clear Sorting" in a column's menu and "Reset Sort" in the columns menu, for the same action.
- **N7.** "Override system proxy", "Turn on the system proxy", "System proxy on", "Routing".
- **N8.** "built-in exclusions", "Apple services and apps that pin", "Excluded by default".
- **N9.** "the CLI" and "the yaak CLI".
- **N10.** "Retry" and "Try Again".
- **N11.** rejected and refused ("macOS may refuse it").
- **N12.** The helper is Installed by its button, Unregistered by the opposite button, "removed" in that button's error, and "Enabled" as a state.
- **N13.** "password prompt" and "password dialog".
- **N14.** "Reveal", "Reveal in Finder", and "Failed to show" for the same action; "Show in Folder" where Yaak says "Show in File Manager".
- **N15.** "Working folder" (search help), "Directory" (Info tab).
- **N16.** inflate, decompress and decode for a compressed message.
- **N17.** "the capture limit" names a per-body limit Settings never shows, while Settings has a "Size limit" that is a different limit.
- **N18.** "Export HAR" and "Export as HAR".
- **N19.** "Certificate", "Yaak Proxy CA", "the proxy's certificate".
- **N20.** Passed through, not on the decrypt list, encrypted: three ways to say a connection was not decrypted.

