# The Yaak plugin sandbox

A QuickJS interpreter, a small set of globals, and one function that calls the
host. That is the whole runtime. Everything else a plugin does — read a request,
send one, store a token, ask the user something — is a message the host chose to
answer.

This document is the contract. It is written to be implementable twice: once
here, in wasm, for the browser, and once in Rust with `rquickjs`, for the desktop
and the CLI. **If the two hosts disagree about anything below, that is a bug in
whichever one drifted, not a platform difference to work around.** The promise
to plugin authors is that there is one sandbox and it behaves the same
everywhere; a promise like that is only worth making if it is enforceable, which
is why the browser runs QuickJS rather than the Worker's own JavaScript engine.

## The engine

**quickjs-ng**, and only quickjs-ng.

There is no real choice: `rquickjs` — the Rust binding the desktop host will use
— vendors quickjs-ng as a git submodule and offers no alternative. Picking
Bellard's upstream for the browser would mean the two hosts run different
engines, which is exactly the thing this design exists to prevent.

| | Version | Notes |
|---|---|---|
| Browser (this package) | quickjs-ng **0.12.1** | via `@jitl/quickjs-ng-wasmfile-release-sync` 0.32.0 |
| Desktop (planned) | quickjs-ng **0.15.1** | via `rquickjs` 0.12.2 |

**The version skew is a known gap, and closing it is slice-2 work.** Three minor
versions is small — the differences are bug fixes and `Temporal` progress, not
semantics anything here depends on — but "identical everywhere" is not a claim
that survives being approximate indefinitely. Whoever builds the Rust host
should pin both sides to the same tag and add a test that asserts the version
string matches.

### Why the sync build, not ASYNCIFY

`quickjs-emscripten` ships an ASYNCIFY variant that lets guest code call an async
host function *synchronously*. We use the plain sync build instead:

- ASYNCIFY is about twice the wasm size (1.08 MB vs 529 KB) and, measured,
  **2.2x slower**.
- It can only suspend for one host call at a time. A runtime that runs several
  plugins would have to hold one wasm instance per in-flight call.
- We do not need it. The guest gets real `await` anyway: a host function returns
  a QuickJS deferred promise, the host resolves it, and the host drains the job
  queue. `ctx.store.get(...)` is an ordinary `await` inside a plugin.

The only thing lost is a host call that *looks* synchronous to the guest, and no
Yaak plugin wants one — the whole `ctx` API has been async since it existed.

## What exists inside the sandbox

QuickJS gives you the language and nothing else. Everything below is either
installed by `src/guest/globals.ts` or absent. **Both hosts must install exactly
this list.**

### From the engine

`Object`, `Array`, `Function`, `String`, `Number`, `Boolean`, `Symbol`, `Math`,
`JSON`, `Date`, `RegExp`, `Error` and subclasses, `Map`, `Set`, `WeakMap`,
`WeakSet`, `WeakRef`, `Promise`, `Proxy`, `Reflect`, `BigInt`, `ArrayBuffer`,
`SharedArrayBuffer`, `DataView`, all `TypedArray`s, `globalThis`,
`queueMicrotask`, `performance`.

Language level is ES2023 plus most of ES2024 — `Object.groupBy`,
`Array.prototype.at`, `String.prototype.replaceAll`, async generators, private
fields, `??=` all work.

### Installed by the runtime

| Global | Notes |
|---|---|
| `console` | `.log/.info/.warn/.error/.debug/.trace`. Arguments are formatted to a string **inside** the sandbox, so only strings cross out — a cycle or an exotic prototype is the guest's problem, not the host's. |
| `setTimeout` / `clearTimeout` | The host holds the real timer; QuickJS has no clock to wake on. A sandbox torn down mid-wait takes its pending timers with it. |
| `TextEncoder` / `TextDecoder` | UTF-8 only. Pure JavaScript, in-sandbox — a bridge would cost a copy each way. Lone surrogates encode to U+FFFD, matching the standard. |
| `btoa` / `atob` | Latin-1, same narrow contract as the browser's. |

### Deliberately absent

`fetch`, `XMLHttpRequest`, `WebSocket`, `crypto`, `structuredClone`, `URL`,
`URLSearchParams`, `setInterval`, `require`, `module`, `process`, `Buffer`,
`std`, `os`, and every Node built-in.

