# Yaak Proxy prose pass, round one (revised)

Read-only proposal. Nothing in the source has changed. Strike or edit rows by their number (for example "drop 2.14", "4.7: use X instead"), then round two applies what is left. `PROSE-changes.md` beside this file lists only the rows with a proposed change.

The table has 409 rows holding about 645 strings (a row with " / " holds the variants of one string). About 207 strings in 188 rows have a proposed change; the rest are "keep", 12 of them your own wording. Twelve rows carry tooltip text. Five visible strings stay over ten words: 4.33 (Yaak's own sentence), 9.31 (kept as asked), 12.4 (an instruction naming the app and the place), and the errors 12.28 and 12.43.

Order of this file: the table, the terminology decisions, the flags, then the voice guide.

Three rules shape the Proposed column. A label (button, menu item, heading, tab, select option, icon-button tooltip, state name) stays short. Anything that explains (a description, a status line, a card line, a hint, a dialog body) is a complete sentence with a subject and a period. And an explanation that is always visible is one sentence of about ten words, modelled in voice and length on "Traffic from every app will be recorded."

The Tooltip column holds detail someone would need that does not fit that sentence: text for a small info icon beside the line, as the encrypted card's why line has. It is empty for most rows. A visible line that only repeats its title or state name is dropped.

## The table

Paths: `components/`, `lib/` and `hooks/` are under `apps/yaak-proxy/`. `ui/` is `packages/ui/src/components/`. `proxy-lib/` is `crates-proxy/yaak-proxy-lib/src/`. `engine/` is `crates/yaak-proxy/src/`. `tauri/` is `crates-tauri/yaak-app-proxy/src/`. `{braces}` mark a value filled in at run time. A row with " / " holds the variants of one string.

### 1. First-run setup

| # | Where | What | Current | Proposed | Tooltip | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 1.1 | `components/FirstRun.tsx:49` | heading | Set up Yaak Proxy | keep | | |
| 1.2 | `components/FirstRun.tsx:52` | description | Two steps, once. Then every app on this Mac sends its traffic here. | Traffic from every app on this Mac will be recorded. | | Only one step is the user's. See flag F1. |
| 1.3 | `components/FirstRun.tsx:53` | description | Traffic appears here as apps send it. | keep | | Shown where the system proxy is unsupported. |
| 1.4 | `components/FirstRun.tsx:60` | step title | Turn on the system proxy | Override system proxy | | One name for the switch. |
| 1.5 | `components/FirstRun.tsx:60` | step title, done | System proxy on | System proxy overridden | | |
| 1.6 | `components/FirstRun.tsx:64` | step description | The CLI owns the proxy. Take over to turn this on from here. | Take over from the CLI to change this. | | The strip above already says where the proxy runs. |
| 1.7 | `components/FirstRun.tsx:65` | step description | Another Yaak Proxy window owns the engine. Quit it to use this one. | Quit the other Yaak Proxy to use this one. | | See flag F8. |
| 1.8 | `components/FirstRun.tsx:76` | button | Turn On | Enable | | Yaak says "Enable" for switches. |
| 1.9 | `components/FirstRun.tsx:76` | button | Try Again | Retry | | |
| 1.10 | `components/FirstRun.tsx:87` | step title | Encrypting stored traffic, {percent} | Encrypting recorded traffic, {percent} | | Same string as 2.9 and 12.1. |
| 1.11 | `components/FirstRun.tsx:89` | step title | Waiting for traffic | keep | | |
| 1.12 | `components/FirstRun.tsx:90` | step title | See traffic | keep | | |
| 1.13 | `components/FirstRun.tsx:94` | step description | Traffic captured before this version is being encrypted on disk. Recording starts when it's done. | Recording will start once encryption finishes. | | The first sentence repeats the title. Same string as 2.10. |
| 1.14 | `components/FirstRun.tsx:96` | error | The proxy has not started. | The proxy failed to start. | | Fallback when there is no reason. Same as 2.17. |
| 1.15 | `components/FirstRun.tsx:98` | step description | Recording is paused, so traffic passes through without being stored. | Recording is paused. | | The button beside it is Resume Recording. |
| 1.16 | `components/FirstRun.tsx:100` | step description | Open a website or send a request, and its flow appears here. | Open a website or send a request to begin. | | |
| 1.17 | `components/FirstRun.tsx:101` | step description | Flows appear here as apps send requests. | keep | | |
| 1.18 | `components/FirstRun.tsx:111` | button | Retry | keep | | |
| 1.19 | `components/FirstRun.tsx:119` | button | Resume Recording | keep | | |
| 1.20 | `components/FirstRun.tsx:126` | description | Only need one terminal or one app? Copy the environment instead. | To proxy a single terminal instead, copy the environment. | | The question is cut. |
| 1.21 | `components/FirstRun.tsx:134` | button | Copy Environment | keep | | |
| 1.22 | `components/FirstRun.tsx:138` | description | Working with an agent? `yaak mcp` gives it the proxy's flows and actions. | Agents can connect through `yaak mcp`. | | The question is cut. |
| 1.23 | `components/FirstRun.tsx:142` | description | Captured traffic is encrypted on disk with a key kept in your keychain, so macOS may ask to let Yaak Proxy use it. | Recorded traffic is encrypted on disk. | The key is kept in the system keychain, so the system may ask to let Yaak Proxy use it. | The keychain prompt is the detail someone needs. "macOS" showed on every platform; see flag F2. |

### 2. Header and status menu

| # | Where | What | Current | Proposed | Tooltip | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 2.1 | `components/ProxyLayout.tsx:82`, `:154` | tooltip | Toggle sidebar | keep | | Same as Yaak's. |
| 2.2 | `components/ProxyLayout.tsx:106` | tooltip | Change to vertical layout / Change to horizontal layout | keep | | Same as Yaak's. |
| 2.3 | `components/ProxyLayout.tsx:117` | tooltip | Settings | keep | | |
| 2.4 | `components/ClearFlowsButton.tsx:52` | tooltip, disabled | Clear flows (traffic is locked) | Clear flows | | The locked state is on screen. |
| 2.5 | `components/ClearFlowsButton.tsx:54` | tooltip, disabled | Clear flows (none yet) | Clear flows | | |
| 2.6 | `components/ClearFlowsButton.tsx:56-57` | tooltip | Clear flows / Clear flows {hotkey} | keep | | |
| 2.7 | `components/ProxyStatus.tsx:190-206` | status pill | Encrypting / CLI / Recording / Paused / Not running | keep | | |
| 2.8 | `components/ProxyStatus.tsx:126` | menu item, right | Copied | keep | | |
| 2.9 | `components/ProxyStatus.tsx:68` | menu row title | Encrypting stored traffic, {percent} | Encrypting recorded traffic, {percent} | | |
| 2.10 | `components/ProxyStatus.tsx:69` | menu row description | Traffic captured before this version is being encrypted on disk. Recording starts when it's done. | Recording will start once encryption finishes. | | The first sentence repeats the title. |
| 2.11 | `components/ProxyStatus.tsx:74` | menu row title | Running from the CLI | keep | | |
| 2.12 | `components/ProxyStatus.tsx:75` | menu row description | Started by yaak proxy start, pid {pid}, since {time}. Port {port}. | The proxy was started by the CLI at {time}. | | The port is the menu's first item, and the pid is on the strip, 2.36. |
| 2.13 | `components/ProxyStatus.tsx:80` | menu row title | Recording on port {port} / Paused on port {port} | keep | | |
| 2.14 | `components/ProxyStatus.tsx:83` | menu row description | Every flow is stored as it passes. | (remove) | | It repeats "Recording" in the title above it. Needs the row to allow no description. |
| 2.15 | `components/ProxyStatus.tsx:84` | menu row description | Traffic passes through untouched, and nothing is stored. | Traffic passes through without being recorded. | | The same sentence as 4.30. |
| 2.16 | `components/ProxyStatus.tsx:90` | menu row title | Not running | keep | | |
| 2.17 | `components/ProxyStatus.tsx:93` | error | The proxy has not started. | The proxy failed to start. | | |
| 2.18 | `components/ProxyStatus.tsx:106` | button | Retry | keep | | |
| 2.19 | `lib/systemProxy.ts:134` | menu item | Pause Recording / Resume Recording | keep | | |
| 2.20 | `components/ProxyStatus.tsx:152`, `:168` | menu row title | Override system proxy | keep | | |
| 2.21 | `lib/systemProxy.ts:47` | menu row description, on | Routing this Mac's web traffic through Yaak Proxy | Traffic from every app will be recorded. | | The model sentence. |
| 2.22 | `lib/systemProxy.ts:48` | menu row description, off | Not routing. Only apps pointed at port {port} are captured | Only traffic sent to port {port} will be recorded. | | |
| 2.23 | `lib/systemProxy.ts:31` | menu row description, pending | Changing the system proxy | keep | | A progress label, as Yaak's "Cloning...". |
| 2.24 | `lib/systemProxy.ts:31` | menu row description, pending | Waiting for your password | Waiting for macOS | | The same progress label as 2.29. |
| 2.25 | `lib/systemProxy.ts:40` | error | Cancelled in the password prompt | The password prompt was cancelled. | | See flag D2. |
| 2.26 | `components/ProxyStatus.tsx:160` | notice | macOS asks for your password each time until the helper is approved in Settings. | macOS will ask for a password each time. | Install the helper in Settings to stop the prompts. | See flag F3. |
| 2.27 | `components/ProxyStatus.tsx:235`, `:256`, `:267` | menu row title | Decrypt everything | keep | | A row title, so sentence case; the button is "Decrypt Everything". |
| 2.28 | `components/ProxyStatus.tsx:215`, `:236` | pill and description | Certificate not trusted | keep | | A state name. |
| 2.29 | `components/ProxyStatus.tsx:247`, `:259` | button and description | Waiting for macOS / Trust | keep | | |
| 2.30 | `components/ProxyStatus.tsx:261` | menu row description, on | Except Apple services and apps that pin | Excluded hosts and apps stay encrypted. | | See flag F4. |
| 2.31 | `components/ProxyStatus.tsx:262`, `lib/decrypt.ts:226-227` | menu row description, off | {n} apps, {n} hosts | keep | | A count. |
| 2.32 | `components/ProxyStatus.tsx:262` | menu row description, off | Nothing listed | No hosts or apps | | An empty-state label beside the count, 2.31. Same as 10.34. |
| 2.33 | `components/TakeOverBanner.tsx:20` | banner | Running from the CLI / Running in another Yaak Proxy | keep | | |
| 2.34 | `components/TakeOverBanner.tsx:27` | banner, code | yaak proxy start | keep | | |
| 2.35 | `components/TakeOverBanner.tsx:32` | banner | Another Yaak Proxy window owns the engine. Quit it to use this one. | Quit the other copy to use this one. | | The lead beside it already says where the proxy runs. See flag D1. |
| 2.36 | `components/TakeOverBanner.tsx:36` | banner | pid {pid}, since {time}. Flows still list here, read from the capture database. | pid {pid}, since {time} | | Metadata, so a fragment. The list below already shows that its traffic is listed. |
| 2.37 | `components/TakeOverBanner.tsx:47` | button | Take over | Take Over | | |
| 2.38 | `components/HttpsStrip.tsx:58` | banner | Certificate not trusted | keep | | |
| 2.39 | `components/HttpsStrip.tsx:59` | banner | Required to decrypt | The certificate must be trusted to decrypt traffic. | | |
| 2.40 | `components/HttpsStrip.tsx:67` | button | Waiting for macOS / Trust | keep | | |
| 2.41 | `components/HttpsStrip.tsx:120` | banner | HTTPS is encrypted | keep | | |
| 2.42 | `lib/httpsStrip.ts:47` | banner count | {n} connection / {n} connections | keep | | |
| 2.43 | `components/HttpsStrip.tsx:127` | tooltip | New connections, except Apple services and apps that pin | New connections will be decrypted, except for excluded hosts and apps. | | On a text button, so it explains. |
| 2.44 | `components/HttpsStrip.tsx:143` | button | Decrypt Everything | keep (user's wording) | | |
| 2.45 | `components/HttpsStrip.tsx:148` | button | Choose… | Choose | | No ellipsis on a button that opens a menu. |
| 2.46 | `components/HttpsStrip.tsx:74` | menu heading | Apps | keep | | |
| 2.47 | `components/HttpsStrip.tsx:96` | menu heading | Sites | Domains | | |
| 2.48 | `components/HttpsStrip.tsx:112` | menu item | Edit List in Settings… | Decryption Settings | | As Yaak's "Workspace Settings". |
| 2.49 | `components/HttpsStrip.tsx:155` | tooltip | Not now | Dismiss | | As Yaak's toast and banner. |

### 3. Search box and search history

| # | Where | What | Current | Proposed | Tooltip | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 3.1 | `components/SearchBar.tsx:527-528` | placeholder | Search flows / Search {n} flows | keep | | |
| 3.2 | `components/SearchBar.tsx:175` | placeholder, locked | Traffic is locked | keep | | |
| 3.3 | `components/SearchBar.tsx:208` | menu item | Save search | Save Search | | |
| 3.4 | `lib/flowActions.ts:97` | menu item | Export All Flows as HAR / Export Matching Flows as HAR | keep | | |
| 3.5 | `components/SearchBar.tsx:222` | tooltip | Search actions | keep | | |
| 3.6 | `components/SearchBar.tsx:230` | tooltip | Clear search | keep | | |
| 3.7 | `components/SearchBar.tsx:314` | tooltip | Recent filters | Recent searches | | |
| 3.8 | `components/SearchBar.tsx:278` | menu item, empty | No recent filters | No recent searches | | As Yaak's "No recent requests". |
| 3.9 | `components/SearchBar.tsx:290` | tooltip | Save search | keep | | |
| 3.10 | `components/SearchBar.tsx:296` | tooltip | Remove | keep | | |
| 3.11 | `components/SearchBar.tsx:303` | menu item | Clear History | keep | | |
| 3.12 | `components/SearchBar.tsx:327` | completion detail | Recent | keep | | |
| 3.13 | `lib/searchBox.ts:42-43` | lint label | Unknown field / Invalid value | keep | | |
| 3.14 | `lib/searchBox.ts:44` | lint label | Not yet | Not supported | | |
| 3.15 | `proxy-lib/query.rs:86` | completion info | Host, wildcards allowed | keep | | |
| 3.16 | `proxy-lib/query.rs:87` | completion info | URL path, /* for below | keep | | |
| 3.17 | `proxy-lib/query.rs:88` | completion info | GET, POST, … | keep | | |
| 3.18 | `proxy-lib/query.rs:89-90` | completion info | Response status / Content type | keep | | |
| 3.19 | `proxy-lib/query.rs:91` | completion info | App or program | App | | |
| 3.20 | `proxy-lib/query.rs:95` | completion info | error, pending, system, encrypted, rejected, … | keep | | A list of its values. |
| 3.21 | `proxy-lib/query.rs:98` | completion info | A header on either side | A request or response header | | |
| 3.22 | `proxy-lib/query.rs:99-100` | completion info | A request header / A response header | keep | | |
| 3.23 | `proxy-lib/query.rs:101-103` | completion info | Response body size / Request body size / Response body size | keep | | |
| 3.24 | `proxy-lib/query.rs:104` | completion info | Total time | keep | | See flag N3. |
| 3.25 | `proxy-lib/query.rs:105` | completion info | When the flow started | keep | | |
| 3.26 | `proxy-lib/query.rs:106` | completion info | The whole URL | keep | | |
| 3.27 | `proxy-lib/query.rs:107` | completion info | A query parameter | keep | | |
| 3.28 | `proxy-lib/query.rs:108-111` | completion info | http or https / Port / h1, h2, ws, sse, grpc / Flow number | keep | | |
| 3.29 | `proxy-lib/query.rs:112` | completion info | Working folder | Working directory | | The Info tab says "Directory". |
| 3.30 | `proxy-lib/query.rs:113` | completion info | Process id | Process ID | | |
| 3.31 | `proxy-lib/query.rs:117-121` | completion info | GraphQL operation name / gRPC service / gRPC method | keep | | |
| 3.32 | `proxy-lib/query.rs:122-124` | completion info | Not yet | Not supported | | |
| 3.33 | `components/AddColumnDialog.tsx:105`, `:110` | input label and placeholder | Field / @header.x-request-id | keep | | The dialog itself is 9.9. |
| 3.34 | `lib/columns.ts:107-110` | validation | Missing name / Invalid name / Incomplete / Unknown field | keep | | |

### 4. Flow list and its menus

| # | Where | What | Current | Proposed | Tooltip | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 4.1 | `lib/columns.ts:66-82` | column headers | App, Method, Host, Path, Query, Status, Type, Request Size, Size, Time, Latency, Started, Remote Address, HTTP Version, TLS Version, Operation | keep | | See flag N3 for Time and Latency. |
| 4.2 | `components/FlowListHeader.tsx:133`, `:251` | menu heading and tooltip | Columns | keep | | |
| 4.3 | `components/FlowListHeader.tsx:152`, `:208` | menu item | Remove Column | keep | | |
| 4.4 | `components/FlowListHeader.tsx:162` | menu item | Add Column… | Add Column | | |
| 4.5 | `components/FlowListHeader.tsx:164` | menu item | Reset Sort | keep (user's wording) | | |
| 4.6 | `components/FlowListHeader.tsx:165`, `:215` | menu item | Reset Column Widths | keep | | |
| 4.7 | `components/FlowListHeader.tsx:167` | menu item | Reset Column Order | keep | | |
| 4.8 | `components/FlowListHeader.tsx:178-181` | menu item | Sort Ascending / Sort Descending / Add to Sort Ascending / Add to Sort Descending | keep | | |
| 4.9 | `components/FlowListHeader.tsx:182` | menu item | Clear Sorting | Reset Sort | | The same action as 4.5. |
| 4.10 | `components/FlowListHeader.tsx:185`, `:190` | menu item | Move Left / Move Right | keep | | |
| 4.11 | `components/FlowListHeader.tsx:196`, `:201` | menu item | Hide Column / Hide Other Columns | keep | | |
| 4.12 | `components/FlowList.tsx:531` | divider | {n} new | keep | | |
| 4.13 | `components/FlowList.tsx:551` | button | 1 new flow / {n} new flows | keep | | |
| 4.14 | `components/FlowList.tsx:914-915` | tooltip | Encrypted: excluded by default / Encrypted: excluded by {entry} | keep | | |
| 4.15 | `components/FlowList.tsx:917` | tooltip | Encrypted: passed through after a client rejected the certificate | Encrypted: an app rejected the certificate | | |
| 4.16 | `components/FlowList.tsx:919` | tooltip | Encrypted: not on the decrypt list | Encrypted: decryption is not enabled | | Follows your card line. |
| 4.17 | `components/FlowList.tsx:932` | tooltip | Rejected the proxy's certificate | Certificate rejected by the app | | Parallel to "Cancelled by the app". Same as 12.32. |
| 4.18 | `components/FlowList.tsx:933-936` | tooltip | Failed: {error} / Cancelled by the app / Streaming | keep | | |
| 4.19 | `components/FlowList.tsx:937` | tooltip | Body cut at the capture limit | Body truncated at the capture limit | | |
| 4.20 | `components/FlowList.tsx:938` | tooltip | Saved to Yaak | keep | | |
| 4.21 | `components/FlowList.tsx:1109`, `:1209` | cell | Rejected certificate / Cancelled | keep | | |
| 4.22 | `components/FlowList.tsx:1361-1367` | menu item | Filter by This Value / Exclude This Value / Copy Value | keep (user's wording) | | |
| 4.23 | `lib/flowActions.ts:148` | menu item | Save as Yaak Request / Save to Yaak Again | keep | | |
| 4.24 | `lib/flowActions.ts:155-193` | menu item | Copy as cURL / Copy URL / Copy Request Body / Copy Response Body | keep | | |
| 4.25 | `lib/flowActions.ts:200`, `:206` | menu item | Save Request Body to File / Save Response Body to File | keep | | |
| 4.26 | `lib/flowActions.ts:212` | menu item | Export HAR | Export as HAR | | As "Export All Flows as HAR". |
| 4.27 | `components/FlowListEmpty.tsx:31` | empty state | No flows yet | keep | | |
| 4.28 | `components/FlowListEmpty.tsx:31` | empty state | Recording is paused | keep | | |
| 4.29 | `components/FlowListEmpty.tsx:34` | empty state | The proxy is not running. Retry from the menu by the state. | Retry from the status menu to start the proxy. | | |
| 4.30 | `components/FlowListEmpty.tsx:36` | empty state | Traffic passes through without being stored. | Traffic passes through without being recorded. | | |
| 4.31 | `components/FlowListEmpty.tsx:37` | empty state | Recording on port {port}. Flows appear as apps send requests. | Traffic sent to port {port} will be recorded. | | See flag F10. |
| 4.32 | `components/FlowListEmpty.tsx:59-60` | list row | Paused at {time}. Traffic passes through without being stored. | Recording was paused at {time}. | | Without a time: "Recording is paused." The rest is in the status menu, 2.15. |
| 4.33 | `components/FlowListEmpty.tsx:105-106` | empty state | No flows match. Found matches for {query} ({n}), or {query} ({n}) | No results, but found matches for {query} ({n}) or {query} ({n}) | | Yaak's sidebar wording, word for word. Alone: "No results". |
| 4.34 | `components/FlowListEmpty.tsx:111` | empty state, code | all traffic | keep | | |

### 5. Sidebar and its menus

| # | Where | What | Current | Proposed | Tooltip | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 5.1 | `lib/sidebarTree.ts:350` | row | All traffic | All Traffic | | The menu item that names it is "Show in All Traffic". |
| 5.2 | `lib/sidebarTree.ts:357`, `:301-303`, `:395` | rows | Saved / Apps / Domains / System / Encrypted | keep | | |
| 5.3 | `components/Sidebar.tsx:103` | tooltip | Encrypted | keep | | |
| 5.4 | `components/Sidebar.tsx:198-201` | menu item | Filter by This Value / Exclude This Value / Copy Value | keep (user's wording) | | |
| 5.5 | `lib/decrypt.ts:395` | menu item | Decrypt {name} / Stop Decrypting {name} | keep | | |
| 5.6 | `lib/decrypt.ts:425-427` | menu item, several rows | Decrypt {n} Apps / {n} Hosts / {n} Sites / {n} Selected | Decrypt {n} Apps / {n} Hosts / {n} Domains / {n} Selected | | Also in its toast, lower case. |
| 5.7 | `lib/opener.ts:26-27` | menu item | Reveal in Finder / Show in Explorer | keep | | |
| 5.8 | `lib/opener.ts:28` | menu item | Show in Folder | Show in File Manager | | Yaak's name on Linux. Also the Settings button, 10.3. |
| 5.9 | `components/Sidebar.tsx:178` | menu item | Copy path | Copy Path | | |
| 5.10 | `components/Sidebar.tsx:225`, `:248` | menu item | Show in All Traffic | keep | | |
| 5.11 | `components/Sidebar.tsx:235` | menu item | Decrypt Everything | keep (user's wording) | | |
| 5.12 | `components/Sidebar.tsx:261`, `:270` | menu item | Rename / Delete | keep | | |

### 6. Detail card and its tabs

| # | Where | What | Current | Proposed | Tooltip | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 6.1 | `components/FlowDetail.tsx:31-35` | empty state | Select a flow / Pause or resume recording / Clear flows | keep | | The keys beside them are fixed to macOS. See flag F6. |
| 6.2 | `components/FlowCard.tsx:144`, `:153`, `:225` | tab | Cookies / Info / Body | keep | | |
| 6.3 | `lib/messages.ts:124` | tab | Events / Messages | keep | | |
| 6.4 | `lib/flowViews.ts:240-248` | tab | Auth / Basic / Bearer / Digest / Negotiate | keep | | |
| 6.5 | `components/FlowCard.tsx:308` | empty state | Waiting for a response | keep | | |
| 6.6 | `components/FlowCard.tsx:326` | badge | Body cut | Body truncated | | |
| 6.7 | `components/FlowCard.tsx:326` | badge | First {size} kept | First {size} recorded | | |
| 6.8 | `components/FlowCard.tsx:336` | tooltip | Save to Yaak / Saved to Yaak | keep | | |
| 6.9 | `components/FlowCard.tsx:341`, `components/EncryptedCard.tsx:298` | tooltip | Actions | keep | | |
| 6.10 | `lib/flowViews.ts:122` | error | Cancelled by the client | Cancelled by the app | | The list says "app" (4.18). |
| 6.11 | `components/FlowInfo.tsx:31-72` | section heading | Connection / App / Timing / Size | keep | | |
| 6.12 | `components/FlowInfo.tsx:78` | section heading | Record | Flow | | "Record" is the app's verb. |
| 6.13 | `components/FlowInfo.tsx:33-38` | row label | Remote Address / Client Version / Server Version / TLS / Cipher / Client Port | keep | | Client and Server as the two HTTP sides. |
| 6.14 | `components/FlowInfo.tsx:45-58` | row label | Name / Bundle ID / Path / PID / Directory | keep | | |
| 6.15 | `components/FlowInfo.tsx:65` | row label | Started | keep | | |
| 6.16 | `components/FlowInfo.tsx:68` | row label | Headers | Latency | | The column's name. See flag N3. |
| 6.17 | `components/FlowInfo.tsx:69` | row label | Total | Time | | The column's name. |
| 6.18 | `components/FlowInfo.tsx:74-81` | row label | Request / Response / Number / ID | keep | | |
| 6.18a | `components/FlowInfo.tsx:82` | row label | Saved As | Yaak Request ID | | Its value is an ID, not a name. See flag F9. |
| 6.19 | `components/FlowInfo.tsx:103` | section heading | Timeline | keep | | |
| 6.20 | `lib/phases.ts:37-58` | timeline step | Started / Connected / TLS handshake / Request sent / Headers received, {status} / Failed / Cancelled / Body received / Closed | keep | | |
| 6.21 | `lib/body.ts:222-247` | tab badge | GraphQL / Binary / Multipart / Form / Image / Audio / Video / Font / Markdown / Protobuf / Text | keep | | |
| 6.22 | `lib/body.ts:44` | empty state | No body. See Messages. | keep | | |
| 6.23 | `lib/body.ts:45` | empty state | No request body / Empty | keep | | Same as Yaak's panes. |
| 6.24 | `components/FlowBodyViewer.tsx:241` | banner | {error}. Showing the body as it was on the wire. | {error}. The body is shown as it was received. | | The view switch calls this "As received". |
| 6.25 | `components/FlowBodyViewer.tsx:247` | banner | Showing the first {size} of {size}, the capture limit. The app received all of it. | The first {size} of {size} is shown. | The body was truncated at the capture limit. The app received all of it. | |
| 6.26 | `components/FlowBodyViewer.tsx:248` | banner | Showing the first {size} of the decoded body, the capture limit. The app received all of it. | The first {size} of the decoded body is shown. | The body was truncated at the capture limit. The app received all of it. | |
| 6.27 | `components/FlowRequestBody.tsx:47` | banner | First {size} of {size} kept | The first {size} of {size} is shown. | The body was truncated at the capture limit. The app sent all of it. | The same fact as 6.25, so the same sentence. Its tooltip replaces 6.28. |
| 6.28 | `components/FlowRequestBody.tsx:45` | tooltip | The app sent all of it | (remove, replaced by 6.27's tooltip) | | Today the tooltip is on the text itself; it moves to an info icon. |
| 6.29 | `components/FlowBodyViewer.tsx:276-277` | label | Binary body, {size}, first {size} shown | keep | | As Yaak's "Binary body, {size}". |
| 6.30 | `components/FlowBodyViewer.tsx:285` | button | Save to File | keep | | |
| 6.31 | `ui/http/BodyViewModeSwitch.tsx:10-17` | switch labels | Pretty / Table / Parts / Preview / Form / Raw | keep | | Proxy only. |
| 6.32 | `ui/http/BodyViewModeSwitch.tsx:10-17` | tooltip | Formatted / As a table / Split into parts / Rendered / As fields / As received | keep | | |
| 6.33 | `ui/http/ResponseCookies.tsx:123`, `:149`, `:173`, `:227` | headings and empty state | Sent Cookies / Received Cookies / Deleted / No Cookies | keep | | Proxy only. |
| 6.34 | `components/FlowMessages.tsx:15-33` | column headers | Type / Message / Event / Data | keep | | |
| 6.35 | `components/FlowMessages.tsx:52` | button | {n} new messages / {n} new events | keep | | |
| 6.36 | `components/FlowMessages.tsx:94-98` | status | CONNECTED / ERROR / CLOSED | keep | | As Yaak's WebSocket pane. |
| 6.37 | `components/FlowMessages.tsx:104` | count | {n} Messages / {n} Events | keep | | |
| 6.38 | `components/FlowMessages.tsx:123` | empty state | Waiting for the first message / Waiting for the first event | keep | | |
| 6.39 | `components/FlowMessages.tsx:123` | empty state | No Messages / No Events | No messages / No events | | Sentence case, as Yaak's majority. |
| 6.40 | `components/FlowMessages.tsx:79-81` | view options | Decoded / Schemaless / Raw bytes | keep | | |
| 6.41 | `components/FlowMessages.tsx:71` | note | Decoded as {type} | keep | | |
| 6.42 | `lib/messages.ts:38`, `:46` | note | No status / No status code | keep | | |
| 6.43 | `lib/messages.ts:66-82` | detail title | Event Received / Closed by the App / Closed by the Server / Ping / Pong / Call Status | keep | | |
| 6.44 | `ui/events/EventStreamViewer.tsx:484` | banner | The message is cut at the capture limit. | The message was truncated at the capture limit. | | |
| 6.45 | `proxy-lib/grpc.rs:370-388` | note | No schema for {service} on {host} | keep | | |
| 6.46 | `proxy-lib/grpc.rs:390` | note | No schema for {service}; reflection failed: {error} | No schema for {service}. Reflection failed: {error} | | No semicolons. |
| 6.47 | `proxy-lib/grpc.rs:454` | note | Did not decode as {type}: {error} | Failed to decode as {type}: {error} | | Yaak's error form. |
| 6.48 | `engine/grpc.rs:187` | message error | The body ended partway through this message, {n} of its {n} bytes in | The body ended after {n} of this message's {n} bytes. | | |
| 6.49 | `engine/grpc.rs:229`, `:240` | message error | Compressed with {encoding}, not decoded / Too large to decompress | keep | | |
| 6.50 | `engine/grpc.rs:241`, `engine/ws.rs:351`, `:399` | message error | Failed to decompress the message: {error} / Failed to inflate the message: {error} | Failed to decompress the message: {error} | | Two words for one failure. |
| 6.51 | `engine/ws.rs:357` | message error | Not inflated: an earlier message failed to, which lost the context | This message was not decompressed because an earlier one failed. | | |

### 7. Encrypted and rejected cards

| # | Where | What | Current | Proposed | Tooltip | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 7.1 | `components/EncryptedCard.tsx:278` | status | ENCRYPTED / REJECTED | keep | | |
| 7.2 | `components/EncryptedCard.tsx:282` | status | open {duration} | keep | | |
| 7.3 | `lib/encryptedCard.ts:276-278` | why line | **Encrypted Content:** Enable decryption to see requests to {host} | keep (user's wording) | | |
| 7.4 | `lib/encryptedCard.ts:272` | why line | Nothing is decrypted yet | **Encrypted Content:** Enable decryption to see requests to {host} | | The same case and buttons as 7.3, so the same line. |
| 7.5 | `lib/encryptedCard.ts:274` | why line | Not on the decrypt list | This connection was opened before {entry} was decrypted. | | Shown when the list does decrypt it now. Takes in 7.6. See flag F5. |
| 7.6 | `lib/encryptedCard.ts:177` | fact line | Opened before {entry} was decrypted / Opened before everything was decrypted | (remove, merged into 7.5) | | Needs the two lines merged. |
| 7.7 | `lib/encryptedCard.ts:266`, `:268` | why line | Excluded by default / Excluded by {entry} | This connection is excluded by default. / This connection is excluded by {entry}. | | The first gives way to 7.8 when the kind is known. |
| 7.8 | `lib/encryptedCard.ts:265` | why line, after | Apple service / pins its certificate | Apple services are excluded by default. / Apps that pin certificates are excluded by default. | | Replaces 7.7's first sentence when the kind is known, so one sentence shows. Needs the two parts merged. |
| 7.9 | `components/EncryptedCard.tsx:178` | tooltip | HTTPS is encrypted between the app and the server. Yaak Proxy shows requests only for hosts and apps you decrypt, from their next connection on. | keep | | |
| 7.10 | `lib/encryptedCard.ts:292`, `:304` | button | Decrypt {name} / Stop Decrypting {name} | keep | | |
| 7.11 | `lib/encryptedCard.ts:209` | button | Decrypt Everything | keep (user's wording) | | |
| 7.12 | `lib/encryptedCard.ts:226-227` | button | Stop Excluding {name} / Stop Excluding {n} Entries | keep | | |
| 7.13 | `lib/encryptedCard.ts:168` | button | Reconnect | keep | | |
| 7.14 | `components/EncryptedCard.tsx:150` | button | Waiting for macOS | keep | | |
| 7.15 | `lib/encryptedCard.ts:197` | foot | macOS may refuse it / {app} may refuse it | macOS may reject the connection. / {app} may reject the connection. | | |
| 7.16 | `lib/encryptedCard.ts:240` | foot | Asks for your password once | macOS will ask for a password once. | | |
| 7.17 | `lib/encryptedCard.ts:379` | why line | Certificate not trusted | The certificate is not trusted. | | A sentence here; the pill and strip keep the state name. |
| 7.18 | `lib/encryptedCard.ts:383` | button | Trust Certificate | keep | | |
| 7.19 | `lib/encryptedCard.ts:394`, `:415` | why line | {app} rejected the certificate / {app} rejected the certificate for this host | {app} rejected the certificate. / {app} rejected the certificate for this host. | | |
| 7.20 | `lib/encryptedCard.ts:416` | why line | A client rejected the certificate | An app rejected the certificate. | | |
| 7.21 | `lib/encryptedCard.ts:395`, `:418` | why line, after | uses its own trust store / likely pinned | (remove, moved to the tooltip) | {app} uses its own trust store, so it does not trust the certificate. / {app} likely pins its certificate, so it cannot be decrypted. | The why line, 7.19, stays one sentence. On these cards this replaces the general tooltip, 7.9. |
| 7.22 | `lib/encryptedCard.ts:400-401` | button and hint | Copy Environment / SSL_CERT_FILE, … | keep | | |
| 7.23 | `lib/encryptedCard.ts:373` | button and hint | Try Again / next connection | Retry / next connection | | |
| 7.24 | `lib/encryptedCard.ts:408` | foot | Then rerun {app} | Paste it into a terminal, then rerun {app}. | | |
| 7.25 | `lib/encryptedCard.ts:386` | foot | Passed through until trusted | This host stays encrypted until the certificate is trusted. | | |
| 7.26 | `lib/encryptedCard.ts:424` | foot | Passed through until relaunch | This host stays encrypted until Yaak Proxy is relaunched. | | See flag F12. |
| 7.27 | `lib/encryptedCard.ts:374` | foot | No longer passed through | The next connection will be decrypted. | | |

### 8. Toasts

A toast's first line is a label and stays a fragment, as Yaak's "Copied to clipboard". Its second line explains, so it is a sentence.

| # | Where | What | Current | Proposed | Tooltip | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 8.1 | `components/ProxyStatus.tsx:276`, `components/HttpsStrip.tsx:138`, `components/Sidebar.tsx:241`, `lib/encryptedCard.ts:212`, `components/DecryptListEditor.tsx:84` | toast | Decrypting everything | keep | | |
| 8.2 | `components/ProxyStatus.tsx:277`, `components/HttpsStrip.tsx:139`, `components/Sidebar.tsx:242`, `lib/encryptedCard.ts:212`, `components/DecryptListEditor.tsx:85` | toast, second line | Except Apple services and apps that pin | Excluded hosts and apps stay encrypted. | | See flag F4. |
| 8.3 | `components/ProxyStatus.tsx:279`, `components/DecryptListEditor.tsx:84` | toast | Stopped decrypting everything | keep | | |
| 8.4 | `components/HttpsStrip.tsx:92`, `:106`, `components/Sidebar.tsx:303`, `lib/encryptedCard.ts:295`, `:308`, `components/DecryptListEditor.tsx:70`, `:103` | toast | Decrypting {name} / Stopped decrypting {name} | keep | | |
| 8.5 | `components/DecryptListEditor.tsx:69`, `:102`, `lib/encryptedCard.ts:234` | toast | Excluding {name} / Stopped excluding {name} | keep | | |
| 8.6 | `lib/decryptChoice.ts:84` | toast, second line | {n} open connections stay encrypted | {n} open connections stay encrypted. | | A sentence, so it takes its period. |
| 8.7 | `hooks/useDecrypt.tsx:151`, `:162` | toast button | Undo / Reconnect | keep | | |
| 8.8 | `hooks/useDecrypt.tsx:123` | warning toast | Certificate not trusted | keep | | |
| 8.9 | `hooks/useDecrypt.tsx:49` | error toast | Certificate not trusted: {error} | Failed to trust certificate: {error} | | Tells it apart from 8.8. |
| 8.10 | `components/Sidebar.tsx:294` | notice toast | Excluded by {entry} | keep | | |
| 8.11 | `components/ProxyStatus.tsx:353` | toast | Copied the environment. Paste it into a terminal to proxy what runs there. | Copied the environment. Paste it into a terminal. | | The instruction stays; what it does is on the button's own row. |
| 8.12 | `components/FlowList.tsx:1372`, `components/Sidebar.tsx:206` | toast | Copied value | Copied to clipboard | | Yaak's one copy toast. |
| 8.13 | `lib/flowActions.ts:138` | toast | Copied cURL / Copied URL / Copied request body / Copied response body | Copied to clipboard | | |
| 8.14 | `components/ProxyStatus.tsx:356`, `components/FlowList.tsx:1374`, `components/Sidebar.tsx:208`, `lib/flowActions.ts:140` | error toast | Failed to copy: {error} / Failed to copy value: {error} / Failed to copy {thing}: {error} | Failed to copy: {error} | | One wording; the reason stays. |
| 8.15 | `lib/flowActions.ts:165`, `:169` | error toast | Failed to copy cURL: {error} | keep | | |
| 8.16 | `lib/flowActions.ts:134` | info toast | There is no {thing} to copy | keep | | |
| 8.17 | `lib/flowActions.ts:176` | info toast | Body is binary or truncated; export HAR instead | The body is binary or truncated. Export as HAR instead. | | No semicolons. |
| 8.18 | `lib/flowActions.ts:40` | toast | Saved {size} | keep | | |
| 8.19 | `lib/flowActions.ts:36` | toast, appended | as it was on the wire, since it failed to decode | as received, since it failed to decode | | |
| 8.20 | `lib/flowActions.ts:37` | toast, appended | cut at the capture limit | truncated at the capture limit | | |
| 8.21 | `lib/flowActions.ts:43` | error toast | Failed to save the {request or response} body: {error} | keep | | |
| 8.22 | `lib/flowActions.ts:75` | toast | Exported 1 flow as HAR / Exported {n} flows as HAR | keep | | |
| 8.23 | `lib/flowActions.ts:217`, `components/SaveDialog.tsx:254` | toast | Exported the flow as HAR | Exported 1 flow as HAR | | The same event as 8.22. |
| 8.24 | `lib/flowActions.ts:79`, `:219`, `components/SaveDialog.tsx:257` | error toast | Failed to export HAR: {error} | keep | | |
| 8.25 | `components/SaveDialog.tsx:105-106` | toast | Saved {name} to {workspace}, in {folder}. Yaak picks it up within a second. | Saved {name} to {workspace}, in {folder} | | How fast Yaak shows it is an internal. See flag D3. |
| 8.26 | `components/SettingsProxy.tsx:283` | toast | Captured data reset | Recorded data reset | | |
| 8.27 | `lib/opener.ts:11` | error toast | Failed to show {path}: {error} | Failed to reveal {path}: {error} | | |
| 8.28 | `lib/opener.ts:20` | error toast | Failed to open {url}: {error} | keep | | |

### 9. Dialogs

| # | Where | What | Current | Proposed | Tooltip | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 9.1 | `components/ClearFlowsButton.tsx:69` | dialog title | Clear traffic? | Clear Flows | | Titles are never questions. Matches the button and the shortcut's name; "Clear Traffic" is the alternative. |
| 9.2 | `components/ClearFlowsButton.tsx:106-107` | dialog body | 1 flow will be removed. / {n} flows will be removed. | Permanently clear 1 flow? / Permanently clear {n} flows? | | Yaak's confirm pattern, "Permanently delete `x`?", with the button's verb. |
| 9.3 | `components/ClearFlowsButton.tsx:109` | checkbox | Don't ask again | keep (user's wording) | | |
| 9.4 | `components/ClearFlowsButton.tsx:113-114` | button | Cancel / Clear | keep | | |
| 9.5 | `components/SavedSearchDialog.tsx:50` | dialog title | Save search / Rename search | Save Search / Rename Search | | |
| 9.6 | `components/SavedSearchDialog.tsx:61` | input label | Name | keep | | |
| 9.7 | `components/SavedSearchDialog.tsx:70-72` | button | Cancel / Save / Rename | keep | | |
| 9.8 | `proxy-lib/saved_queries.rs:64`, `:74` | error toast | A saved search needs a name / Nothing to save | keep | | |
| 9.9 | `components/AddColumnDialog.tsx:92` | dialog title | Add Column | keep | | |
| 9.10 | `components/AddColumnDialog.tsx:126-127` | button | Cancel / Add | keep | | |
| 9.11 | `components/SaveDialog.tsx:43` | dialog title | Save as Yaak request | Save as Yaak Request | | |
| 9.12 | `components/SaveDialog.tsx:44` | dialog description | A new request in Yaak with this flow's method, URL, headers and body. | A new request will be created in Yaak. | | The form below shows the method, URL, headers and body. |
| 9.13 | `components/SaveDialog.tsx:118` | banner | Yaak has no workspaces yet. Create one in Yaak, then save here. | Create a workspace in Yaak first. | | |
| 9.14 | `components/SaveDialog.tsx:145-173` | form labels | Workspace / Folder / No folder / Name | keep | | |
| 9.15 | `components/SaveDialog.tsx:178-179` | heading | 1 header left out / {n} headers left out | keep | | |
| 9.16 | `components/SaveDialog.tsx:322` | heading, after | Yaak sets these itself when it sends | Yaak sets these itself when it sends the request. | | |
| 9.17 | `components/SaveDialog.tsx:324` | heading, after | Yaak sets these itself, or they only meant something to the proxy | Yaak sets these, or they were meant for the proxy. | | |
| 9.18 | `components/SaveDialog.tsx:311-315` | tooltip | Yaak sets it when it sends / Only meant for the proxy / The body is saved decoded | Yaak sets it when it sends the request. / It was only meant for the proxy. / The body is saved decoded. | | |
| 9.19 | `components/SaveDialog.tsx:201`, `:234` | row label | Kept / Note | keep | | |
| 9.20 | `components/SaveDialog.tsx:203-204` | row value | {n} headers, and no body / {n} headers, and the body as {type} | keep | | |
| 9.21 | `proxy-lib/lib.rs:2781-2791` | row value, type | JSON / XML / GraphQL / text | keep | | |
| 9.22 | `proxy-lib/lib.rs:2787-2788` | row value, type | form URL-encoded with 1 field / form URL-encoded with {n} fields | a URL-encoded form with 1 field / a URL-encoded form with {n} fields | | Reads after "the body as". |
| 9.23 | `proxy-lib/convert.rs:68` | note | The Authorization header is saved as captured, in plain text. | The Authorization header is saved in plain text. | | The dialog matches on the word "Authorization" to colour it. |
| 9.24 | `proxy-lib/convert.rs:73` | note | The body was cut at the capture limit, so only its first {n} bytes are saved. | Only the first {n} bytes of the body are saved. | | |
| 9.25 | `proxy-lib/convert.rs:173` | note | The body is binary and is saved as text, so bytes that are not UTF-8 are replaced. | The body is binary and may be altered when saved. | | |
| 9.26 | `proxy-lib/convert.rs:199` | note | The multipart body is saved as text with its Content-Type, not as form fields. | The multipart body is saved as text, not form fields. | | |
| 9.27 | `components/SaveDialog.tsx:213` | footer | Yaak picks it up within a second | (remove) | | An internal, and cut from the toast too, 8.25. See flag D3. |
| 9.28 | `components/SaveDialog.tsx:216` | button | Cancel | keep | | |
| 9.29 | `components/SaveDialog.tsx:218` | button | Save request | Save Request | | |
| 9.30 | `components/SaveDialog.tsx:265` | dialog heading | Saving needs Yaak | Yaak Required | | As Yaak's "Credentials Required". |
| 9.31 | `components/SaveDialog.tsx:267-269` | dialog body | This flow becomes a request in one of Yaak's workspaces, and Yaak has not been opened on this Mac. Yaak is free for personal use and opens the request with the same viewers you see here. | This flow will be saved as a request in one of Yaak's workspaces, but Yaak has not been opened on this computer. | | The first sentence only, as you asked; nothing promoting Yaak. Shorter still: "Yaak has not been opened on this computer." "This Mac" showed on every platform; see flag F2. |
| 9.32 | `components/SaveDialog.tsx:246` | footer | Or keep the flow as a file | The flow can be exported as a file instead. | | |
| 9.33 | `components/SaveDialog.tsx:249` | button | Export HAR | Export as HAR | | |
| 9.34 | `components/SaveDialog.tsx:261` | button | Download Yaak | keep | | |
| 9.35 | `components/HelperDialog.tsx:51` | dialog title | Turn on Yaak Proxy under Allow in the Background | Approve Helper | | The instruction moves to the description. |
| 9.36 | `components/HelperDialog.tsx:52` | dialog description | In System Settings > General > Login Items. Newer macOS calls the list Background App Activity. | Turn on Yaak Proxy in System Settings > General > Login Items. | | See flag F7. |
| 9.37 | `components/HelperDialog.tsx:80` | status | Waiting for approval | keep | | A progress label. |
| 9.38 | `components/HelperDialog.tsx:85-87` | button | Cancel / Close / Open System Settings | keep | | |

### 10. Settings

The General, Theme and Interface tabs are Yaak's own shared pages and are not reviewed here.

| # | Where | What | Current | Proposed | Tooltip | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 10.1 | `components/Settings.tsx:156-181` | tab | General / Theme / Interface / Proxy / License | keep | | |
| 10.2 | `components/Settings.tsx:182` | empty state | Coming soon | keep | | Better to hide the tab until it has content; that is a behaviour change. |
| 10.3 | `components/Settings.tsx:226-230` | button | Reveal in Finder / Show in Explorer / Show in Folder | Reveal in Finder / Show in Explorer / Show in File Manager | | |
| 10.4 | `components/SettingsProxy.tsx:61` | page title | Proxy | keep | | |
| 10.5 | `components/SettingsProxy.tsx:61` | page description | Listening, decryption, traffic and terminals | Configure the port, decryption, recorded traffic, and terminal environment. | | An imperative sentence, as Yaak's page descriptions are. |
| **Proxy** | | | | | | |
| 10.6 | `components/SettingsProxy.tsx:63` | section heading | Proxy | keep | | |
| 10.7 | `components/SettingsProxy.tsx:150` | row title | Port | keep | | |
| 10.8 | `components/SettingsProxy.tsx:150` | row description | Restarts the proxy | Changing the port restarts the proxy. | | |
| 10.9 | `components/SettingsProxy.tsx:67` | row title | HTTP version | keep | | |
| 10.10 | `components/SettingsProxy.tsx:68` | row description | For new connections | The change applies to new connections. | | |
| 10.11 | `components/SettingsProxy.tsx:73-74` | option | Auto / HTTP/1.1 only | Automatic / HTTP/1.1 only | | As Yaak's own HTTP version select. |
| 10.12 | `components/SettingsProxy.tsx:80-81` | row title and description | Override system proxy / At launch | Override system proxy at launch / Traffic from every app will be recorded. | | "At launch" is the end of the title, not a description. |
| 10.13 | `components/SettingsProxy.tsx:182` | row title | Helper | keep | | |
| 10.14 | `lib/systemProxy.ts:79-80` | row description | Not installed. Changes use the password prompt. | The helper is not installed. | The helper changes the system proxy without a password prompt. | One tooltip for the Helper row, the same in every state but 10.17. |
| 10.15 | `lib/systemProxy.ts:85-86` | row description | Awaiting approval. Changes use the password prompt. | The helper is awaiting approval. | The helper changes the system proxy without a password prompt. | |
| 10.16 | `lib/systemProxy.ts:91-94` | row description | Enabled. No password prompts. | The helper is installed. | The helper changes the system proxy without a password prompt. | |
| 10.17 | `lib/systemProxy.ts:95` | row description | Enabled. One more password prompt puts back your settings. | The helper is installed. | One more password prompt is needed to restore the system proxy settings. | Shown while the system proxy is still set the old way. |
| 10.18 | `lib/systemProxy.ts:66-67` | row description | Not in dev builds. Changes use the password prompt. | The helper is not available in dev builds. | The helper changes the system proxy without a password prompt. | |
| 10.19 | `lib/systemProxy.ts:73-74` | row description | Not found by macOS. Changes use the password prompt. | macOS could not find the helper. | The helper changes the system proxy without a password prompt. | |
| 10.20 | `components/SettingsProxy.tsx:200-203` | button | Install / Approve / Unregister | Install / Approve / Uninstall | | The pair of Install. |
| **Decryption** | | | | | | |
| 10.21 | `components/SettingsProxy.tsx:91` | section heading | Decryption | keep | | |
| 10.22 | `components/DecryptListEditor.tsx:130`, `:135` | row title and description | Certificate / Yaak Proxy CA | keep | | Its literal name in the keychain. |
| 10.23 | `components/DecryptListEditor.tsx:140-147` | status and button | Trusted / Not trusted / Trust / Waiting for macOS | keep | | |
| 10.24 | `components/DecryptListEditor.tsx:159` | button | Reveal | Reveal in Finder / Show in Explorer / Show in File Manager | | The app's other reveal buttons name the place. |
| 10.25 | `components/DecryptListEditor.tsx:77` | row title | Decrypt everything | keep | | |
| 10.26 | `components/DecryptListEditor.tsx:78` | row description | Except built-in exclusions | Excluded hosts and apps stay encrypted. | | The same sentence as 2.30 and 8.2. |
| 10.27 | `components/DecryptListEditor.tsx:91` | heading | Hosts and apps | keep | | |
| 10.28 | `components/DecryptListEditor.tsx:92` | hint | New connections | Changes apply to new connections. | | Takes over from the tooltip, 10.29. |
| 10.29 | `components/DecryptListEditor.tsx:302` | tooltip | Applies to new connections | (remove) | | Said twice. See flag D4. |
| 10.30 | `components/DecryptListEditor.tsx:310` | placeholder | Add host or app | keep | | |
| 10.31 | `lib/decrypt.ts:474-476` | completion info | Exclude / Host or *.site | Exclude / Host or *.domain | | |
| 10.32 | `lib/decrypt.ts:477` | completion info | App name or bundle id | App name or bundle ID | | |
| 10.33 | `components/DecryptListEditor.tsx:289` | validation | Not a host or app | Invalid host or app | | As "Invalid value" and "Invalid name". |
| 10.34 | `components/DecryptListEditor.tsx:109` | empty state | Nothing listed | No hosts or apps | | |
| 10.35 | `lib/decrypt.ts:103-104` | list row | Everything / Nothing | keep | | |
| 10.36 | `components/DecryptListEditor.tsx:190`, `:179` | list row | {n} built-in exclusions / Apple, pinned apps | keep | | |
| 10.37 | `components/DecryptListEditor.tsx:223`, `:235` | tooltip and badge | Excluded / Decrypted / Apple / Pinned | keep | | |
| 10.38 | `components/DecryptListEditor.tsx:242` | tooltip | Remove {entry} | keep | | |
| **Traffic** | | | | | | |
| 10.39 | `components/SettingsProxy.tsx:95` | section heading | Traffic | keep | | |
| 10.40 | `components/SettingsProxy.tsx:220` | row title | Captured traffic | Recorded traffic | | |
| 10.41 | `components/SettingsProxy.tsx:226-227` | option | Clear on launch / Keep between launches | keep | | |
| 10.42 | `components/SettingsProxy.tsx:243` | row title | Size limit | keep | | |
| 10.43 | `components/SettingsProxy.tsx:243` | row description | Oldest flows dropped past it | The oldest flows will be cleared first. | | |
| 10.44 | `components/SettingsProxy.tsx:247`, `lib/settings.ts:141` | value and option | {size} used / Unlimited | keep | | |
| 10.45 | `components/SettingsProxy.tsx:270` | row title | Confirm before clearing | keep | | |
| 10.46 | `components/SettingsProxy.tsx:288` | row title | Reset captured data | Reset recorded data | | |
| 10.47 | `components/SettingsProxy.tsx:288` | row description | Deletes all flows and their keys | All traffic and its encryption keys will be deleted. | | |
| 10.48 | `components/SettingsProxy.tsx:290` | button | Reset… | Reset | | |
| 10.49 | `components/SettingsProxy.tsx:296` | dialog title | Reset captured data? | Reset Recorded Data | | Titles are never questions. |
| 10.50 | `components/SettingsProxy.tsx:297` | dialog body | Every captured flow and the keys that encrypt them are deleted. | Permanently delete all traffic and its encryption keys? | | Yaak's confirm pattern. |
| 10.51 | `components/SettingsProxy.tsx:302-304` | button | Cancel / Reset | keep | | |
| **Terminal** | | | | | | |
| 10.52 | `components/SettingsProxy.tsx:102` | section heading | Terminal | keep | | |
| 10.53 | `components/SettingsProxy.tsx:333` | row title | Environment | keep | | |
| 10.54 | `components/SettingsProxy.tsx:366` | row description | Proxies one terminal instead of the system | Traffic from one terminal will be recorded. | | |
| 10.55 | `components/SettingsProxy.tsx:342`, `lib/env.ts:6-9` | tooltip and options | Shell / bash / zsh / fish / PowerShell / cmd | keep | | |
| 10.56 | `components/SettingsProxy.tsx:363` | button | Open Terminal | keep | | |
| 10.57 | `components/SettingsProxy.tsx:354` | tooltip | A new Terminal window with these set | A new Terminal window will open with these variables set. | | On a text button, so it explains. |
| 10.58 | `components/SettingsProxy.tsx:355` | tooltip, disabled | Not available on this platform yet | Opening a terminal is only supported on macOS. | | As the error, 12.30. |

### 11. App menu

| # | Where | What | Current | Proposed | Tooltip | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 11.1 | `tauri/window_menu.rs:59-161` | menu titles | File / Edit / View / Go / Window / Help | keep | | |
| 11.2 | `tauri/window_menu.rs:109` | menu item | Quit Yaak Proxy | keep | | |
| 11.3 | `tauri/window_menu.rs:127` | menu item | Export All Flows as HAR | keep | | |
| 11.4 | `tauri/window_menu.rs:164`, `:168` | menu item | Back / Forward | keep | | |
| 11.5 | `tauri/lib.rs:139`, `:235` | window title | Yaak Proxy Settings / Yaak Proxy | keep | | |
| 11.6 | `proxy-lib/actions.rs:38`, `:46` | action label | Pause or Resume Recording / Clear Flows | keep | | Not shown anywhere today. |

### 12. Errors and the locked state

| # | Where | What | Current | Proposed | Tooltip | Note |
| --- | --- | --- | --- | --- | --- | --- |
| **Locked state** | | | | | | |
| 12.1 | `components/LockedState.tsx:31` | heading | Encrypting stored traffic, {percent} | Encrypting recorded traffic, {percent} | | |
| 12.2 | `components/LockedState.tsx:43` | description | Earlier traffic shows here once it's encrypted. | keep | | |
| 12.3 | `components/LockedState.tsx:38` | heading | Traffic is locked | keep | | |
| 12.4 | `lib/locked.ts:24` | description | Allow Yaak Proxy to use its key in Keychain Access, then retry. | keep | | Names Credential Manager or the keyring off macOS. |
| 12.5 | `components/LockedState.tsx:54` | button | Retry | keep | | |
| 12.6 | `proxy-lib/lib.rs:2062` | error prefix | Traffic is locked: {reason} | keep | | |
| 12.7 | `proxy-lib/lib.rs:236` | error reason | traffic captured before this version is being encrypted. | traffic recorded before this version is being encrypted. | | |
| 12.8 | `proxy-lib/lib.rs:239` | error reason | its key has not been read yet. | keep | | |
| 12.9 | `proxy-lib/lib.rs:278` | error reason | {12.12}, so the traffic it stored can't be encrypted yet. Take over or quit it, then retry. | {12.12}. Take over or quit it, then retry. | | Why it blocks is an internal; what to do stays. |
| 12.10 | `proxy-lib/db.rs:158` | error reason | The proxy's captured traffic is encrypted, but its key is missing from {folder} | The encryption key is missing from {folder}. | | |
| 12.11 | `proxy-lib/db.rs:328-332` | error reason | Yaak Proxy stores traffic encrypted and couldn't read its key from the keychain: {reason}. Allow it access, then retry. | Failed to read the encryption key from the keychain: {reason} | | The remedy is the line above it on screen, 12.4. Code matches on its opening words, one constant, so safe. |
| **Starting and taking over** | | | | | | |
| 12.12 | `proxy-lib/control.rs:392` | error | The proxy is already running in {owner} (pid {pid}) | keep | | |
| 12.13 | `proxy-lib/control.rs:397-398` | error, owner | Yaak Proxy / the yaak CLI | Yaak Proxy / the CLI | | |
| 12.14 | `engine/lib.rs:569` | error | Failed to bind port {port}: {error} | keep | | |
| 12.15 | `proxy-lib/lib.rs:723` | error | The proxy in {owner} (pid {pid}) stopped but did not let go of it | Failed to take over from {owner} (pid {pid}) | | Yaak's error form. "It" had nothing to point at. |
| 12.16 | `proxy-lib/lib.rs:949` | error | {12.12}. Quit it first. | keep | | |
| 12.17 | `proxy-lib/lib.rs:855` | error toast | The port must be from 1 to 65535 | keep | | |
| **System proxy and helper** | | | | | | |
| 12.18 | `proxy-lib/macos.rs:282` | macOS password prompt | Yaak Proxy wants to change your system proxy settings. | keep | | macOS's own form for this prompt. |
| 12.19 | `proxy-lib/macos.rs:290` | error | Cancelled in the password dialog | The password prompt was cancelled. | | The same sentence as 2.25. See flag D2. |
| 12.20 | `proxy-lib/lib.rs:811` | error | The proxy is not running, so there is nothing to route to | The proxy is not running | | |
| 12.21 | `proxy-lib/helper.rs:136-137` | error | Failed to install the helper: {error} | keep | | |
| 12.22 | `proxy-lib/helper.rs:156` | error | Failed to remove the helper: {error} | Failed to uninstall the helper: {error} | | Matches the button, 10.20. |
| 12.23 | `proxy-lib/helper.rs:161` | error | The helper is only available in the installed app, not a dev build | The helper is not available in dev builds | | As 10.18. A one-sentence error takes no period, as the kept ones. |
| 12.24 | `proxy-lib/helper.rs:173` | error | The helper is not running: {error} | keep | | |
| 12.25 | `proxy-lib/helper.rs:184` | error | The helper hung up: {error} | The helper disconnected: {error} | | |
| 12.26 | `proxy-lib/helper.rs:188` | error | The helper did not answer: {error} | The helper did not respond: {error} | | |
| 12.27 | `proxy-lib/helper.rs:190` | error | The helper's answer was not understood: {error} | The helper sent an invalid response: {error} | | |
| 12.28 | `proxy-lib/ca.rs:106`, `proxy-lib/macos.rs:504` | error | Trusting the certificate from the app is only supported on macOS / Setting the system proxy is only supported on macOS | keep | | |
| 12.29 | `proxy-lib/helper.rs:217`, `:222` | error | The helper is only available on macOS | The helper is only supported on macOS | | One form for all four. |
| 12.30 | `proxy-lib/terminal.rs:47` | error | Opening a terminal with the proxy set is only supported on macOS so far | Opening a terminal is only supported on macOS | | |
| 12.31 | `proxy-lib/ca.rs:73`, `:92`, `proxy-lib/macos.rs:287`, `:300`, `proxy-lib/terminal.rs:36` | error | security exited with {status} / Failed to run {command}: {error} | keep | | |
| **Flows and bodies** | | | | | | |
| 12.32 | `proxy-lib/lib.rs:3236` | flow error | Rejected the proxy's certificate | Certificate rejected by the app | | See flag D9. |
| 12.33 | `proxy-lib/lib.rs:3226`, `:3229` | flow error | Yaak Proxy stopped before the stream ended / Yaak Proxy stopped before the connection closed | keep | | |
| 12.34 | `proxy-lib/lib.rs:3232-3233` | error | Not a request: the client's TLS handshake failed before it sent one | The TLS handshake failed before any request was sent | | |
| 12.35 | `proxy-lib/bodies.rs:115` | banner | Failed to decode {encoding} body: {error} | keep | | |
| 12.36 | `engine/decode.rs:104` | banner, reason | No output from the deflate body within the capture limit | keep | | |
| 12.37 | `engine/decode.rs:135`, `:203` | banner, reason | The gzip header is too long / Not a gzip stream | keep | | |
| 12.38 | `proxy-lib/bodies.rs:16` | error toast | A WebSocket has no body after its 101 response. Its frames are its messages. | A WebSocket has no body | | Reaches the UI when saving such a body to a file. |
| 12.39 | `proxy-lib/flows.rs:701` | error toast | Failed to clear flows: {error} | keep | | |
| 12.40 | `proxy-lib/flows.rs:722` | error | Failed to delete captured traffic: {error} | Failed to delete recorded traffic: {error} | | |
| 12.41 | `proxy-lib/filter_history.rs:21` | error toast | Failed to {read, record, clear} the filter history: {error} | Failed to {read, record, clear} the search history: {error} | | |
| 12.42 | `proxy-lib/lib.rs:2832-2887` | error toast | Failed to create {path}: {error} / Failed to write {path}: {error} | keep | | |
| **Saving to Yaak, and settings** | | | | | | |
| 12.43 | `proxy-lib/save.rs:73` | banner | Yaak's database was not found at {path}. Install Yaak and open it once. | keep | | |
| 12.44 | `proxy-lib/save.rs:79`, `:84`, `:144` | banner | Failed to open Yaak's database: {error} / Failed to save the request to Yaak: {error} | keep | | |
| 12.45 | `proxy-lib/save.rs:119-125` | banner | No workspace {id} in Yaak / No folder {id} in Yaak / Folder {id} is not in workspace {id} | keep | | |
| 12.46 | `proxy-lib/lib.rs:1489` | banner | Failed to record the saved request on the flow: {error} | keep | | |
| 12.47 | `proxy-lib/settings.rs:232-244` | error toast | Invalid settings in {path}: {error} / Failed to read {path}: {error} / Failed to write {path}: {error} | keep | | |
| 12.48 | `tauri/lib.rs:134` | error toast | The main window is not open to open Settings over | Failed to open Settings: the main window is closed | | |

Left out as developer-only or never reaching the window: the control API's and the CLI client's errors (`proxy-lib/control.rs`, `proxy-lib/client.rs`), gRPC schema attachment (`proxy-lib/grpc.rs:101-305`), app icon failures (`proxy-lib/attribution.rs`), "No flow {id}" lookups, decrypt-entry parse errors (`engine/decrypt.rs`, the input validates first), and the text the proxy sends back to the proxied app (`engine/request.rs`).

## Terminology decisions

One word per thing, applied through the table.

| Thing | The app says | Never |
| --- | --- | --- |
| The stream as a whole | **traffic** ("All Traffic", "Traffic is locked", "Recorded traffic", "Traffic from every app will be recorded.") | "captured data"; "flows" where the whole stream is meant |
| One row of it | **flow**, counted as **flows** ("4,102 flows", "1 new flow", "Search 4,102 flows", "Export All Flows as HAR", "Clear Flows") | "request" for a row. "Requests" stays in your encrypted-card line and for Yaak requests ("Save as Yaak Request"). |
| Keeping traffic | **Recording** and **Paused**; verbs "Pause Recording", "Resume Recording"; traffic is "recorded" | "stored", "captured", "kept". "The capture limit" stays as that limit's name (see flag N17). |
| Reading HTTPS | verbs **Decrypt** and **Stop Decrypting**; the feature is **decryption**; states **Encrypted** and **Decrypted** | "passed through", "not on the decrypt list", "tunnelled" |
| A `!` entry | **Exclude**, **Stop Excluding**, **Excluded**; what they name are **excluded hosts and apps** | "Apple services and apps that pin" and "built-in exclusions" as two names for one clause |
| Emptying | **Clear** empties the list of flows or a history; **Remove** takes one item off a list; **Delete** destroys a saved search or all data; **Reset** goes back to a default | "dropped", "removed" for flows; "Clear Sorting" beside "Reset Sort" |
| What sent a flow | **app** | "program", "client", "process". "Client" and "Server" stay only as the two HTTP sides in the Info tab. |
| `*.example.com` and an exact name | **domain** and **host** | "site" |
| The header box and what is saved from it | **search** ("Recent searches", "Save Search") | "filter" for the same thing. "Filter" stays in your three menu items and in the body viewer's JSONPath filter. |
| A body over the capture limit | **truncated** | "cut", "kept" |
| A body as it arrived | **as received** | "as it was on the wire" |
| The CA | **certificate**; "Yaak Proxy CA" only as its literal keychain name | "the proxy's certificate", "proxy CA" |
| The macOS proxy setting | **Override system proxy**; in sentences, "the system proxy is overridden" | "routing", "turn on the system proxy" |
| Settings | **Settings** is the app's; **System Settings** is macOS's, always in full | "Settings" for the macOS pane |
| A handshake the app turned down | **rejected** | "refused" |
| Trying once more | **Retry** | "Try Again" |
| A macOS password prompt | **the password prompt**; in flight, the label **Waiting for macOS** | "password dialog", "Waiting for your password" |
| Another running Yaak Proxy | **another copy of Yaak Proxy** | "another Yaak Proxy window", "the engine" |
| The other owner | **the CLI** | "the yaak CLI" |
| Showing a file | **Reveal in Finder**, **Show in Explorer**, **Show in File Manager** (Yaak's three) | "Show in Folder" |

## Flags

### Wrong or misleading as facts

- **F1.** `components/FirstRun.tsx:52` says "Two steps, once." Only the first step is the user's; the second is a wait for traffic.
- **F2.** Two strings name macOS on every platform. `components/FirstRun.tsx:142` says "macOS may ask" with no platform check, while `lib/locked.ts` already names Credential Manager and the keyring. `components/SaveDialog.tsx:268` says "on this Mac" in a dialog Windows and Linux also show.
- **F3.** `components/ProxyStatus.tsx:160` says the password is asked "until the helper is approved in Settings". It also shows when the helper is not installed at all, where there is nothing to approve, and "Settings" reads as the app's while the approval is given in System Settings.
- **F4.** "Except Apple services and apps that pin" is fixed text in eight places. It is false once the built-in exclusions are removed (as in your dev app), and it leaves out the user's own exclusions, which apply too. "Excluded hosts and apps stay encrypted." is always true.
- **F5.** `lib/encryptedCard.ts:274` shows "Not on the decrypt list" in exactly the case where the list now decrypts the connection; the line under it then says it opened before that.
- **F6.** Keys are fixed to macOS: `components/FlowDetail.tsx:32-36` shows ⌘R and ⌘⇧K where Windows and Linux bind Ctrl+Shift+R and Ctrl+Shift+K (`proxy-lib/actions.rs:40,48`), and `components/SearchBar.tsx:201` shows ⌘F.
- **F7.** `components/HelperDialog.tsx:52` says "Newer macOS calls the list Background App Activity" beside a title that calls it "Allow in the Background". I could not check which name the current macOS uses; the proposal keeps the title's.
- **F8.** `components/TakeOverBanner.tsx:32` and `components/FirstRun.tsx:65` say "Another Yaak Proxy window". The other owner is another running copy of the app, not a window of this one.
- **F9.** `components/FlowInfo.tsx:82` labels a request ID "Saved As", which reads as a name. "Yaak Request ID" is exact.
- **F10.** `components/FlowListEmpty.tsx:37` reads "Recording on port --" when the port is not known. The proposed sentence would read "Traffic sent to port -- will be recorded.", so the case needs its own line or no port.
- **F11.** The search field `@time` means when a flow started (the Started column), while the Time column is `@duration`. Prose cannot fix that; it needs an alias or a rename.
- **F12.** `lib/encryptedCard.ts:424` says "Passed through until relaunch" without saying whose. The pass-through list lives in the proxy and is emptied when Yaak Proxy restarts, so the proposal names Yaak Proxy.

### Duplicated messages for one event

- **D1.** The take-over strip says where the proxy runs twice: "Running in another Yaak Proxy" then "Another Yaak Proxy window owns the engine" (`components/TakeOverBanner.tsx:20,32`).
- **D2.** A cancelled password prompt is worded in Rust ("Cancelled in the password dialog", `proxy-lib/macos.rs:290`) and reworded in the window by matching on "cancel" ("Cancelled in the password prompt", `lib/systemProxy.ts:40`). Both become "The password prompt was cancelled."
- **D3.** "Yaak picks it up within a second" is in the save dialog's footer and again in its toast (`components/SaveDialog.tsx:106,213`). The proposals drop both.
- **D4.** "New connections" as a hint and "Applies to new connections" as a tooltip sit on the same input (`components/DecryptListEditor.tsx:92,302`).
- **D5.** "Not running" has three wordings: the pill and row title, "The proxy has not started." under that title (`components/ProxyStatus.tsx:90-93`), and "The proxy is not running." in the list (`components/FlowListEmpty.tsx:34`). The proposals leave two: the state name, and "The proxy failed to start." for the reason.
- **D6.** Encrypting older traffic is explained four ways (`components/FirstRun.tsx:94`, `components/ProxyStatus.tsx:69`, `components/LockedState.tsx:43`, `proxy-lib/lib.rs:236`).
- **D7.** Paused is explained four ways (`components/ProxyStatus.tsx:84`, `components/FirstRun.tsx:98`, `components/FlowListEmpty.tsx:36` and `:59`). The proposals leave one sentence, "Traffic passes through without being recorded.", in the status menu and the empty list.
- **D8.** A truncated body is said eight ways: "Body cut at the capture limit", "Body cut", "First {size} kept", "Showing the first {size} of {size}, the capture limit", "First {size} of {size} kept", "cut at the capture limit", "The message is cut at the capture limit.", "The body was cut at the capture limit" (rows 4.19, 6.6, 6.7, 6.25, 6.27, 8.20, 6.44, 9.24).
- **D9.** "Rejected the proxy's certificate" is built once in Rust as the flow's error and again in the list's tooltip (`proxy-lib/lib.rs:3236`, `components/FlowList.tsx:932`).
- **D10.** Exporting one flow says "Exported the flow as HAR" from the flow's menu and "Exported 1 flow as HAR" from the list's (`lib/flowActions.ts:217,75`).
- **D11.** Copying has five success toasts and four failure toasts (rows 8.11 to 8.14) where Yaak has one of each.
- **D12.** A macOS password prompt in flight reads "Waiting for macOS" for the certificate and "Waiting for your password" for the system proxy (`components/ProxyStatus.tsx:247`, `lib/systemProxy.ts:31`).
- **D13.** "Certificate not trusted" is both a state (pill, strip, warning toast) and the lead of an error toast when trusting fails (`hooks/useDecrypt.tsx:49,123`).
- **D14.** The same clause about exclusions is written two ways within one feature: "Except Apple services and apps that pin" in the status menu and toasts, "Except built-in exclusions" in Settings (`components/DecryptListEditor.tsx:78`).

### One thing with two names

- **N1.** Recorded traffic is "captured traffic" (Settings, first run), "stored traffic" (the encrypting titles), "captured data" (the reset row) and "the capture database" (the take-over strip).
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
- **N17.** "the capture limit" names a per-body limit Settings never shows, while Settings has a "Size limit" that is a different limit. The proposals keep the name; showing the limit in Settings would settle it.
- **N18.** "Export HAR" and "Export as HAR".
- **N19.** "Certificate", "Yaak Proxy CA", "the proxy's certificate".
- **N20.** Passed through, not on the decrypt list, encrypted: three ways to say a connection was not decrypted.
- **N21.** Clearing is "Clear flows" on its button and in the shortcut list, and "Clear traffic?" in its dialog. The proposal takes "Clear Flows", the commoner; "Clear Traffic" would fit the whole-stream sense as well.
- **N22.** stored, captured, kept and recorded for the same act: "Every flow is stored", "are captured", "First {size} kept", "Recording".

## Voice guide, from the Yaak client

Client paths are under `apps/yaak-client/`. `ui/` means `packages/ui/src/components/`.

1. **Two registers.** A label names a thing or an action and stays short. An explanation says what will happen and is a complete sentence with a subject and a period. Labels are buttons, menu items, headings, tabs, select options, icon-button tooltips and state names; explanations are descriptions, status lines, dialog bodies, hints and a toast's second line. "Reset Changes" over "This will discard all uncommitted changes. This cannot be undone." (`components/git/GitDropdown.tsx:228-229`), "Generate Example" over "The current message will be replaced with an example." (`components/GrpcEditor.tsx:150-151`).
2. **Explanations have a subject, and the subject is the user's data.** Passive and "will be" are the usual form. "The current message will be replaced with an example." (`components/GrpcEditor.tsx:151`), "Sharable environments are included in data export and directory sync." (`components/CreateEnvironmentDialog.tsx:51`), "Cookies will appear when a response includes a Set-Cookie header." (`components/CookieDialog.tsx:174`), "Any previously encrypted values will fail to decrypt and will need to be re-entered manually." (`components/WorkspaceEncryptionSetting.tsx:221-222`). The proxy's model: "Traffic from every app will be recorded."
3. **Never a sentence with its subject cut off.** No description in the client opens on a bare third-person verb ("Wraps…", "Sends…", "Records…"). A setting description is an imperative sentence, "Wrap long lines in request and response editors." (`ui/settings/SettingsInterface.tsx:144`), "Choose whether updates are installed automatically or manually." (`ui/settings/SettingsGeneral.tsx:130`), "Use the operating system's standard title bar and window controls." (`ui/settings/SettingsInterface.tsx:197`), or, a minority, a noun phrase, "Font used in request and response editors." (`ui/settings/SettingsInterface.tsx:94`). The proxy's settings act on traffic rather than on the interface, so they take the subject form of rule 2. Articles are never dropped from a sentence.
4. **Instructions are imperative sentences.** "You have uncommitted changes. Commit or reset your changes before pulling." (`components/git/uncommitted.tsx:8`), "Click the menu button to add, remove, or reset keyboard shortcuts." (`components/Settings/SettingsHotkeys.tsx:99`).
5. **A visible explanation is one sentence of about ten words, and the rest goes in an info tooltip or is cut.** Yaak's setting descriptions run six to ten words: "Send proxy credentials with proxied requests." (`components/Settings/SettingsProxy.tsx:107`), "Encrypt workspace secrets and sensitive values at rest." (`components/WorkspaceEncryptionSetting.tsx:137`), "Choose how Yaak should discover or use proxy settings." (`components/Settings/SettingsProxy.tsx:38`). Detail sits behind an info icon: "Sharable environments are included in Directory Sync and data export." (`components/EnvironmentSharableTooltip.tsx:5`), "Authentication was inherited from an ancestor" (`hooks/useAuthTab.tsx:68`). A line that only repeats its title is left out: "Interface font" (`ui/settings/SettingsInterface.tsx:60`) and "Automatically download updates" (`ui/settings/SettingsGeneral.tsx:141`) have none. The one long description in the client is an outlier (`components/Settings/SettingsProxy.tsx:31`).
6. **Buttons:** Title Case, one to three words, verb first, no period. "Add Certificate" (`components/Settings/SettingsCertificates.tsx:226`), "Save to File" (`components/responseViewers/BinaryViewer.tsx:32`), "Apply and Restart" (`ui/settings/SettingsInterface.tsx:209`).
7. **Menu items:** Title Case, verb plus noun. "Clear Send History" (`components/WorkspaceActionsDropdown.tsx:126`), "Expand All Folders" (`components/Sidebar.tsx:632`), "Check for Updates" (`components/SettingsDropdown.tsx:69`). Inconsistent: "Keyboard shortcuts" (`components/SettingsDropdown.tsx:34`), "Delete all" (`components/RecentHttpResponsesDropdown.tsx:106`). Title Case is the majority.
8. **Ellipses on actions:** none. Items that open a dialog are bare: "Manage Cookies" (`components/CookieDropdown.tsx:34`), "Import Data" (`components/SettingsDropdown.tsx:53`), "Workspace Settings" (`components/WorkspaceActionsDropdown.tsx:111`). Only the Git menu adds them ("Commit...", `components/git/GitDropdown.tsx:205`), a minority. Where an ellipsis does appear it is three periods, never "…".
9. **Dialog and confirm titles:** Title Case, the action as verb plus noun, never a question. "Rename Cookie Jar" (`components/CookieDropdown.tsx:48`), "Reset Changes" (`components/git/GitDropdown.tsx:228`), "Uninstall Plugin" (`hooks/useUninstallPlugin.tsx:16`). One stray: "Branch not fully merged" (`components/git/GitDropdown.tsx:408`).
10. **Confirms and destructive actions:** the body says what will be lost and the button repeats the title's verb. Two forms, about even: a statement, "This will discard all uncommitted changes. This cannot be undone." with "Reset" (`components/git/GitDropdown.tsx:229-230`), "This will restore the file to the selected commit." with "Restore" (`components/git/FileHistoryDialog.tsx:39-40`); or a one-line question, "Permanently delete `name`?" with "Delete" (`lib/deleteModelWithConfirm.tsx:29`, `lib/confirm.ts:31`), "Permanently uninstall `name`?" (`hooks/useUninstallPlugin.tsx:20`). The question is Yaak's form for deleting, so the proxy's two destructive confirms take it.
11. **Tooltips on icon buttons:** sentence case, imperative verb plus object, no period. "Toggle sidebar" (`components/SidebarActions.tsx:30`), "Save response to file" (`components/HttpResponsePane.tsx:220`), "Show response history" (`components/RecentHttpResponsesDropdown.tsx:126`). Inconsistent: "Send Request" (`components/FolderLayout.tsx:118`), "Main Menu" (`components/SettingsDropdown.tsx:105`). Sentence case is the majority. A tooltip that explains is a sentence: "This environment will be included in Directory Sync and data exports" (`components/EnvironmentEditDialog.tsx:114`).
12. **Toasts:** the first line is a label, past tense or a state, no period, names in inline code. "Copied to clipboard" (`lib/copy.ts:19`), "Already up-to-date" (`components/git/git-util.ts:13`), "Response saved to `path`" (`hooks/useSaveResponse.tsx:36`). With more to say, a bold title sits over one subtle line: "Yaak 2026.1 is available" over "Download and install the update?" (`lib/initGlobalListeners.tsx:252-254`).
13. **Errors:** "Failed to <verb>" inline, or a short title over the raw error, which is appended and never paraphrased. "Failed to copy" (`components/CopyIconButton.tsx:20`), "Export Failed" (`hooks/useExportData.tsx:14`), "Error pushing changes" over `String(err)` (`components/git/GitDropdown.tsx:179-180`). Titles split between "X Failed" and "Error <verb>ing X"; "Failed to <verb>" is the commonest one-line form.
14. **Empty states:** "No <noun>" or one imperative, no period. "No authentication" (`components/HttpAuthenticationEditor.tsx:46`), "No plugins found" (`components/Settings/SettingsPlugins.tsx:317`), "Select a commit to view diff" (`components/git/FileHistoryDialog.tsx:78`). Casing is mixed ("No Content", `components/WebsocketResponsePane.tsx:236`; "No Headers", `ui/http/ResponseHeaders.tsx:26`); sentence case is the majority. An empty state that explains is a full sentence with its period (`components/CookieDialog.tsx:174,177`).
15. **No results:** "No results for `x`" (`components/Sidebar.tsx:703`), and with suggestions "No results, but found matches for `a` or `b`" (`components/Sidebar.tsx:680`).
16. **Settings pages and sections:** a page has a one-word title and one sentence with a period, "Tweak settings related to the user interface." (`ui/settings/SettingsInterface.tsx:54`), "Configure general settings for update behavior and more." (`ui/settings/SettingsGeneral.tsx:29`). Section headings are Title Case nouns: "App Info" (`ui/settings/SettingsGeneral.tsx:48`), "Custom Proxy" (`components/Settings/SettingsProxy.tsx:61`).
17. **Setting row titles:** sentence case, a verb phrase for a switch. "Wrap editor lines" (`ui/settings/SettingsInterface.tsx:143`), "Enable proxy" (`components/Settings/SettingsProxy.tsx:64`), "Hide window controls" (`ui/settings/SettingsInterface.tsx:170`). Inconsistent: Title Case rows "Update Channel", "Data Directory" (`ui/settings/SettingsGeneral.tsx:102,53`). Sentence case is the majority.
18. **Select options:** sentence case. "Always ask", "Open in current window" (`components/Settings/SettingsInterface.tsx:46-47`), "No proxy" (`components/Settings/SettingsProxy.tsx:53`), "Automatic" (`components/ModelSettingsEditor.tsx:339`).
19. **Placeholders:** an example value or a one-word label. "api.example.com" (`components/DnsOverridesEditor.tsx:140`), "Search" (`components/Sidebar.tsx:586`), "Filter cookies" (`components/CookieDialog.tsx:152`). Some end in "..." ("Search plugins...", `components/Settings/SettingsPlugins.tsx:306`); bare is the majority.
20. **Progress and state names are labels:** a gerund or a participle, no period. "Cloning..." (`components/CloneGitRepositoryDialog.tsx:139`), "Restarting..." (`lib/initGlobalListeners.tsx:169`), "Sending Request" (`ui/http/ResponseBodyViewer.tsx:58`).
21. **Verbs:** a small fixed set, each with one meaning. Delete destroys a thing ("Delete", `components/Sidebar.tsx:527`), Remove takes it off a list ("Remove", `components/responseViewers/RecentFiltersDropdown.tsx:43`), Clear empties a history ("Clear Send History"), Reset goes back to a default ("Reset to Default", `components/Settings/SettingsHotkeys.tsx:239`). Also New, Rename, Duplicate, Copy, Save, Import, Export, Show, Hide, Enable, Reveal, Retry ("Retry", `components/GrpcEditor.tsx:189`).
22. **Names and literal values** go in inline code, not quotes. "Switched branch `x`" (`components/git/GitDropdown.tsx:109`), "Enter a new name for `x`" (`components/CookieDropdown.tsx:51`), "No results for `x`" (`components/Sidebar.tsx:703`).
23. **Never:** apologies (none in the client), exclamation marks (one in the whole client, "Thanks for the feedback!", `components/FeedbackToast.tsx:39`), headings that ask a question outside upsell banners ("Using Git for work?", `components/git/GitCommitDialog.tsx:221`). "Please" exists only in eight long banners, mostly licensing (`ui/settings/SettingsLicense.tsx:178`, `components/EnvironmentEditDialog.tsx:82`). Hedging appears twice, both "may impact performance" (`components/ConfirmLargeRequestBody.tsx:35`, `ui/http/ConfirmLargeResponse.tsx:53`).
24. **Punctuation:** a period on every full sentence, none on a label; no semicolons; counts inline ("Clear 3 Connections", `components/RecentWebsocketConnectionsDropdown.tsx:95`); "and", never "&". A few client sentences miss their period (`components/EnvironmentEditDialog.tsx:114`, `components/git/GitDropdown.tsx:609`); with a period is the majority.
25. **Length:** buttons one to three words, menu items one to four, icon tooltips two to four, a toast's first line two to five. A visible explanation is one sentence of about ten words (rule 5); a tooltip may run to two sentences.

