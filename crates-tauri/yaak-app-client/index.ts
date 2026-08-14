// ts-rs owns bindings/index.ts and rewrites it on export, so this hand-written
// entry point is where the generated files come together.
export * from "./bindings/gen_rpc";
export * from "./bindings/index";