- **Network and storage are absent because they are `ctx`'s job.** A plugin that
  could open its own socket would defeat the point of the sandbox and would not
  work in a browser anyway.
- **`setInterval` is absent** because an interval is a timer that rearms and
  nothing in a plugin should be polling. Build one from `setTimeout`, visibly.
- **`crypto` is absent, and this is the one real gap.** The decided direction is
  pure-JavaScript `@noble/*` inside the sandbox: audited, dependency-free,
  identical on both hosts, no host API to keep in sync. A `yaak.crypto` builtin
  is the escape hatch **if** a hot path is measured, not before. Concretely,
  `template-function-uuid` does not run in the sandbox today because its `uuid`
  dependency reaches for `node:crypto`; that is a slice-2 conversion, not a
  missing capability.
- **`URL` is absent** only because nothing has needed it yet. It is a reasonable
  future addition; it must be added to both hosts together.

## The module contract

A module arrives as **source text**, not a file — there is no filesystem, and in
a browser there could not be one.

It is evaluated as CommonJS, via `new Function("module", "exports", "require", source)`,
and must assign `module.exports.plugin` (or `module.exports.default`). `new
Function` rather than an ES module is deliberate: the bundle's top-level names
cannot collide with the shell's, and the source needs no loader hook.

`require` exists **only to throw**, naming the specifier. A bundle that still
calls it was not bundled for this target, and saying which module is missing
beats an `undefined` that surfaces ten frames later.

Bundling requirements: CommonJS, no external modules, no Node built-ins, ES2022.
`scripts/bundle-sandbox-plugins.mjs` does this today; what a real
`yaakcli build --target sandbox` needs is listed at the bottom of that file.

## The host interface

Four functions, installed on `globalThis` before any plugin code runs. A Rust
host must expose the same four with the same names and shapes.

| Function | Direction | Shape |
|---|---|---|
| `__yaak_call(envelopeJson)` | guest → host | Returns a **promise** of the reply JSON. The one door out. |
| `__yaak_log(level, message)` | guest → host | Both strings. Fire and forget. |
| `__yaak_timer_start(id, ms)` | guest → host | Host calls `__yaak_guest.fireTimer(id)` when due. |
| `__yaak_timer_cancel(id)` | guest → host | |

And the guest exposes `globalThis.__yaak_guest`:

| Method | Shape |
|---|---|
| `load(source, pluginRefId)` | Evaluate a module. Throws if it exports no `plugin`. |
| `summary()` | What the module contributes, as plain data. |
| `dispatch(envelopeJson)` | Returns a promise of the reply payload JSON. |
| `fireTimer(id)` | |

### Envelopes

Both directions carry `InternalEventPayload` from
`crates/yaak-plugins/src/events.rs`, **unchanged**. That is what makes a plugin
unable to tell which runtime it is in.

```jsonc
// dispatch, host → guest
{ "context": { "id": "...", "label": null, "workspaceId": "..." },
  "payload": { "type": "call_template_function_request", "name": "...", "args": { ... } } }

// __yaak_call, guest → host
{ "pluginRefId": "auth-bearer",
  "context": { ... },
  "payload": { "type": "get_key_value_request", "key": "token" } }
```

`pluginRefId` rides on outgoing calls because one host handler serves every
loaded module, and a plugin's stored state is namespaced by which plugin it is —
the same namespacing `build_shared_reply` does in `crates/yaak/src/plugin_events.rs`.

A throw inside a plugin becomes `{"type":"error_response","error":"..."}`, never
a crash and never silence: whatever asked gets a message.

## The `ctx` API

Built entirely out of `__yaak_call`. See `src/guest/context.ts` — it is the same
surface the Node runtime's `PluginInstance` builds, so it is not repeated here.

What differs is which calls a **host** answers. The browser host answers a
deliberately short list (`packages/platform/src/web/plugins.ts`) and refuses the
rest by name. Refusing by name matters: a plugin that needs something it cannot
have should fail with a sentence someone can act on.

Answered in the browser today: `get_key_value`, `set_key_value`,
`delete_key_value`, `show_toast`. Everything else — sends, model reads and
writes, prompts, response bodies, window info — refuses. Those are capability
decisions, not oversights, and each should be added one at a time.

