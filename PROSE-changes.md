# Yaak Proxy prose pass: the changed rows

Only the rows of `PROSE.md` with a proposed change, by the same numbers. The proposed text is in bold. `{braces}` mark a value filled in at run time, and " / " separates the variants of one string. Rows marked "keep" are left out, your own wording among them.


## 1. First-run setup

| # | Current | Proposed | Note |
| --- | --- | --- | --- |
| 1.2 | Two steps, once. Then every app on this Mac sends its traffic here. | **After setup, traffic from every app on this Mac will be recorded.** | Only one step is the user's. See flag F1. |
| 1.4 | Turn on the system proxy | **Override system proxy** | One name for the switch. |
| 1.5 | System proxy on | **System proxy overridden** |  |
| 1.6 | The CLI owns the proxy. Take over to turn this on from here. | **The proxy is running from the CLI. Take over to override the system proxy from here.** |  |
| 1.7 | Another Yaak Proxy window owns the engine. Quit it to use this one. | **The proxy is running in another copy of Yaak Proxy. Quit it to use this one.** | See flag F8. |
| 1.8 | Turn On | **Enable** | Yaak says "Enable" for switches. |
| 1.9 | Try Again | **Retry** |  |
| 1.10 | Encrypting stored traffic, {percent} | **Encrypting recorded traffic, {percent}** | Same string as 2.9 and 12.1. |
| 1.13 | Traffic captured before this version is being encrypted on disk. Recording starts when it's done. | **Recording will start once encryption finishes.** | The first sentence repeats the title. Same string as 2.10. |
| 1.14 | The proxy has not started. | **The proxy failed to start.** | Fallback when there is no reason. Same as 2.17. |
| 1.15 | Recording is paused, so traffic passes through without being stored. | **Recording is paused, so traffic passes through without being recorded.** |  |
| 1.20 | Only need one terminal or one app? Copy the environment instead. | **To proxy a single terminal instead, copy the environment.** | The question is cut. |
| 1.22 | Working with an agent? `yaak mcp` gives it the proxy's flows and actions. | **Agents can read flows and run actions through `yaak mcp`.** | The question is cut. |
| 1.23 | Captured traffic is encrypted on disk with a key kept in your keychain, so macOS may ask to let Yaak Proxy use it. | **Recorded traffic is encrypted on disk with a key in the system keychain, so the system may ask to let Yaak Proxy use it.** | Shown on every platform. See flag F2. |

## 2. Header and status menu

| # | Current | Proposed | Note |
| --- | --- | --- | --- |
| 2.4 | Clear flows (traffic is locked) | **Clear flows** | The locked state is on screen. |
| 2.5 | Clear flows (none yet) | **Clear flows** |  |
| 2.9 | Encrypting stored traffic, {percent} | **Encrypting recorded traffic, {percent}** |  |
| 2.10 | Traffic captured before this version is being encrypted on disk. Recording starts when it's done. | **Recording will start once encryption finishes.** | The first sentence repeats the title. |
| 2.12 | Started by yaak proxy start, pid {pid}, since {time}. Port {port}. | **The proxy was started by `yaak proxy start` at {time} (pid {pid}).** | The port is the menu's first item. |
| 2.14 | Every flow is stored as it passes. | **Traffic sent to this port is being recorded.** |  |
| 2.15 | Traffic passes through untouched, and nothing is stored. | **Traffic sent to this port passes through without being recorded.** |  |
| 2.17 | The proxy has not started. | **The proxy failed to start.** |  |
| 2.21 | Routing this Mac's web traffic through Yaak Proxy | **Traffic from every app will be recorded.** | The model sentence. |
| 2.22 | Not routing. Only apps pointed at port {port} are captured | **Only traffic from apps pointed at port {port} will be recorded.** |  |
| 2.24 | Waiting for your password | **Waiting for macOS** | The same progress label as 2.29. |
| 2.25 | Cancelled in the password prompt | **The password prompt was cancelled.** | See flag D2. |
| 2.26 | macOS asks for your password each time until the helper is approved in Settings. | **macOS will ask for a password on each change until the helper is installed and approved.** | See flag F3. |
| 2.30 | Except Apple services and apps that pin | **Excluded hosts and apps stay encrypted.** | See flag F4. |
| 2.32 | Nothing listed | **No hosts or apps** | An empty-state label beside the count, 2.31. Same as 10.34. |
| 2.35 | Another Yaak Proxy window owns the engine. Quit it to use this one. | **Quit the other copy to use this one.** | The lead beside it already says where the proxy runs. See flag D1. |
| 2.36 | pid {pid}, since {time}. Flows still list here, read from the capture database. | **pid {pid}, since {time}. Its traffic is still listed here.** | The database is an internal. |
| 2.37 | Take over | **Take Over** |  |
| 2.39 | Required to decrypt | **The certificate must be trusted to decrypt traffic.** |  |
| 2.43 | New connections, except Apple services and apps that pin | **New connections will be decrypted, except for excluded hosts and apps.** | On a text button, so it explains. |
| 2.45 | Choose… | **Choose** | No ellipsis on a button that opens a menu. |
| 2.47 | Sites | **Domains** |  |
| 2.48 | Edit List in Settings… | **Decryption Settings** | As Yaak's "Workspace Settings". |
| 2.49 | Not now | **Dismiss** | As Yaak's toast and banner. |

