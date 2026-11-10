import init from "./yaak_query_bg.wasm?init";
export * from "./yaak_query_bg.js";
import * as bg from "./yaak_query_bg.js";
const instance = await init({ "./yaak_query_bg.js": bg });
bg.__wbg_set_wasm(instance.exports);
instance.exports.__wbindgen_start();
