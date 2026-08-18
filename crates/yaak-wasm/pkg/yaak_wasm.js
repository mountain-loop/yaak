/* @ts-self-types="./yaak_wasm.d.ts" */
import * as wasm from "./yaak_wasm_bg.wasm";
import { __wbg_set_wasm } from "./yaak_wasm_bg.js";

__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    blob_delete, blob_get, blob_put, boot, prepare_http_send, rpc
} from "./yaak_wasm_bg.js";
