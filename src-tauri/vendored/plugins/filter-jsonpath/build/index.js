"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  pluginHookResponseFilter: () => pluginHookResponseFilter
});
module.exports = __toCommonJS(src_exports);

// ../../node_modules/jsonpath-plus/dist/index-node-esm.js
var import_vm = __toESM(require("vm"), 1);
var {
  hasOwnProperty: hasOwnProp
} = Object.prototype;
function push(arr, item) {
  arr = arr.slice();
  arr.push(item);
  return arr;
}
function unshift(item, arr) {
  arr = arr.slice();
  arr.unshift(item);
  return arr;
}
var NewError = class extends Error {
  /**
   * @param {AnyResult} value The evaluated scalar value
   */
  constructor(value) {
    super('JSONPath should not be called with "new" (it prevents return of (unwrapped) scalar values)');
    this.avoidNew = true;
    this.value = value;
    this.name = "NewError";
  }
};
function JSONPath(opts, expr, obj, callback, otherTypeCallback) {
  if (!(this instanceof JSONPath)) {
    try {
      return new JSONPath(opts, expr, obj, callback, otherTypeCallback);
    } catch (e) {
      if (!e.avoidNew) {
        throw e;
      }
      return e.value;
    }
  }
  if (typeof opts === "string") {
    otherTypeCallback = callback;
    callback = obj;
    obj = expr;
    expr = opts;
    opts = null;
  }
  const optObj = opts && typeof opts === "object";
  opts = opts || {};
  this.json = opts.json || obj;
  this.path = opts.path || expr;
  this.resultType = opts.resultType || "value";
  this.flatten = opts.flatten || false;
  this.wrap = hasOwnProp.call(opts, "wrap") ? opts.wrap : true;
  this.sandbox = opts.sandbox || {};
  this.eval = opts.eval === void 0 ? "safe" : opts.eval;
  this.ignoreEvalErrors = typeof opts.ignoreEvalErrors === "undefined" ? false : opts.ignoreEvalErrors;
  this.parent = opts.parent || null;
  this.parentProperty = opts.parentProperty || null;
  this.callback = opts.callback || callback || null;
  this.otherTypeCallback = opts.otherTypeCallback || otherTypeCallback || function() {
    throw new TypeError("You must supply an otherTypeCallback callback option with the @other() operator.");
  };
  if (opts.autostart !== false) {
    const args = {
      path: optObj ? opts.path : expr
    };
    if (!optObj) {
      args.json = obj;
    } else if ("json" in opts) {
      args.json = opts.json;
    }
    const ret = this.evaluate(args);
    if (!ret || typeof ret !== "object") {
      throw new NewError(ret);
    }
    return ret;
  }
}
JSONPath.prototype.evaluate = function(expr, json, callback, otherTypeCallback) {
  let currParent = this.parent, currParentProperty = this.parentProperty;
  let {
    flatten,
    wrap
  } = this;
  this.currResultType = this.resultType;
  this.currEval = this.eval;
  this.currSandbox = this.sandbox;
  callback = callback || this.callback;
  this.currOtherTypeCallback = otherTypeCallback || this.otherTypeCallback;
  json = json || this.json;
  expr = expr || this.path;
  if (expr && typeof expr === "object" && !Array.isArray(expr)) {
    if (!expr.path && expr.path !== "") {
      throw new TypeError('You must supply a "path" property when providing an object argument to JSONPath.evaluate().');
    }
    if (!hasOwnProp.call(expr, "json")) {
      throw new TypeError('You must supply a "json" property when providing an object argument to JSONPath.evaluate().');
    }
    ({
      json
    } = expr);
    flatten = hasOwnProp.call(expr, "flatten") ? expr.flatten : flatten;
    this.currResultType = hasOwnProp.call(expr, "resultType") ? expr.resultType : this.currResultType;
    this.currSandbox = hasOwnProp.call(expr, "sandbox") ? expr.sandbox : this.currSandbox;
    wrap = hasOwnProp.call(expr, "wrap") ? expr.wrap : wrap;
    this.currEval = hasOwnProp.call(expr, "eval") ? expr.eval : this.currEval;
    callback = hasOwnProp.call(expr, "callback") ? expr.callback : callback;
    this.currOtherTypeCallback = hasOwnProp.call(expr, "otherTypeCallback") ? expr.otherTypeCallback : this.currOtherTypeCallback;
    currParent = hasOwnProp.call(expr, "parent") ? expr.parent : currParent;
    currParentProperty = hasOwnProp.call(expr, "parentProperty") ? expr.parentProperty : currParentProperty;
    expr = expr.path;
  }
  currParent = currParent || null;
  currParentProperty = currParentProperty || null;
  if (Array.isArray(expr)) {
    expr = JSONPath.toPathString(expr);
  }
  if (!expr && expr !== "" || !json) {
    return void 0;
  }
  const exprList = JSONPath.toPathArray(expr);
  if (exprList[0] === "$" && exprList.length > 1) {
    exprList.shift();
  }
  this._hasParentSelector = null;
  const result = this._trace(exprList, json, ["$"], currParent, currParentProperty, callback).filter(function(ea) {
    return ea && !ea.isParentSelector;
  });
  if (!result.length) {
    return wrap ? [] : void 0;
  }
  if (!wrap && result.length === 1 && !result[0].hasArrExpr) {
    return this._getPreferredOutput(result[0]);
  }
  return result.reduce((rslt, ea) => {
    const valOrPath = this._getPreferredOutput(ea);
    if (flatten && Array.isArray(valOrPath)) {
      rslt = rslt.concat(valOrPath);
    } else {
      rslt.push(valOrPath);
    }
    return rslt;
  }, []);
};
JSONPath.prototype._getPreferredOutput = function(ea) {
  const resultType = this.currResultType;
  switch (resultType) {
    case "all": {
      const path = Array.isArray(ea.path) ? ea.path : JSONPath.toPathArray(ea.path);
      ea.pointer = JSONPath.toPointer(path);
      ea.path = typeof ea.path === "string" ? ea.path : JSONPath.toPathString(ea.path);
      return ea;
    }
    case "value":
    case "parent":
    case "parentProperty":
      return ea[resultType];
    case "path":
      return JSONPath.toPathString(ea[resultType]);
    case "pointer":
      return JSONPath.toPointer(ea.path);
    default:
      throw new TypeError("Unknown result type");
  }
};
JSONPath.prototype._handleCallback = function(fullRetObj, callback, type) {
  if (callback) {
    const preferredOutput = this._getPreferredOutput(fullRetObj);
    fullRetObj.path = typeof fullRetObj.path === "string" ? fullRetObj.path : JSONPath.toPathString(fullRetObj.path);
    callback(preferredOutput, type, fullRetObj);
  }
};
JSONPath.prototype._trace = function(expr, val, path, parent, parentPropName, callback, hasArrExpr, literalPriority) {
  let retObj;
  if (!expr.length) {
    retObj = {
      path,
      value: val,
      parent,
      parentProperty: parentPropName,
      hasArrExpr
    };
    this._handleCallback(retObj, callback, "value");
    return retObj;
  }
  const loc = expr[0], x = expr.slice(1);
  const ret = [];
  function addRet(elems) {
    if (Array.isArray(elems)) {
      elems.forEach((t) => {
        ret.push(t);
      });
    } else {
      ret.push(elems);
    }
  }
  if ((typeof loc !== "string" || literalPriority) && val && hasOwnProp.call(val, loc)) {
    addRet(this._trace(x, val[loc], push(path, loc), val, loc, callback, hasArrExpr));
  } else if (loc === "*") {
    this._walk(val, (m) => {
      addRet(this._trace(x, val[m], push(path, m), val, m, callback, true, true));
    });
  } else if (loc === "..") {
    addRet(this._trace(x, val, path, parent, parentPropName, callback, hasArrExpr));
    this._walk(val, (m) => {
      if (typeof val[m] === "object") {
        addRet(this._trace(expr.slice(), val[m], push(path, m), val, m, callback, true));
      }
    });
  } else if (loc === "^") {
    this._hasParentSelector = true;
    return {
      path: path.slice(0, -1),
      expr: x,
      isParentSelector: true
    };
  } else if (loc === "~") {
    retObj = {
      path: push(path, loc),
      value: parentPropName,
      parent,
      parentProperty: null
    };
    this._handleCallback(retObj, callback, "property");
    return retObj;
  } else if (loc === "$") {
    addRet(this._trace(x, val, path, null, null, callback, hasArrExpr));
  } else if (/^(-?\d*):(-?\d*):?(\d*)$/u.test(loc)) {
    addRet(this._slice(loc, x, val, path, parent, parentPropName, callback));
  } else if (loc.indexOf("?(") === 0) {
    if (this.currEval === false) {
      throw new Error("Eval [?(expr)] prevented in JSONPath expression.");
    }
    const safeLoc = loc.replace(/^\?\((.*?)\)$/u, "$1");
    const nested = /@.?([^?]*)[['](\??\(.*?\))(?!.\)\])[\]']/gu.exec(safeLoc);
    if (nested) {
      this._walk(val, (m) => {
        const npath = [nested[2]];
        const nvalue = nested[1] ? val[m][nested[1]] : val[m];
        const filterResults = this._trace(npath, nvalue, path, parent, parentPropName, callback, true);
        if (filterResults.length > 0) {
          addRet(this._trace(x, val[m], push(path, m), val, m, callback, true));
        }
      });
    } else {
      this._walk(val, (m) => {
        if (this._eval(safeLoc, val[m], m, path, parent, parentPropName)) {
          addRet(this._trace(x, val[m], push(path, m), val, m, callback, true));
        }
      });
    }
  } else if (loc[0] === "(") {
    if (this.currEval === false) {
      throw new Error("Eval [(expr)] prevented in JSONPath expression.");
    }
    addRet(this._trace(unshift(this._eval(loc, val, path[path.length - 1], path.slice(0, -1), parent, parentPropName), x), val, path, parent, parentPropName, callback, hasArrExpr));
  } else if (loc[0] === "@") {
    let addType = false;
    const valueType = loc.slice(1, -2);
    switch (valueType) {
      case "scalar":
        if (!val || !["object", "function"].includes(typeof val)) {
          addType = true;
        }
        break;
      case "boolean":
      case "string":
      case "undefined":
      case "function":
        if (typeof val === valueType) {
          addType = true;
        }
        break;
      case "integer":
        if (Number.isFinite(val) && !(val % 1)) {
          addType = true;
        }
        break;
      case "number":
        if (Number.isFinite(val)) {
          addType = true;
        }
        break;
      case "nonFinite":
        if (typeof val === "number" && !Number.isFinite(val)) {
          addType = true;
        }
        break;
      case "object":
        if (val && typeof val === valueType) {
          addType = true;
        }
        break;
      case "array":
        if (Array.isArray(val)) {
          addType = true;
        }
        break;
      case "other":
        addType = this.currOtherTypeCallback(val, path, parent, parentPropName);
        break;
      case "null":
        if (val === null) {
          addType = true;
        }
        break;
      default:
        throw new TypeError("Unknown value type " + valueType);
    }
    if (addType) {
      retObj = {
        path,
        value: val,
        parent,
        parentProperty: parentPropName
      };
      this._handleCallback(retObj, callback, "value");
      return retObj;
    }
  } else if (loc[0] === "`" && val && hasOwnProp.call(val, loc.slice(1))) {
    const locProp = loc.slice(1);
    addRet(this._trace(x, val[locProp], push(path, locProp), val, locProp, callback, hasArrExpr, true));
  } else if (loc.includes(",")) {
    const parts = loc.split(",");
    for (const part of parts) {
      addRet(this._trace(unshift(part, x), val, path, parent, parentPropName, callback, true));
    }
  } else if (!literalPriority && val && hasOwnProp.call(val, loc)) {
    addRet(this._trace(x, val[loc], push(path, loc), val, loc, callback, hasArrExpr, true));
  }
  if (this._hasParentSelector) {
    for (let t = 0; t < ret.length; t++) {
      const rett = ret[t];
      if (rett && rett.isParentSelector) {
        const tmp = this._trace(rett.expr, val, rett.path, parent, parentPropName, callback, hasArrExpr);
        if (Array.isArray(tmp)) {
          ret[t] = tmp[0];
          const tl = tmp.length;
          for (let tt = 1; tt < tl; tt++) {
            t++;
            ret.splice(t, 0, tmp[tt]);
          }
        } else {
          ret[t] = tmp;
        }
      }
    }
  }
  return ret;
};
JSONPath.prototype._walk = function(val, f) {
  if (Array.isArray(val)) {
    const n = val.length;
    for (let i = 0; i < n; i++) {
      f(i);
    }
  } else if (val && typeof val === "object") {
    Object.keys(val).forEach((m) => {
      f(m);
    });
  }
};
JSONPath.prototype._slice = function(loc, expr, val, path, parent, parentPropName, callback) {
  if (!Array.isArray(val)) {
    return void 0;
  }
  const len = val.length, parts = loc.split(":"), step = parts[2] && Number.parseInt(parts[2]) || 1;
  let start = parts[0] && Number.parseInt(parts[0]) || 0, end = parts[1] && Number.parseInt(parts[1]) || len;
  start = start < 0 ? Math.max(0, start + len) : Math.min(len, start);
  end = end < 0 ? Math.max(0, end + len) : Math.min(len, end);
  const ret = [];
  for (let i = start; i < end; i += step) {
    const tmp = this._trace(unshift(i, expr), val, path, parent, parentPropName, callback, true);
    tmp.forEach((t) => {
      ret.push(t);
    });
  }
  return ret;
};
JSONPath.prototype._eval = function(code, _v, _vname, path, parent, parentPropName) {
  this.currSandbox._$_parentProperty = parentPropName;
  this.currSandbox._$_parent = parent;
  this.currSandbox._$_property = _vname;
  this.currSandbox._$_root = this.json;
  this.currSandbox._$_v = _v;
  const containsPath = code.includes("@path");
  if (containsPath) {
    this.currSandbox._$_path = JSONPath.toPathString(path.concat([_vname]));
  }
  const scriptCacheKey = this.currEval + "Script:" + code;
  if (!JSONPath.cache[scriptCacheKey]) {
    let script = code.replace(/@parentProperty/gu, "_$_parentProperty").replace(/@parent/gu, "_$_parent").replace(/@property/gu, "_$_property").replace(/@root/gu, "_$_root").replace(/@([.\s)[])/gu, "_$_v$1");
    if (containsPath) {
      script = script.replace(/@path/gu, "_$_path");
    }
    if (this.currEval === "safe" || this.currEval === true || this.currEval === void 0) {
      JSONPath.cache[scriptCacheKey] = new this.safeVm.Script(script);
    } else if (this.currEval === "native") {
      JSONPath.cache[scriptCacheKey] = new this.vm.Script(script);
    } else if (typeof this.currEval === "function" && this.currEval.prototype && hasOwnProp.call(this.currEval.prototype, "runInNewContext")) {
      const CurrEval = this.currEval;
      JSONPath.cache[scriptCacheKey] = new CurrEval(script);
    } else if (typeof this.currEval === "function") {
      JSONPath.cache[scriptCacheKey] = {
        runInNewContext: (context) => this.currEval(script, context)
      };
    } else {
      throw new TypeError(`Unknown "eval" property "${this.currEval}"`);
    }
  }
  try {
    return JSONPath.cache[scriptCacheKey].runInNewContext(this.currSandbox);
  } catch (e) {
    if (this.ignoreEvalErrors) {
      return false;
    }
    throw new Error("jsonPath: " + e.message + ": " + code);
  }
};
JSONPath.cache = {};
JSONPath.toPathString = function(pathArr) {
  const x = pathArr, n = x.length;
  let p = "$";
  for (let i = 1; i < n; i++) {
    if (!/^(~|\^|@.*?\(\))$/u.test(x[i])) {
      p += /^[0-9*]+$/u.test(x[i]) ? "[" + x[i] + "]" : "['" + x[i] + "']";
    }
  }
  return p;
};
JSONPath.toPointer = function(pointer) {
  const x = pointer, n = x.length;
  let p = "";
  for (let i = 1; i < n; i++) {
    if (!/^(~|\^|@.*?\(\))$/u.test(x[i])) {
      p += "/" + x[i].toString().replace(/~/gu, "~0").replace(/\//gu, "~1");
    }
  }
  return p;
};
JSONPath.toPathArray = function(expr) {
  const {
    cache
  } = JSONPath;
  if (cache[expr]) {
    return cache[expr].concat();
  }
  const subx = [];
  const normalized = expr.replace(/@(?:null|boolean|number|string|integer|undefined|nonFinite|scalar|array|object|function|other)\(\)/gu, ";$&;").replace(/[['](\??\(.*?\))[\]'](?!.\])/gu, function($0, $1) {
    return "[#" + (subx.push($1) - 1) + "]";
  }).replace(/\[['"]([^'\]]*)['"]\]/gu, function($0, prop) {
    return "['" + prop.replace(/\./gu, "%@%").replace(/~/gu, "%%@@%%") + "']";
  }).replace(/~/gu, ";~;").replace(/['"]?\.['"]?(?![^[]*\])|\[['"]?/gu, ";").replace(/%@%/gu, ".").replace(/%%@@%%/gu, "~").replace(/(?:;)?(\^+)(?:;)?/gu, function($0, ups) {
    return ";" + ups.split("").join(";") + ";";
  }).replace(/;;;|;;/gu, ";..;").replace(/;$|'?\]|'$/gu, "");
  const exprList = normalized.split(";").map(function(exp) {
    const match = exp.match(/#(\d+)/u);
    return !match || !match[1] ? exp : subx[match[1]];
  });
  cache[expr] = exprList;
  return cache[expr].concat();
};
JSONPath.prototype.vm = import_vm.default;
JSONPath.prototype.safeVm = import_vm.default;
var SafeScript = import_vm.default.Script;

// src/index.ts
function pluginHookResponseFilter(_ctx, args) {
  const parsed = JSON.parse(args.body);
  const filtered = JSONPath({ path: args.filter, json: parsed });
  return JSON.stringify(filtered, null, 2);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  pluginHookResponseFilter
});
