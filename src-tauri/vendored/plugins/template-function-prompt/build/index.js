"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  plugin: () => plugin
});
module.exports = __toCommonJS(src_exports);
var plugin = {
  templateFunctions: [{
    name: "prompt.text",
    description: "Prompt the user for input when sending a request",
    args: [
      { type: "text", name: "title", label: "Title" },
      { type: "text", name: "label", label: "Label", optional: true },
      { type: "text", name: "defaultValue", label: "Default Value", optional: true },
      { type: "text", name: "placeholder", label: "Placeholder", optional: true }
    ],
    async onRender(ctx, args) {
      if (args.purpose !== "send") return null;
      return await ctx.prompt.text({
        id: `prompt-${args.values.label}`,
        label: args.values.title ?? "",
        title: args.values.title ?? "",
        defaultValue: args.values.defaultValue,
        placeholder: args.values.placeholder
      });
    }
  }]
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  plugin
});
