# yaak-rpc-schema

The wire schema for the app's RPC surface: every command name, its request
payload, and its response type, declared once.

Every host that serves the Yaak UI — the desktop app today, the browser bridge
and anything after it — imports these types and implements the commands against
them. That is what keeps a request's shape from drifting between hosts, and it
is why the TypeScript bindings (`bindings/gen_rpc.ts`, exposed to the frontend
as `@yaakapp-internal/rpc-schema`) are generated from one place.

Nothing here depends on Tauri or on any host. Request structs are plain data,
and so are the few response types declared here rather than in an engine crate.
Command *bodies* live with the host that runs them.

## Adding a command

1. Add its request struct and an entry in `with_commands!` in `src/lib.rs`.
2. Write the adapter in each host — the desktop's live in
   `crates-tauri/yaak-app-client/src/rpc_ext.rs`. A host that does not support
   the command still has to say so; a missing adapter fails to compile.
3. Regenerate the bindings: `cargo test -p yaak-rpc-schema` writes
   `bindings/gen_rpc.ts`, which is committed.

## How hosts consume the list

`with_commands!` takes the name of a `macro_rules!` macro and calls it with the
full `name(Req) -> Res` list. Each host writes a small macro that receives that
list and builds its router:

```rust
macro_rules! register_commands {
    ( $( $name:ident ( $req:ty ) -> $res:ty ),* $(,)? ) => {
        pub fn build_router() -> RpcRouter<MyCtx> {
            let mut router = RpcRouter::new();
            $( router.register(stringify!($name), rpc_handler_async!($name)); )*
            router
        }
    };
}
yaak_rpc_schema::with_commands!(register_commands);
```

The schema decides *what* commands exist; the host decides *how* each one runs.