## 3. Search box and search history

| # | Current | Proposed | Note |
| --- | --- | --- | --- |
| 3.3 | Save search | **Save Search** |  |
| 3.7 | Recent filters | **Recent searches** |  |
| 3.8 | No recent filters | **No recent searches** | As Yaak's "No recent requests". |
| 3.14 | Not yet | **Not supported** |  |
| 3.19 | App or program | **App** |  |
| 3.21 | A header on either side | **A request or response header** |  |
| 3.29 | Working folder | **Working directory** | The Info tab says "Directory". |
| 3.30 | Process id | **Process ID** |  |
| 3.32 | Not yet | **Not supported** |  |

## 4. Flow list and its menus

| # | Current | Proposed | Note |
| --- | --- | --- | --- |
| 4.4 | Add Column… | **Add Column** |  |
| 4.9 | Clear Sorting | **Reset Sort** | The same action as 4.5. |
| 4.15 | Encrypted: passed through after a client rejected the certificate | **Encrypted: an app rejected the certificate** |  |
| 4.16 | Encrypted: not on the decrypt list | **Encrypted: decryption is not enabled** | Follows your card line. |
| 4.17 | Rejected the proxy's certificate | **Certificate rejected by the app** | Parallel to "Cancelled by the app". Same as 12.32. |
| 4.19 | Body cut at the capture limit | **Body truncated at the capture limit** |  |
| 4.26 | Export HAR | **Export as HAR** | As "Export All Flows as HAR". |
| 4.29 | The proxy is not running. Retry from the menu by the state. | **The proxy is not running. Retry from the status menu.** |  |
| 4.30 | Traffic passes through without being stored. | **Traffic passes through without being recorded.** |  |
| 4.31 | Recording on port {port}. Flows appear as apps send requests. | **Traffic sent to port {port} is being recorded. Flows appear here as apps send requests.** | See flag F10. |
| 4.32 | Paused at {time}. Traffic passes through without being stored. | **Recording was paused at {time}. Traffic passes through without being recorded.** | Without a time, it opens "Recording is paused." |
| 4.33 | No flows match. Found matches for {query} ({n}), or {query} ({n}) | **No results, but found matches for {query} ({n}) or {query} ({n})** | Yaak's sidebar wording, word for word. Alone: "No results". |

## 5. Sidebar and its menus

