// ts-rs owns bindings/index.ts and rewrites it on export. What remains here
// after the RPC schema moved to @yaakapp-internal/rpc-schema is the
// desktop-only surface: plugin update and notification types. The app updater's
// types are @yaakapp-internal/tauri-updater's, shared with Yaak Proxy.
export * from "./bindings/index";
