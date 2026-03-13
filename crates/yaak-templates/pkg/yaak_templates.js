import init from "./yaak_templates_bg.wasm?init";
export * from "./yaak_templates_bg.js";
import * as bg from "./yaak_templates_bg.js";
const instance = await init({ "./yaak_templates_bg.js": bg });
bg.__wbg_set_wasm(instance.exports);
instance.exports.__wbindgen_start();