| # | Current | Proposed | Note |
| --- | --- | --- | --- |
| 5.1 | All traffic | **All Traffic** | The menu item that names it is "Show in All Traffic". |
| 5.6 | Decrypt {n} Apps / {n} Hosts / {n} Sites / {n} Selected | **Decrypt {n} Apps / {n} Hosts / {n} Domains / {n} Selected** | Also in its toast, lower case. |
| 5.8 | Show in Folder | **Show in File Manager** | Yaak's name on Linux. Also the Settings button, 10.3. |
| 5.9 | Copy path | **Copy Path** |  |

## 6. Detail card and its tabs

| # | Current | Proposed | Note |
| --- | --- | --- | --- |
| 6.6 | Body cut | **Body truncated** |  |
| 6.7 | First {size} kept | **First {size} recorded** |  |
| 6.10 | Cancelled by the client | **Cancelled by the app** | The list says "app" (4.18). |
| 6.12 | Record | **Flow** | "Record" is the app's verb. |
| 6.16 | Headers | **Latency** | The column's name. See flag N3. |
| 6.17 | Total | **Time** | The column's name. |
| 6.18a | Saved As | **Yaak Request ID** | Its value is an ID, not a name. See flag F9. |
| 6.24 | {error}. Showing the body as it was on the wire. | **{error}. The body is shown as it was received.** | The view switch calls this "As received". |
| 6.25 | Showing the first {size} of {size}, the capture limit. The app received all of it. | **The first {size} of {size} is shown, up to the capture limit. The app received all of it.** |  |
| 6.26 | Showing the first {size} of the decoded body, the capture limit. The app received all of it. | **The first {size} of the decoded body is shown, up to the capture limit. The app received all of it.** |  |
| 6.27 | First {size} of {size} kept | **The first {size} of {size} is shown, up to the capture limit. The app sent all of it.** | The same fact as 6.25, so the same sentence. Takes in the tooltip, 6.28. |
| 6.28 | The app sent all of it | **(remove, merged into 6.27)** | Needs the tooltip dropped. |
| 6.39 | No Messages / No Events | **No messages / No events** | Sentence case, as Yaak's majority. |
| 6.44 | The message is cut at the capture limit. | **The message was truncated at the capture limit.** |  |
| 6.46 | No schema for {service}; reflection failed: {error} | **No schema for {service}. Reflection failed: {error}** | No semicolons. |
| 6.47 | Did not decode as {type}: {error} | **Failed to decode as {type}: {error}** | Yaak's error form. |
| 6.48 | The body ended partway through this message, {n} of its {n} bytes in | **The body ended partway through this message, after {n} of its {n} bytes.** |  |
| 6.50 | Failed to decompress the message: {error} / Failed to inflate the message: {error} | **Failed to decompress the message: {error}** | Two words for one failure. |
| 6.51 | Not inflated: an earlier message failed to, which lost the context | **This message was not decompressed because an earlier one failed.** |  |

## 7. Encrypted and rejected cards

| # | Current | Proposed | Note |
| --- | --- | --- | --- |
| 7.4 | Nothing is decrypted yet | **Encrypted Content: Enable decryption to see requests to {host}** | "Encrypted Content:" is the bold lead, as in 7.3. The same case and buttons as 7.3, so the same line. |
| 7.5 | Not on the decrypt list | **This connection was opened before {entry} was decrypted.** | Shown when the list does decrypt it now. Takes in 7.6. See flag F5. |
| 7.6 | Opened before {entry} was decrypted / Opened before everything was decrypted | **(remove, merged into 7.5)** | Needs the two lines merged. |
| 7.7 | Excluded by default / Excluded by {entry} | **This connection is excluded by default. / This connection is excluded by {entry}.** |  |
| 7.8 | Apple service / pins its certificate | **It is an Apple service. / The app pins its certificate.** | Needs the " · " between the two parts to become a space. |
| 7.15 | macOS may refuse it / {app} may refuse it | **macOS may reject the connection. / {app} may reject the connection.** |  |
| 7.16 | Asks for your password once | **macOS will ask for a password once.** |  |
| 7.17 | Certificate not trusted | **The certificate is not trusted.** | A sentence here; the pill and strip keep the state name. |
| 7.19 | {app} rejected the certificate / {app} rejected the certificate for this host | **{app} rejected the certificate. / {app} rejected the certificate for this host.** |  |
| 7.20 | A client rejected the certificate | **An app rejected the certificate.** |  |
| 7.21 | uses its own trust store / likely pinned | **It uses its own trust store. / It likely pins its certificate.** | Needs the " · " to become a space, as 7.8. |
| 7.23 | Try Again / next connection | **Retry / next connection** |  |
| 7.24 | Then rerun {app} | **Paste it into a terminal, then rerun {app}.** |  |
| 7.25 | Passed through until trusted | **This host stays encrypted until the certificate is trusted.** |  |
| 7.26 | Passed through until relaunch | **This host stays encrypted until Yaak Proxy is relaunched.** | See flag F12. |
| 7.27 | No longer passed through | **The next connection will be decrypted.** |  |