`ctx.window.openUrl` throws in *every* sandbox host: a plugin-opened window is a
desktop affordance with no browser equivalent, and handing back a handle whose
`close()` does nothing would be worse.

## Isolation and limits

One runtime per worker, **one context per module**. A context is the isolation
boundary — its own globals, its own `Object`, its own prototypes — so two plugins
cannot see or patch each other. Sharing the runtime is deliberate: the engine and
its wasm instance are the expensive part; contexts are not.

| Limit | Value | Why |
|---|---|---|
| Memory | 256 MB per runtime | Sized for an importer holding a large document and the objects it parses into. |
| Stack | 2 MB | Deep recursion becomes a guest stack overflow, not a worker crash. |
| Synchronous execution | 60 s | A watchdog for `while (true)`, **not** a limit on real work. |

The watchdog bounds *synchronous* execution only. A plugin awaiting the host is
not looping, so the clock stops for the duration of a host call and restarts
when the guest resumes. It is generous because it costs nothing to be: plugins
run in their own worker, so one stuck there blocks no database command and no
frame. It is sized off the slowest real work measured — GitHub's 12.3 MB OpenAPI
description takes about 2.5 s (`bench/import.mjs`) — with room for a document
several times larger before a legitimate import looks like a hang.

## Where the sandbox runs, and why not in the database worker

In the browser: a **dedicated worker owned by the tab**, separate from the
SharedWorker that owns the database.

- Plugin work is slow by design, and the database worker answers every tab's
  commands synchronously. A large import in there would stall every other tab's
  reads.
- A plugin that never returns can be ended with `terminate()`. You cannot do
  that to the worker holding the database.
- The capabilities plugins actually ask for — a prompt, a toast, the active
  request — belong to a tab, not to a database. Routing through the tab is the
  shorter path, not a detour.

The cost is that `ctx.store` goes worker → tab → database worker. It is a message
either way, and this is the direction where a stuck plugin costs nothing.

Template rendering is the one flow that runs backwards: rendering happens in the
engine, in the database worker, but the functions it calls live here. So the
engine is handed a callback that asks the tab, which asks the sandbox. See
`templateBridge` in `packages/platform/src/web/worker.ts`.

## Plugins versus scripts

The shell is **not plugin-shaped underneath**. `load` takes source; `dispatch`
takes an event. What a module *is* — a plugin today, a workspace script later —
is decided by the payloads the host sends, not by the runtime.

That matters for one reason. A plugin is installed, so someone consented to it,
and a plugin may one day escalate to a full Node runtime by asking. **A script
arrives inside a workspace — as data, through an import, a git sync, a shared
repository — with no consent moment at all.** So scripts get this sandbox and
only this sandbox, forever, regardless of feature pressure. Any capability added
below must be evaluated against the script case, which is the stricter one:
"would I want this to run because someone opened a workspace a stranger sent
them?"

Expected differences when scripts arrive, none of them built yet:

- A different payload set (`run_script_request` and friends) — same envelope.
- A tighter host-call allowlist. A script should probably not reach `ctx.store`
  at all, and certainly not another plugin's namespace.
- A much shorter watchdog. A pre-request script that runs for a minute is broken;
  an importer that does is working.

## Performance

QuickJS is an interpreter with no JIT. Measured on GitHub's 12.3 MB OpenAPI
description (1220 requests imported, **identical output** in both engines):

| | First run | Best of 6 |
|---|---|---|
| Node (V8) | 304 ms | 164 ms |
| QuickJS sandbox | 2503 ms | 2017 ms |

That is **8x on the first run** and about **12x once V8 has compiled** — well
inside the 10–50x folklore, and the first-run number is the one a user waits for
because an import happens once. Reproduce with:

```bash
node packages/plugin-sandbox/bench/import.mjs <spec.json> 6
```

**Conclusion: importers stay in the sandbox.** 2.5 s in a worker, behind a
progress state, for the largest public API description that exists, is a fine
trade for one runtime everywhere. Revisit if a real document is measured
materially worse — the escape hatch is a host builtin for the hot path, not a
second runtime.

Boot cost is small: about 80–140 ms to instantiate the wasm and load a plugin,
paid once and lazily, so a session that never touches a plugin never pays it.
The wasm is 529 KB, next to the 4.3 MB SQLite one.
