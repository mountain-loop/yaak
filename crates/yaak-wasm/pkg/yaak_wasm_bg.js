/**
 * @param {string} id
 */
export function blob_delete(id) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.blob_delete(ptr0, len0);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * The bytes stored under an id, or none. Ids are the desktop's: a response's
 * own id for its body, `{responseId}.request` for the request that produced
 * it. Bytes cross to JS as a `Uint8Array` rather than through JSON.
 * @param {string} id
 * @returns {Uint8Array | undefined}
 */
export function blob_get(id) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.blob_get(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v2;
    if (ret[0] !== 0) {
        v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * Store bytes under an id, replacing anything already there. Chunked the way
 * the desktop chunks, so a body written here reads back on a desktop that
 * imports the database, and vice versa.
 * @param {string} id
 * @param {Uint8Array} bytes
 */
export function blob_put(id, bytes) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.blob_put(ptr0, len0, ptr1, len1);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

/**
 * Register the IndexedDB-backed VFS and open the database.
 *
 * Migrations run inside `init_standalone`, exactly as they do for the CLI.
 * Safe to call more than once; later calls are no-ops.
 * @returns {Promise<void>}
 */
export function boot() {
    const ret = wasm.boot();
    return ret;
}

/**
 * Resolve and render a request for sending, exactly as the desktop does before it puts the
 * request on the network: the environment chain, inherited headers and auth, request
 * settings, the cookie jar. Nothing here touches a socket. What comes back is what the tab
 * posts to the Yaak server.
 *
 * Refuses, with a message the user can act on, when the request needs something this host
 * doesn't have: an authentication plugin, or a template function.
 * @param {any} payload
 * @returns {Promise<any>}
 */
export function prepare_http_send(payload) {
    const ret = wasm.prepare_http_send(payload);
    return ret;
}

/**
 * Run one command as `label` (the calling tab's identity, which stands in for
 * the desktop's window label on every write it makes).
 *
 * The payload shapes match the `Cmd*Req` types in `yaak-rpc-schema`, but are
 * declared locally and dispatched by name, which is the one place this host
 * does not share the desktop's guarantees: the desktop builds its router from
 * the schema, so every command has a handler by construction. Here a renamed
 * command would surface as a runtime "not a command this host answers".
 *
 * The fix is `yaak-commands` (the `Host` trait), not more machinery here —
 * its `models::*` handlers are already this file, typed. Three things have to
 * give before a wasm host can register them:
 *
 * 1. `Host: Send + Sync`, which a browser cannot satisfy: there is one thread
 *    and the connection pool is an `Rc`.
 * 2. `models_delete` reaches for `spawn_blocking`; there is nothing to spawn
 *    onto here.
 * 3. `yaak-commands` depends on `yaak` and `yaak-plugins`, which pull the HTTP
 *    stack and the Node sidecar and do not build for wasm32.
 *
 * None of those are hard; they are just not this PR.
 * @param {string} cmd
 * @param {any} payload
 * @param {string} label
 * @returns {any}
 */
export function rpc(cmd, payload, label) {
    const ptr0 = passStringToWasm0(cmd, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(label, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.rpc(ptr0, len0, payload, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}
export function __wbg_Error_bce6d499ff0a4aff(arg0, arg1) {
    const ret = Error(getStringFromWasm0(arg0, arg1));
    return ret;
}
export function __wbg_String_8564e559799eccda(arg0, arg1) {
    const ret = String(arg1);
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg_Window_70131fc0c91e4b3c(arg0) {
    const ret = arg0.Window;
    return ret;
}
export function __wbg_WorkerGlobalScope_601c48015b8cc78e(arg0) {
    const ret = arg0.WorkerGlobalScope;
    return ret;
}
export function __wbg___wbindgen_bigint_get_as_i64_410e28c7b761ad83(arg0, arg1) {
    const v = arg1;
    const ret = typeof(v) === 'bigint' ? v : undefined;
    getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
}
export function __wbg___wbindgen_boolean_get_2304fb8c853028c8(arg0) {
    const v = arg0;
    const ret = typeof(v) === 'boolean' ? v : undefined;
    return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
}
export function __wbg___wbindgen_debug_string_edece8177ad01481(arg0, arg1) {
    const ret = debugString(arg1);
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg___wbindgen_in_07056af4f902c445(arg0, arg1) {
    const ret = arg0 in arg1;
    return ret;
}
export function __wbg___wbindgen_is_bigint_aeae3893f30ed54e(arg0) {
    const ret = typeof(arg0) === 'bigint';
    return ret;
}
export function __wbg___wbindgen_is_function_5cd60d5cf78b4eef(arg0) {
    const ret = typeof(arg0) === 'function';
    return ret;
}
export function __wbg___wbindgen_is_null_2042690d351e14f0(arg0) {
    const ret = arg0 === null;
    return ret;
}
export function __wbg___wbindgen_is_object_b4593df85baada48(arg0) {
    const val = arg0;
    const ret = typeof(val) === 'object' && val !== null;
    return ret;
}
export function __wbg___wbindgen_is_string_dde0fd9020db4434(arg0) {
    const ret = typeof(arg0) === 'string';
    return ret;
}
export function __wbg___wbindgen_is_undefined_35bb9f4c7fd651d5(arg0) {
    const ret = arg0 === undefined;
    return ret;
}
export function __wbg___wbindgen_jsval_eq_c0ed08b3e0f393b9(arg0, arg1) {
    const ret = arg0 === arg1;
    return ret;
}
export function __wbg___wbindgen_jsval_loose_eq_0ad77b7717db155c(arg0, arg1) {
    const ret = arg0 == arg1;
    return ret;
}
export function __wbg___wbindgen_number_get_f73a1244370fcc2c(arg0, arg1) {
    const obj = arg1;
    const ret = typeof(obj) === 'number' ? obj : undefined;
    getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
}
export function __wbg___wbindgen_string_get_d109740c0d18f4d7(arg0, arg1) {
    const obj = arg1;
    const ret = typeof(obj) === 'string' ? obj : undefined;
    var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg___wbindgen_throw_9c31b086c2b26051(arg0, arg1) {
    throw new Error(getStringFromWasm0(arg0, arg1));
}
export function __wbg__wbg_cb_unref_3fa391f3fcdb55f8(arg0) {
    arg0._wbg_cb_unref();
}
export function __wbg_abort_70a701fced9ad53a() { return handleError(function (arg0) {
    arg0.abort();
}, arguments); }
export function __wbg_bound_8d5dfa042d13a74b() { return handleError(function (arg0, arg1, arg2, arg3) {
    const ret = IDBKeyRange.bound(arg0, arg1, arg2 !== 0, arg3 !== 0);
    return ret;
}, arguments); }
export function __wbg_call_13665d9f14390edc() { return handleError(function (arg0, arg1) {
    const ret = arg0.call(arg1);
    return ret;
}, arguments); }
export function __wbg_call_dfde26266607c996() { return handleError(function (arg0, arg1, arg2) {
    const ret = arg0.call(arg1, arg2);
    return ret;
}, arguments); }
export function __wbg_clear_bb1b3ff877b62598() { return handleError(function (arg0) {
    const ret = arg0.clear();
    return ret;
}, arguments); }
export function __wbg_commit_e9c1332714c53826() { return handleError(function (arg0) {
    arg0.commit();
}, arguments); }
export function __wbg_createObjectStore_7aa4cf3fcb65c75a() { return handleError(function (arg0, arg1, arg2, arg3) {
    const ret = arg0.createObjectStore(getStringFromWasm0(arg1, arg2), arg3);
    return ret;
}, arguments); }
export function __wbg_crypto_48300657fced39f9(arg0) {
    const ret = arg0.crypto;
    return ret;
}
export function __wbg_delete_bc03f88e7f14db56() { return handleError(function (arg0, arg1) {
    const ret = arg0.delete(arg1);
    return ret;
}, arguments); }
export function __wbg_done_54b8da57023b7ed2(arg0) {
    const ret = arg0.done;
    return ret;
}
export function __wbg_entries_564a7e8b1e54ede5(arg0) {
    const ret = Object.entries(arg0);
    return ret;
}
export function __wbg_error_a6fa202b58aa1cd3(arg0, arg1) {
    let deferred0_0;
    let deferred0_1;
    try {
        deferred0_0 = arg0;
        deferred0_1 = arg1;
        console.error(getStringFromWasm0(arg0, arg1));
    } finally {
        wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
    }
}
export function __wbg_error_ef9cbaece146d1d5() { return handleError(function (arg0) {
    const ret = arg0.error;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}, arguments); }
export function __wbg_getAll_a0a54eef6ac20915() { return handleError(function (arg0, arg1) {
    const ret = arg0.getAll(arg1);
    return ret;
}, arguments); }
export function __wbg_getAll_bc4f4ec6a1504163() { return handleError(function (arg0) {
    const ret = arg0.getAll();
    return ret;
}, arguments); }
export function __wbg_getDate_a52123c8affc9072(arg0) {
    const ret = arg0.getDate();
    return ret;
}
export function __wbg_getDay_50a9ee1e4d17dc24(arg0) {
    const ret = arg0.getDay();
    return ret;
}
export function __wbg_getFullYear_d5d1f7de344fdc5b(arg0) {
    const ret = arg0.getFullYear();
    return ret;
}
export function __wbg_getHours_c974d920209733e8(arg0) {
    const ret = arg0.getHours();
    return ret;
}
export function __wbg_getMinutes_e2e8ae846b37b328(arg0) {
    const ret = arg0.getMinutes();
    return ret;
}
export function __wbg_getMonth_de70091920053153(arg0) {
    const ret = arg0.getMonth();
    return ret;
}
export function __wbg_getRandomValues_15134f5c0ae6b0d0() { return handleError(function (arg0, arg1) {
    globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
}, arguments); }
export function __wbg_getRandomValues_263d0aa5464054ee() { return handleError(function (arg0, arg1) {
    arg0.getRandomValues(arg1);
}, arguments); }
export function __wbg_getSeconds_2782a558f414ec05(arg0) {
    const ret = arg0.getSeconds();
    return ret;
}
export function __wbg_getTime_09f1dd40a44edb30(arg0) {
    const ret = arg0.getTime();
    return ret;
}
export function __wbg_getTimezoneOffset_96cfb6ddebc9e5ca(arg0) {
    const ret = arg0.getTimezoneOffset();
    return ret;
}
export function __wbg_get_3e9a707ab7d352eb() { return handleError(function (arg0, arg1) {
    const ret = Reflect.get(arg0, arg1);
    return ret;
}, arguments); }
export function __wbg_get_98fdf51d029a75eb(arg0, arg1) {
    const ret = arg0[arg1 >>> 0];
    return ret;
}
export function __wbg_get_dcf82ab8aad1a593() { return handleError(function (arg0, arg1) {
    const ret = Reflect.get(arg0, arg1);
    return ret;
}, arguments); }
export function __wbg_get_unchecked_1dfe6d05ad91d9b7(arg0, arg1) {
    const ret = arg0[arg1 >>> 0];
    return ret;
}
export function __wbg_get_with_ref_key_6412cf3094599694(arg0, arg1) {
    const ret = arg0[arg1];
    return ret;
}
export function __wbg_global_e30ac0b7684506d0(arg0) {
    const ret = arg0.global;
    return ret;
}
export function __wbg_indexedDB_2e82cb845ce6b3ad() { return handleError(function (arg0) {
    const ret = arg0.indexedDB;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}, arguments); }
export function __wbg_indexedDB_a2139150e2ea2a08() { return handleError(function (arg0) {
    const ret = arg0.indexedDB;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}, arguments); }
export function __wbg_indexedDB_cbfeacc981615a77() { return handleError(function (arg0) {
    const ret = arg0.indexedDB;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}, arguments); }
export function __wbg_instanceof_ArrayBuffer_53db37b06f6b9afe(arg0) {
    let result;
    try {
        result = arg0 instanceof ArrayBuffer;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
}
export function __wbg_instanceof_DomException_bc16ce893e8c7439(arg0) {
    let result;
    try {
        result = arg0 instanceof DOMException;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
}
export function __wbg_instanceof_Error_b3f7e146d654031a(arg0) {
    let result;
    try {
        result = arg0 instanceof Error;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
}
export function __wbg_instanceof_IdbDatabase_102b0fe5255eee9c(arg0) {
    let result;
    try {
        result = arg0 instanceof IDBDatabase;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
}
export function __wbg_instanceof_IdbRequest_eef501cff5d0b7c1(arg0) {
    let result;
    try {
        result = arg0 instanceof IDBRequest;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
}
export function __wbg_instanceof_Map_16f217b9a2a08d8c(arg0) {
    let result;
    try {
        result = arg0 instanceof Map;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
}
export function __wbg_instanceof_Uint8Array_abd07d4bd221d50b(arg0) {
    let result;
    try {
        result = arg0 instanceof Uint8Array;
    } catch (_) {
        result = false;
    }
    const ret = result;
    return ret;
}
export function __wbg_isArray_94898ed3aad6947b(arg0) {
    const ret = Array.isArray(arg0);
    return ret;
}
export function __wbg_isSafeInteger_01e964d144ad3a55(arg0) {
    const ret = Number.isSafeInteger(arg0);
    return ret;
}
export function __wbg_iterator_1441b47f341dc34f() {
    const ret = Symbol.iterator;
    return ret;
}
export function __wbg_length_2591a0f4f659a55c(arg0) {
    const ret = arg0.length;
    return ret;
}
export function __wbg_length_56fcd3e2b7e0299d(arg0) {
    const ret = arg0.length;
    return ret;
}
export function __wbg_lowerBound_a64226f683db77bb() { return handleError(function (arg0, arg1) {
    const ret = IDBKeyRange.lowerBound(arg0, arg1 !== 0);
    return ret;
}, arguments); }
export function __wbg_message_324ac511aeaf710e(arg0) {
    const ret = arg0.message;
    return ret;
}
export function __wbg_message_e88a8d3ba2b91c2a(arg0, arg1) {
    const ret = arg1.message;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg_msCrypto_8c6d45a75ef1d3da(arg0) {
    const ret = arg0.msCrypto;
    return ret;
}
export function __wbg_name_fe88cfc178ec40b8(arg0, arg1) {
    const ret = arg1.name;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg_new_02d162bc6cf02f60() {
    const ret = new Object();
    return ret;
}
export function __wbg_new_070df68d66325372() {
    const ret = new Map();
    return ret;
}
export function __wbg_new_0_2722fcdb71a888a6() {
    const ret = new Date();
    return ret;
}
export function __wbg_new_1f236d63ba0c4784(arg0, arg1) {
    const ret = new Error(getStringFromWasm0(arg0, arg1));
    return ret;
}
export function __wbg_new_227d7c05414eb861() {
    const ret = new Error();
    return ret;
}
export function __wbg_new_310879b66b6e95e1() {
    const ret = new Array();
    return ret;
}
export function __wbg_new_7ddec6de44ff8f5d(arg0) {
    const ret = new Uint8Array(arg0);
    return ret;
}
export function __wbg_new_859b9002e2668e82(arg0) {
    const ret = new Date(arg0);
    return ret;
}
export function __wbg_new_from_slice_269e35316ed2d061(arg0, arg1) {
    const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
    return ret;
}
export function __wbg_new_typed_c072c4ce9a2a0cdf(arg0, arg1) {
    try {
        var state0 = {a: arg0, b: arg1};
        var cb0 = (arg0, arg1) => {
            const a = state0.a;
            state0.a = 0;
            try {
                return wasm_bindgen__convert__closures_____invoke__h2cf3f4cce3b29948(a, state0.b, arg0, arg1);
            } finally {
                state0.a = a;
            }
        };
        const ret = new Promise(cb0);
        return ret;
    } finally {
        state0.a = 0;
    }
}
export function __wbg_new_with_length_99887c91eae4abab(arg0) {
    const ret = new Uint8Array(arg0 >>> 0);
    return ret;
}
export function __wbg_new_with_year_month_day_0ccdc1cc3a42b726(arg0, arg1, arg2) {
    const ret = new Date(arg0 >>> 0, arg1, arg2);
    return ret;
}
export function __wbg_next_2a4e19f4f5083b0f(arg0) {
    const ret = arg0.next;
    return ret;
}
export function __wbg_next_6429a146bf756f93() { return handleError(function (arg0) {
    const ret = arg0.next();
    return ret;
}, arguments); }
export function __wbg_node_95beb7570492fd97(arg0) {
    const ret = arg0.node;
    return ret;
}
export function __wbg_objectStore_b28adb984a77902e() { return handleError(function (arg0, arg1, arg2) {
    const ret = arg0.objectStore(getStringFromWasm0(arg1, arg2));
    return ret;
}, arguments); }
export function __wbg_open_40ab11cdd8f5ac5a() { return handleError(function (arg0, arg1, arg2, arg3) {
    const ret = arg0.open(getStringFromWasm0(arg1, arg2), arg3 >>> 0);
    return ret;
}, arguments); }
export function __wbg_process_b2fea42461d03994(arg0) {
    const ret = arg0.process;
    return ret;
}
export function __wbg_prototypesetcall_5f9bdc8d75e07276(arg0, arg1, arg2) {
    Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
}
export function __wbg_push_b77c476b01548d0a(arg0, arg1) {
    const ret = arg0.push(arg1);
    return ret;
}
export function __wbg_put_848906967513a84d() { return handleError(function (arg0, arg1) {
    const ret = arg0.put(arg1);
    return ret;
}, arguments); }
export function __wbg_queueMicrotask_78d584b53af520f5(arg0) {
    const ret = arg0.queueMicrotask;
    return ret;
}
export function __wbg_queueMicrotask_b39ea83c7f01971a(arg0) {
    queueMicrotask(arg0);
}
export function __wbg_randomFillSync_ca9f178fb14c88cb() { return handleError(function (arg0, arg1) {
    arg0.randomFillSync(arg1);
}, arguments); }
export function __wbg_random_a8dfe52b70cb65a5() {
    const ret = Math.random();
    return ret;
}
export function __wbg_readyState_b7c530197b76b93b(arg0) {
    const ret = arg0.readyState;
    return (__wbindgen_enum_IdbRequestReadyState.indexOf(ret) + 1 || 3) - 1;
}
export function __wbg_require_7a9419e39d796c95() { return handleError(function () {
    const ret = module.require;
    return ret;
}, arguments); }
export function __wbg_resolve_d17db9352f5a220e(arg0) {
    const ret = Promise.resolve(arg0);
    return ret;
}
export function __wbg_result_c4cb33cd39c97cac() { return handleError(function (arg0) {
    const ret = arg0.result;
    return ret;
}, arguments); }
export function __wbg_set_24d0fa9e104112f9(arg0, arg1, arg2) {
    arg0.set(getArrayU8FromWasm0(arg1, arg2));
}
export function __wbg_set_6be42768c690e380(arg0, arg1, arg2) {
    arg0[arg1] = arg2;
}
export function __wbg_set_78ea6a19f4818587(arg0, arg1, arg2) {
    arg0[arg1 >>> 0] = arg2;
}
export function __wbg_set_a0e911be3da02782() { return handleError(function (arg0, arg1, arg2) {
    const ret = Reflect.set(arg0, arg1, arg2);
    return ret;
}, arguments); }
export function __wbg_set_facb7a5914e0fa39(arg0, arg1, arg2) {
    const ret = arg0.set(arg1, arg2);
    return ret;
}
export function __wbg_set_key_path_8f8e19a098d0851c(arg0, arg1) {
    arg0.keyPath = arg1;
}
export function __wbg_set_onabort_ed56d2172d920901(arg0, arg1) {
    arg0.onabort = arg1;
}
export function __wbg_set_oncomplete_3f428ec13b20d7cc(arg0, arg1) {
    arg0.oncomplete = arg1;
}
export function __wbg_set_onerror_38740b892815eedc(arg0, arg1) {
    arg0.onerror = arg1;
}
export function __wbg_set_onerror_457b093a5063c7ec(arg0, arg1) {
    arg0.onerror = arg1;
}
export function __wbg_set_onsuccess_b556141053d02ea7(arg0, arg1) {
    arg0.onsuccess = arg1;
}
export function __wbg_set_onupgradeneeded_f885fa17614acd2b(arg0, arg1) {
    arg0.onupgradeneeded = arg1;
}
export function __wbg_stack_3b0d974bbf31e44f(arg0, arg1) {
    const ret = arg1.stack;
    const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
    getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
}
export function __wbg_static_accessor_GLOBAL_THIS_02344c9b09eb08a9() {
    const ret = typeof globalThis === 'undefined' ? null : globalThis;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}
export function __wbg_static_accessor_GLOBAL_ac6d4ac874d5cd54() {
    const ret = typeof global === 'undefined' ? null : global;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}
export function __wbg_static_accessor_SELF_9b2406c23aeb2023() {
    const ret = typeof self === 'undefined' ? null : self;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}
export function __wbg_static_accessor_WINDOW_b34d2126934e16ba() {
    const ret = typeof window === 'undefined' ? null : window;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}
export function __wbg_subarray_7c6a0da8f3b4a1ba(arg0, arg1, arg2) {
    const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
    return ret;
}
export function __wbg_target_84e05e84ffc12989(arg0) {
    const ret = arg0.target;
    return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
}
export function __wbg_then_837494e384b37459(arg0, arg1) {
    const ret = arg0.then(arg1);
    return ret;
}
export function __wbg_toString_1dda136fd8f30a5f(arg0) {
    const ret = arg0.toString();
    return ret;
}
export function __wbg_transaction_213e4f585d3d1b40(arg0) {
    const ret = arg0.transaction;
    return ret;
}
export function __wbg_transaction_b7261fed68fa4264() { return handleError(function (arg0, arg1, arg2, arg3) {
    const ret = arg0.transaction(getStringFromWasm0(arg1, arg2), __wbindgen_enum_IdbTransactionMode[arg3]);
    return ret;
}, arguments); }
export function __wbg_upperBound_f7daa7529e579cfc() { return handleError(function (arg0, arg1) {
    const ret = IDBKeyRange.upperBound(arg0, arg1 !== 0);
    return ret;
}, arguments); }
export function __wbg_value_9cc0518af87a489c(arg0) {
    const ret = arg0.value;
    return ret;
}
export function __wbg_versions_215a3ab1c9d5745a(arg0) {
    const ret = arg0.versions;
    return ret;
}
export function __wbg_warn_b6f36cac66fc96a4(arg0, arg1) {
    console.warn(arg0, arg1);
}
export function __wbindgen_cast_0000000000000001(arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 1117, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__ha1c2fa93df0107f3);
    return ret;
}
export function __wbindgen_cast_0000000000000002(arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("Event")], shim_idx: 212, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__ha7903b6e296dd8f4);
    return ret;
}
export function __wbindgen_cast_0000000000000003(arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("IDBVersionChangeEvent")], shim_idx: 83, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h4381d8e749fe46cf);
    return ret;
}
export function __wbindgen_cast_0000000000000004(arg0, arg1) {
    // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 210, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
    const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__ha1b480b83daa641f);
    return ret;
}
export function __wbindgen_cast_0000000000000005(arg0) {
    // Cast intrinsic for `F64 -> Externref`.
    const ret = arg0;
    return ret;
}
export function __wbindgen_cast_0000000000000006(arg0) {
    // Cast intrinsic for `I64 -> Externref`.
    const ret = arg0;
    return ret;
}
export function __wbindgen_cast_0000000000000007(arg0, arg1) {
    // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
    const ret = getArrayU8FromWasm0(arg0, arg1);
    return ret;
}
export function __wbindgen_cast_0000000000000008(arg0, arg1) {
    // Cast intrinsic for `Ref(String) -> Externref`.
    const ret = getStringFromWasm0(arg0, arg1);
    return ret;
}
export function __wbindgen_cast_0000000000000009(arg0) {
    // Cast intrinsic for `U64 -> Externref`.
    const ret = BigInt.asUintN(64, arg0);
    return ret;
}
export function __wbindgen_init_externref_table() {
    const table = wasm.__wbindgen_externrefs;
    const offset = table.grow(4);
    table.set(0, undefined);
    table.set(offset + 0, undefined);
    table.set(offset + 1, null);
    table.set(offset + 2, true);
    table.set(offset + 3, false);
}
function wasm_bindgen__convert__closures_____invoke__ha1b480b83daa641f(arg0, arg1) {
    wasm.wasm_bindgen__convert__closures_____invoke__ha1b480b83daa641f(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__ha7903b6e296dd8f4(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures_____invoke__ha7903b6e296dd8f4(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__ha1c2fa93df0107f3(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__ha1c2fa93df0107f3(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen__convert__closures_____invoke__h4381d8e749fe46cf(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__h4381d8e749fe46cf(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen__convert__closures_____invoke__h2cf3f4cce3b29948(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen__convert__closures_____invoke__h2cf3f4cce3b29948(arg0, arg1, arg2, arg3);
}


const __wbindgen_enum_IdbRequestReadyState = ["pending", "done"];


const __wbindgen_enum_IdbTransactionMode = ["readonly", "readwrite", "versionchange", "readwriteflush", "cleanup"];

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;


let wasm;
export function __wbg_set_wasm(val) {
    wasm = val;
}