## 8. Toasts

| # | Current | Proposed | Note |
| --- | --- | --- | --- |
| 8.2 | Except Apple services and apps that pin | **Excluded hosts and apps stay encrypted.** | See flag F4. |
| 8.6 | {n} open connections stay encrypted | **{n} open connections stay encrypted.** | A sentence, so it takes its period. |
| 8.9 | Certificate not trusted: {error} | **Failed to trust certificate: {error}** | Tells it apart from 8.8. |
| 8.12 | Copied value | **Copied to clipboard** | Yaak's one copy toast. |
| 8.13 | Copied cURL / Copied URL / Copied request body / Copied response body | **Copied to clipboard** |  |
| 8.14 | Failed to copy: {error} / Failed to copy value: {error} / Failed to copy {thing}: {error} | **Failed to copy: {error}** | One wording; the reason stays. |
| 8.17 | Body is binary or truncated; export HAR instead | **The body is binary or truncated. Export as HAR instead.** | No semicolons. |
| 8.19 | as it was on the wire, since it failed to decode | **as received, since it failed to decode** |  |
| 8.20 | cut at the capture limit | **truncated at the capture limit** |  |
| 8.23 | Exported the flow as HAR | **Exported 1 flow as HAR** | The same event as 8.22. |
| 8.25 | Saved {name} to {workspace}, in {folder}. Yaak picks it up within a second. | **Saved {name} to {workspace}, in {folder}. It will appear in Yaak within a second.** |  |
| 8.26 | Captured data reset | **Recorded data reset** |  |
| 8.27 | Failed to show {path}: {error} | **Failed to reveal {path}: {error}** |  |

## 9. Dialogs

