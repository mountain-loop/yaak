"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
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

// ../../node_modules/shell-quote/quote.js
var require_quote = __commonJS({
  "../../node_modules/shell-quote/quote.js"(exports2, module2) {
    "use strict";
    module2.exports = function quote(xs) {
      return xs.map(function(s) {
        if (s === "") {
          return "''";
        }
        if (s && typeof s === "object") {
          return s.op.replace(/(.)/g, "\\$1");
        }
        if (/["\s]/.test(s) && !/'/.test(s)) {
          return "'" + s.replace(/(['\\])/g, "\\$1") + "'";
        }
        if (/["'\s]/.test(s)) {
          return '"' + s.replace(/(["\\$`!])/g, "\\$1") + '"';
        }
        return String(s).replace(/([A-Za-z]:)?([#!"$&'()*,:;<=>?@[\\\]^`{|}])/g, "$1\\$2");
      }).join(" ");
    };
  }
});

// ../../node_modules/shell-quote/parse.js
var require_parse = __commonJS({
  "../../node_modules/shell-quote/parse.js"(exports2, module2) {
    "use strict";
    var CONTROL = "(?:" + [
      "\\|\\|",
      "\\&\\&",
      ";;",
      "\\|\\&",
      "\\<\\(",
      "\\<\\<\\<",
      ">>",
      ">\\&",
      "<\\&",
      "[&;()|<>]"
    ].join("|") + ")";
    var controlRE = new RegExp("^" + CONTROL + "$");
    var META = "|&;()<> \\t";
    var SINGLE_QUOTE = '"((\\\\"|[^"])*?)"';
    var DOUBLE_QUOTE = "'((\\\\'|[^'])*?)'";
    var hash = /^#$/;
    var SQ = "'";
    var DQ = '"';
    var DS = "$";
    var TOKEN = "";
    var mult = 4294967296;
    for (i = 0; i < 4; i++) {
      TOKEN += (mult * Math.random()).toString(16);
    }
    var i;
    var startsWithToken = new RegExp("^" + TOKEN);
    function matchAll(s, r) {
      var origIndex = r.lastIndex;
      var matches = [];
      var matchObj;
      while (matchObj = r.exec(s)) {
        matches.push(matchObj);
        if (r.lastIndex === matchObj.index) {
          r.lastIndex += 1;
        }
      }
      r.lastIndex = origIndex;
      return matches;
    }
    function getVar(env, pre, key) {
      var r = typeof env === "function" ? env(key) : env[key];
      if (typeof r === "undefined" && key != "") {
        r = "";
      } else if (typeof r === "undefined") {
        r = "$";
      }
      if (typeof r === "object") {
        return pre + TOKEN + JSON.stringify(r) + TOKEN;
      }
      return pre + r;
    }
    function parseInternal(string, env, opts) {
      if (!opts) {
        opts = {};
      }
      var BS = opts.escape || "\\";
      var BAREWORD = "(\\" + BS + `['"` + META + `]|[^\\s'"` + META + "])+";
      var chunker = new RegExp([
        "(" + CONTROL + ")",
        // control chars
        "(" + BAREWORD + "|" + SINGLE_QUOTE + "|" + DOUBLE_QUOTE + ")+"
      ].join("|"), "g");
      var matches = matchAll(string, chunker);
      if (matches.length === 0) {
        return [];
      }
      if (!env) {
        env = {};
      }
      var commented = false;
      return matches.map(function(match) {
        var s = match[0];
        if (!s || commented) {
          return void 0;
        }
        if (controlRE.test(s)) {
          return { op: s };
        }
        var quote = false;
        var esc = false;
        var out = "";
        var isGlob = false;
        var i2;
        function parseEnvVar() {
          i2 += 1;
          var varend;
          var varname;
          var char = s.charAt(i2);
          if (char === "{") {
            i2 += 1;
            if (s.charAt(i2) === "}") {
              throw new Error("Bad substitution: " + s.slice(i2 - 2, i2 + 1));
            }
            varend = s.indexOf("}", i2);
            if (varend < 0) {
              throw new Error("Bad substitution: " + s.slice(i2));
            }
            varname = s.slice(i2, varend);
            i2 = varend;
          } else if (/[*@#?$!_-]/.test(char)) {
            varname = char;
            i2 += 1;
          } else {
            var slicedFromI = s.slice(i2);
            varend = slicedFromI.match(/[^\w\d_]/);
            if (!varend) {
              varname = slicedFromI;
              i2 = s.length;
            } else {
              varname = slicedFromI.slice(0, varend.index);
              i2 += varend.index - 1;
            }
          }
          return getVar(env, "", varname);
        }
        for (i2 = 0; i2 < s.length; i2++) {
          var c = s.charAt(i2);
          isGlob = isGlob || !quote && (c === "*" || c === "?");
          if (esc) {
            out += c;
            esc = false;
          } else if (quote) {
            if (c === quote) {
              quote = false;
            } else if (quote == SQ) {
              out += c;
            } else {
              if (c === BS) {
                i2 += 1;
                c = s.charAt(i2);
                if (c === DQ || c === BS || c === DS) {
                  out += c;
                } else {
                  out += BS + c;
                }
              } else if (c === DS) {
                out += parseEnvVar();
              } else {
                out += c;
              }
            }
          } else if (c === DQ || c === SQ) {
            quote = c;
          } else if (controlRE.test(c)) {
            return { op: s };
          } else if (hash.test(c)) {
            commented = true;
            var commentObj = { comment: string.slice(match.index + i2 + 1) };
            if (out.length) {
              return [out, commentObj];
            }
            return [commentObj];
          } else if (c === BS) {
            esc = true;
          } else if (c === DS) {
            out += parseEnvVar();
          } else {
            out += c;
          }
        }
        if (isGlob) {
          return { op: "glob", pattern: out };
        }
        return out;
      }).reduce(function(prev, arg) {
        return typeof arg === "undefined" ? prev : prev.concat(arg);
      }, []);
    }
    module2.exports = function parse2(s, env, opts) {
      var mapped = parseInternal(s, env, opts);
      if (typeof env !== "function") {
        return mapped;
      }
      return mapped.reduce(function(acc, s2) {
        if (typeof s2 === "object") {
          return acc.concat(s2);
        }
        var xs = s2.split(RegExp("(" + TOKEN + ".*?" + TOKEN + ")", "g"));
        if (xs.length === 1) {
          return acc.concat(xs[0]);
        }
        return acc.concat(xs.filter(Boolean).map(function(x) {
          if (startsWithToken.test(x)) {
            return JSON.parse(x.split(TOKEN)[1]);
          }
          return x;
        }));
      }, []);
    };
  }
});

// ../../node_modules/shell-quote/index.js
var require_shell_quote = __commonJS({
  "../../node_modules/shell-quote/index.js"(exports2) {
    "use strict";
    exports2.quote = require_quote();
    exports2.parse = require_parse();
  }
});

// src/index.ts
var src_exports = {};
__export(src_exports, {
  convertCurl: () => convertCurl,
  plugin: () => plugin
});
module.exports = __toCommonJS(src_exports);
var import_shell_quote = __toESM(require_shell_quote());
var DATA_FLAGS = ["d", "data", "data-raw", "data-urlencode", "data-binary", "data-ascii"];
var SUPPORTED_FLAGS = [
  ["cookie", "b"],
  ["d", "data"],
  // Add url encoded data
  ["data-ascii"],
  ["data-binary"],
  ["data-raw"],
  ["data-urlencode"],
  ["digest"],
  // Apply auth as digest
  ["form", "F"],
  // Add multipart data
  ["get", "G"],
  // Put the post data in the URL
  ["header", "H"],
  ["request", "X"],
  // Request method
  ["url"],
  // Specify the URL explicitly
  ["url-query"],
  ["user", "u"],
  // Authentication
  DATA_FLAGS
].flatMap((v) => v);
var BOOLEAN_FLAGS = ["G", "get", "digest"];
var plugin = {
  importer: {
    name: "cURL",
    description: "Import cURL commands",
    onImport(_ctx, args) {
      return convertCurl(args.text);
    }
  }
};
function convertCurl(rawData) {
  if (!rawData.match(/^\s*curl /)) {
    return null;
  }
  const commands = [];
  const normalizedData = rawData.replace(/\ncurl/g, "; curl");
  let currentCommand = [];
  const parsed = (0, import_shell_quote.parse)(normalizedData);
  const normalizedParseEntries = parsed.flatMap((entry) => {
    if (typeof entry === "string" && entry.startsWith("-") && !entry.startsWith("--") && entry.length > 2) {
      return [entry.slice(0, 2), entry.slice(2)];
    }
    return entry;
  });
  for (const parseEntry of normalizedParseEntries) {
    if (typeof parseEntry === "string") {
      if (parseEntry.startsWith("$")) {
        currentCommand.push(parseEntry.slice(1));
      } else {
        currentCommand.push(parseEntry);
      }
      continue;
    }
    if ("comment" in parseEntry) {
      continue;
    }
    const { op } = parseEntry;
    if (op === ";") {
      commands.push(currentCommand);
      currentCommand = [];
      continue;
    }
    if (op?.startsWith("$")) {
      const str = op.slice(2, op.length - 1).replace(/\\'/g, "'");
      currentCommand.push(str);
      continue;
    }
    if (op === "glob") {
      currentCommand.push(parseEntry.pattern);
    }
  }
  commands.push(currentCommand);
  const workspace = {
    model: "workspace",
    id: generateId("workspace"),
    name: "Curl Import"
  };
  const requests = commands.filter((command) => command[0] === "curl").map((v) => importCommand(v, workspace.id));
  return {
    resources: {
      httpRequests: requests,
      workspaces: [workspace]
    }
  };
}
function importCommand(parseEntries, workspaceId) {
  const flagsByName = {};
  const singletons = [];
  for (let i = 1; i < parseEntries.length; i++) {
    let parseEntry = parseEntries[i];
    if (typeof parseEntry === "string") {
      parseEntry = parseEntry.trim();
    }
    if (typeof parseEntry === "string" && parseEntry.match(/^-{1,2}[\w-]+/)) {
      const isSingleDash = parseEntry[0] === "-" && parseEntry[1] !== "-";
      let name = parseEntry.replace(/^-{1,2}/, "");
      if (!SUPPORTED_FLAGS.includes(name)) {
        continue;
      }
      let value;
      const nextEntry = parseEntries[i + 1];
      const hasValue = !BOOLEAN_FLAGS.includes(name);
      if (isSingleDash && name.length > 1) {
        value = name.slice(1);
        name = name.slice(0, 1);
      } else if (typeof nextEntry === "string" && hasValue && !nextEntry.startsWith("-")) {
        value = nextEntry;
        i++;
      } else {
        value = true;
      }
      flagsByName[name] = flagsByName[name] || [];
      flagsByName[name].push(value);
    } else if (parseEntry) {
      singletons.push(parseEntry);
    }
  }
  let urlParameters;
  let url;
  const urlArg = getPairValue(flagsByName, singletons[0] || "", ["url"]);
  const [baseUrl, search] = splitOnce(urlArg, "?");
  urlParameters = search?.split("&").map((p) => {
    const v = splitOnce(p, "=");
    return { name: decodeURIComponent(v[0] ?? ""), value: decodeURIComponent(v[1] ?? ""), enabled: true };
  }) ?? [];
  url = baseUrl ?? urlArg;
  for (const p of flagsByName["url-query"] ?? []) {
    if (typeof p !== "string") {
      continue;
    }
    const [name, value] = p.split("=");
    urlParameters.push({
      name: name ?? "",
      value: value ?? "",
      enabled: true
    });
  }
  const [username, password] = getPairValue(flagsByName, "", ["u", "user"]).split(/:(.*)$/);
  const isDigest = getPairValue(flagsByName, false, ["digest"]);
  const authenticationType = username ? isDigest ? "digest" : "basic" : null;
  const authentication = username ? {
    username: username.trim(),
    password: (password ?? "").trim()
  } : {};
  const headers = [
    ...flagsByName["header"] || [],
    ...flagsByName["H"] || []
  ].map((header) => {
    const [name, value] = header.split(/:(.*)$/);
    if (!value) {
      return {
        name: (name ?? "").trim().replace(/;$/, ""),
        value: "",
        enabled: true
      };
    }
    return {
      name: (name ?? "").trim(),
      value: value.trim(),
      enabled: true
    };
  });
  const cookieHeaderValue = [
    ...flagsByName["cookie"] || [],
    ...flagsByName["b"] || []
  ].map((str) => {
    const name = str.split("=", 1)[0];
    const value = str.replace(`${name}=`, "");
    return `${name}=${value}`;
  }).join("; ");
  const existingCookieHeader = headers.find((header) => header.name.toLowerCase() === "cookie");
  if (cookieHeaderValue && existingCookieHeader) {
    existingCookieHeader.value += `; ${cookieHeaderValue}`;
  } else if (cookieHeaderValue) {
    headers.push({
      name: "Cookie",
      value: cookieHeaderValue,
      enabled: true
    });
  }
  const dataParameters = pairsToDataParameters(flagsByName);
  const contentTypeHeader = headers.find((header) => header.name.toLowerCase() === "content-type");
  const mimeType = contentTypeHeader ? contentTypeHeader.value.split(";")[0] : null;
  const formDataParams = [
    ...flagsByName["form"] || [],
    ...flagsByName["F"] || []
  ].map((str) => {
    const parts = str.split("=");
    const name = parts[0] ?? "";
    const value = parts[1] ?? "";
    const item = {
      name,
      enabled: true
    };
    if (value.indexOf("@") === 0) {
      item["file"] = value.slice(1);
    } else {
      item["value"] = value;
    }
    return item;
  });
  let body = {};
  let bodyType = null;
  const bodyAsGET = getPairValue(flagsByName, false, ["G", "get"]);
  if (dataParameters.length > 0 && bodyAsGET) {
    urlParameters.push(...dataParameters);
  } else if (dataParameters.length > 0 && (mimeType == null || mimeType === "application/x-www-form-urlencoded")) {
    bodyType = mimeType ?? "application/x-www-form-urlencoded";
    body = {
      form: dataParameters.map((parameter) => ({
        ...parameter,
        name: decodeURIComponent(parameter.name || ""),
        value: decodeURIComponent(parameter.value || "")
      }))
    };
    headers.push({
      name: "Content-Type",
      value: "application/x-www-form-urlencoded",
      enabled: true
    });
  } else if (dataParameters.length > 0) {
    bodyType = mimeType === "application/json" || mimeType === "text/xml" || mimeType === "text/plain" ? mimeType : "other";
    body = {
      text: dataParameters.map(({ name, value }) => name && value ? `${name}=${value}` : name || value).join("&")
    };
  } else if (formDataParams.length) {
    bodyType = mimeType ?? "multipart/form-data";
    body = {
      form: formDataParams
    };
    if (mimeType == null) {
      headers.push({
        name: "Content-Type",
        value: "multipart/form-data",
        enabled: true
      });
    }
  }
  let method = getPairValue(flagsByName, "", ["X", "request"]).toUpperCase();
  if (method === "" && body) {
    method = "text" in body || "form" in body ? "POST" : "GET";
  }
  const request = {
    id: generateId("http_request"),
    model: "http_request",
    workspaceId,
    name: "",
    urlParameters,
    url,
    method,
    headers,
    authentication,
    authenticationType,
    body,
    bodyType,
    folderId: null,
    sortPriority: 0
  };
  return request;
}
function pairsToDataParameters(keyedPairs) {
  let dataParameters = [];
  for (const flagName of DATA_FLAGS) {
    const pairs = keyedPairs[flagName];
    if (!pairs || pairs.length === 0) {
      continue;
    }
    for (const p of pairs) {
      if (typeof p !== "string") continue;
      const [name, value] = p.split("=");
      if (p.startsWith("@")) {
        dataParameters.push({
          name: name ?? "",
          value: "",
          filePath: p.slice(1),
          enabled: true
        });
      } else {
        dataParameters.push({
          name: name ?? "",
          value: flagName === "data-urlencode" ? encodeURIComponent(value ?? "") : value ?? "",
          enabled: true
        });
      }
    }
  }
  return dataParameters;
}
var getPairValue = (pairsByName, defaultValue, names) => {
  for (const name of names) {
    if (pairsByName[name] && pairsByName[name].length) {
      return pairsByName[name][0];
    }
  }
  return defaultValue;
};
function splitOnce(str, sep) {
  const index = str.indexOf(sep);
  if (index > -1) {
    return [str.slice(0, index), str.slice(index + 1)];
  }
  return [str];
}
var idCount = {};
function generateId(model) {
  idCount[model] = (idCount[model] ?? -1) + 1;
  return `GENERATE_ID::${model.toUpperCase()}_${idCount[model]}`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  convertCurl,
  plugin
});
