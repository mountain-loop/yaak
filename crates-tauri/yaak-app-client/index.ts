// ts-rs owns bindings/index.ts and rewrites it on export. What remains here
// after the RPC schema moved to @yaakapp-internal/rpc-schema is the
// desktop-only surface: updater and notification types.
export * from "./bindings/index";