| # | Current | Proposed | Note |
| --- | --- | --- | --- |
| 9.1 | Clear traffic? | **Clear Flows** | Titles are never questions. Matches the button and the shortcut's name; "Clear Traffic" is the alternative. |
| 9.2 | 1 flow will be removed. / {n} flows will be removed. | **1 flow will be cleared. / {n} flows will be cleared.** | The button's verb. |
| 9.5 | Save search / Rename search | **Save Search / Rename Search** |  |
| 9.11 | Save as Yaak request | **Save as Yaak Request** |  |
| 9.12 | A new request in Yaak with this flow's method, URL, headers and body. | **A new request will be created in Yaak with this flow's method, URL, headers and body.** |  |
| 9.16 | Yaak sets these itself when it sends | **Yaak sets these itself when it sends the request.** |  |
| 9.17 | Yaak sets these itself, or they only meant something to the proxy | **Yaak sets these itself, or they were only meant for the proxy.** |  |
| 9.18 | Yaak sets it when it sends / Only meant for the proxy / The body is saved decoded | **Yaak sets it when it sends the request. / It was only meant for the proxy. / The body is saved decoded.** |  |
| 9.22 | form URL-encoded with 1 field / form URL-encoded with {n} fields | **a URL-encoded form with 1 field / a URL-encoded form with {n} fields** | Reads after "the body as". |
| 9.23 | The Authorization header is saved as captured, in plain text. | **The Authorization header is saved as recorded, in plain text.** | The dialog matches on the word "Authorization" to colour it. |
| 9.24 | The body was cut at the capture limit, so only its first {n} bytes are saved. | **The body was truncated at the capture limit, so only its first {n} bytes are saved.** |  |
| 9.27 | Yaak picks it up within a second | **(remove)** | Said again by the toast, 8.25, when it matters. See flag D3. |
| 9.29 | Save request | **Save Request** |  |
| 9.30 | Saving needs Yaak | **Yaak Required** | As Yaak's "Credentials Required". |
| 9.31 | This flow becomes a request in one of Yaak's workspaces, and Yaak has not been opened on this Mac. Yaak is free for personal use and opens the request with the same viewers you see here. | **This flow will be saved as a request in one of Yaak's workspaces, but Yaak has not been opened on this computer. Yaak is free for personal use and shows requests with the same viewers as Yaak Proxy.** | "This Mac" shows on every platform. See flag F2. |
| 9.32 | Or keep the flow as a file | **The flow can be exported as a file instead.** |  |
| 9.33 | Export HAR | **Export as HAR** |  |
| 9.35 | Turn on Yaak Proxy under Allow in the Background | **Approve Helper** | The instruction moves to the description. |
| 9.36 | In System Settings > General > Login Items. Newer macOS calls the list Background App Activity. | **Turn on Yaak Proxy under Allow in the Background, in System Settings > General > Login Items.** | See flag F7. |

## 10. Settings

| # | Current | Proposed | Note |
| --- | --- | --- | --- |
| 10.3 | Reveal in Finder / Show in Explorer / Show in Folder | **Reveal in Finder / Show in Explorer / Show in File Manager** |  |
| 10.5 | Listening, decryption, traffic and terminals | **Configure the port, decryption, recorded traffic, and terminal environment.** | An imperative sentence, as Yaak's page descriptions are. |
| 10.8 | Restarts the proxy | **The proxy will be restarted when the port changes.** |  |
| 10.10 | For new connections | **The change applies to new connections.** |  |
| 10.11 | Auto / HTTP/1.1 only | **Automatic / HTTP/1.1 only** | As Yaak's own HTTP version select. |
| 10.12 | Override system proxy / At launch | **Override system proxy at launch / Traffic from every app will be recorded as soon as Yaak Proxy opens.** | "At launch" is the end of the title, not a description. |
| 10.14 | Not installed. Changes use the password prompt. | **The helper is not installed. macOS will ask for a password on each system proxy change.** |  |
| 10.15 | Awaiting approval. Changes use the password prompt. | **The helper is awaiting approval. macOS will ask for a password on each system proxy change.** |  |
| 10.16 | Enabled. No password prompts. | **The helper is installed. System proxy changes need no password.** |  |
| 10.17 | Enabled. One more password prompt puts back your settings. | **The helper is installed. One more password prompt is needed to restore the system proxy settings.** |  |
| 10.18 | Not in dev builds. Changes use the password prompt. | **The helper is not available in dev builds. macOS will ask for a password on each system proxy change.** |  |
| 10.19 | Not found by macOS. Changes use the password prompt. | **macOS could not find the helper, so it will ask for a password on each system proxy change.** |  |
| 10.20 | Install / Approve / Unregister | **Install / Approve / Uninstall** | The pair of Install. |
| 10.24 | Reveal | **Reveal in Finder / Show in Explorer / Show in File Manager** | The app's other reveal buttons name the place. |
| 10.26 | Except built-in exclusions | **Excluded hosts and apps stay encrypted.** | The same sentence as 2.30 and 8.2. |
| 10.28 | New connections | **Changes apply to new connections.** | Takes over from the tooltip, 10.29. |
| 10.29 | Applies to new connections | **(remove)** | Said twice. See flag D4. |
| 10.31 | Exclude / Host or *.site | **Exclude / Host or *.domain** |  |
| 10.32 | App name or bundle id | **App name or bundle ID** |  |
| 10.33 | Not a host or app | **Invalid host or app** | As "Invalid value" and "Invalid name". |
| 10.34 | Nothing listed | **No hosts or apps** |  |
| 10.40 | Captured traffic | **Recorded traffic** |  |
| 10.43 | Oldest flows dropped past it | **The oldest flows will be cleared when the limit is reached.** |  |
| 10.46 | Reset captured data | **Reset recorded data** |  |
| 10.47 | Deletes all flows and their keys | **All recorded traffic and its encryption keys will be deleted.** |  |
| 10.48 | Reset… | **Reset** |  |
| 10.49 | Reset captured data? | **Reset Recorded Data** | Titles are never questions. |
| 10.50 | Every captured flow and the keys that encrypt them are deleted. | **All recorded traffic and its encryption keys will be permanently deleted.** |  |
| 10.54 | Proxies one terminal instead of the system | **Traffic from a terminal with these variables set will be recorded, without overriding the system proxy.** |  |
| 10.57 | A new Terminal window with these set | **A new Terminal window will open with these variables set.** | On a text button, so it explains. |
| 10.58 | Not available on this platform yet | **Opening a terminal is only supported on macOS.** | As the error, 12.30. |

