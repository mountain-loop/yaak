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
var import_node_crypto = require("node:crypto");
var algorithms = ["md5", "sha1", "sha256", "sha512"];
var plugin = {
  templateFunctions: algorithms.map((algorithm) => ({
    name: `hash.${algorithm}`,
    description: "Hash a value to its hexidecimal representation",
    args: [
      {
        name: "input",
        label: "Input",
        placeholder: "input text",
        type: "text"
      }
    ],
    async onRender(_ctx, args) {
      if (!args.values.input) return "";
      return (0, import_node_crypto.createHash)(algorithm).update(args.values.input, "utf-8").digest("hex");
    }
  }))
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  plugin
});