## 12. Errors and the locked state

| # | Current | Proposed | Note |
| --- | --- | --- | --- |
| 12.1 | Encrypting stored traffic, {percent} | **Encrypting recorded traffic, {percent}** |  |
| 12.7 | traffic captured before this version is being encrypted. | **traffic recorded before this version is being encrypted.** |  |
| 12.9 | {12.12}, so the traffic it stored can't be encrypted yet. Take over or quit it, then retry. | **{12.12}, so the traffic it recorded can't be encrypted yet. Take over or quit it, then retry.** |  |
| 12.10 | The proxy's captured traffic is encrypted, but its key is missing from {folder} | **Recorded traffic is encrypted, but its key is missing from {folder}.** |  |
| 12.13 | Yaak Proxy / the yaak CLI | **Yaak Proxy / the CLI** |  |
| 12.15 | The proxy in {owner} (pid {pid}) stopped but did not let go of it | **The proxy in {owner} (pid {pid}) stopped, but it could not be taken over.** | "It" has nothing to point at. |
| 12.19 | Cancelled in the password dialog | **The password prompt was cancelled.** | The same sentence as 2.25. See flag D2. |
| 12.20 | The proxy is not running, so there is nothing to route to | **The proxy is not running, so the system proxy cannot be overridden.** |  |
| 12.22 | Failed to remove the helper: {error} | **Failed to uninstall the helper: {error}** | Matches the button, 10.20. |
| 12.23 | The helper is only available in the installed app, not a dev build | **The helper is not available in dev builds** | As 10.18. A one-sentence error takes no period, as the kept ones. |
| 12.25 | The helper hung up: {error} | **The helper disconnected: {error}** |  |
| 12.26 | The helper did not answer: {error} | **The helper did not respond: {error}** |  |
| 12.27 | The helper's answer was not understood: {error} | **The helper sent an invalid response: {error}** |  |
| 12.29 | The helper is only available on macOS | **The helper is only supported on macOS** | One form for all four. |
| 12.30 | Opening a terminal with the proxy set is only supported on macOS so far | **Opening a terminal is only supported on macOS** |  |
| 12.32 | Rejected the proxy's certificate | **Certificate rejected by the app** | See flag D9. |
| 12.34 | Not a request: the client's TLS handshake failed before it sent one | **This flow is not a request. The app's TLS handshake failed before it sent one.** |  |
| 12.40 | Failed to delete captured traffic: {error} | **Failed to delete recorded traffic: {error}** |  |
| 12.41 | Failed to {read, record, clear} the filter history: {error} | **Failed to {read, record, clear} the search history: {error}** |  |
| 12.48 | The main window is not open to open Settings over | **Settings could not be opened because the main window is closed** |  |
