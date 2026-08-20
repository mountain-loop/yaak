// Round-trip harness: import a spec with the local importer plugin, send every
// request through the real Yaak CLI pipeline against a Prism mock of the same
// spec, and report Prism's validation verdict for each request.
//
// Prism independently validates each incoming request against the spec (paths,
// required parameters, body schemas, security), so a violation here is an
// importer bug found by a second OpenAPI implementation rather than a snapshot
// of our own output.
//
// Usage: node tests/roundtrip.mjs [spec.yaml ...]
//   YAAK_BIN=/path/to/yaak overrides the CLI (defaults to the repo debug build,
//   which embeds the plugins vendored from this checkout).

import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const yaakBin = process.env.YAAK_BIN ?? path.join(repoRoot, "target/debug/yaak");
const specs =
  process.argv.length > 2
    ? process.argv.slice(2)
    : [
        path.join(here, "fixtures/petstore.yaml"),
        ...fs
          .readdirSync(path.join(here, "fixtures/real-world"))
          .filter((f) => f.endsWith(".yaml"))
          .map((f) => path.join(here, "fixtures/real-world", f)),
      ];

if (!fs.existsSync(yaakBin)) {
  console.error(`Yaak CLI not found at ${yaakBin}. Build it with: cargo build -p yaak-cli`);
  process.exit(2);
}

// Pinned so local runs and CI judge against the same validator
const PRISM_PACKAGE = "@stoplight/prism-cli@5.15.11";

// Accepted spec-quality gray zones, not importer bugs. httpbin's required
// `url` query parameter has no example, and an empty value is preferable to
// inventing fake query data even though Prism counts it as missing.
const KNOWN_FLAGS = new Set(["httpbin.yaml GET ${[baseUrl]}/redirect-to"]);

function yaak(dataDir, args) {
  return execFileSync(yaakBin, ["--data-dir", dataDir, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function yaakJson(dataDir, args) {
  return JSON.parse(yaak(dataDir, args));
}

function listIds(output) {
  return output
    .split("\n")
    .map((line) => line.match(/^(\w+_\w+) - /)?.[1])
    .filter(Boolean);
}

async function startPrism(spec, port) {
  for (let attempt = 0; attempt < 20; attempt++, port++) {
    const prism = spawn(
      "npx",
      ["-y", PRISM_PACKAGE, "mock", "--errors", "-p", String(port), "-h", "127.0.0.1", spec],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let log = "";
    prism.stdout.on("data", (d) => (log += d));
    prism.stderr.on("data", (d) => (log += d));
    // Generous: the first run downloads Prism through npx
    const deadline = Date.now() + 120_000;
    let failed = false;
    while (Date.now() < deadline) {
      if (log.includes("Prism is listening")) return { prism, port, getLog: () => log };
      if (log.includes("EADDRINUSE") || prism.exitCode != null) {
        failed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    prism.kill();
    if (failed) {
      // The exit can be observed before its buffered stderr arrives; wait for
      // the streams to close so the bind error is distinguishable
      await Promise.race([
        new Promise((r) => prism.once("close", r)),
        new Promise((r) => setTimeout(r, 2000)),
      ]);
      if (log.includes("EADDRINUSE")) continue;
      throw new Error(`Prism exited:\n${log}`);
    }
    throw new Error(`Prism did not start in time:\n${log}`);
  }
  throw new Error("No free port found for Prism");
}

function pointVariablesAtPrism(variables, prismUrl) {
  return variables.map((v) => {
    if (v.name === "baseUrl" || v.name.startsWith("serverUrl")) return { ...v, value: prismUrl };
    if (v.name === "baseUrlOrigin") return { ...v, value: prismUrl };
    if (v.value === "") return { ...v, value: "test-value" };
    return v;
  });
}

// Prism reports its verdict in the sl-violations response header. Violations
// located in the request are importer bugs; violations located in the response
// mean Prism could not fabricate a spec-valid mock response (the spec's own
// examples are broken), which says nothing about the import.
function classify(response, bodyText) {
  if (response.error) return { verdict: "SEND ERROR", detail: response.error };

  const violationsHeader = (response.headers ?? []).find(
    (h) => h.name?.toLowerCase() === "sl-violations",
  );
  let violations = [];
  try {
    violations = JSON.parse(violationsHeader?.value ?? "[]");
  } catch {}
  const requestViolations = violations.filter((v) => v.location?.[0] === "request");
  const detail = requestViolations.map((v) => `${v.location.join(".")}: ${v.message}`).join("; ");

  if (requestViolations.length > 0) return { verdict: "VIOLATION", detail };

  // A spec-defined error response (e.g. an operation whose only response is a
  // 405) mocks as that status with no Prism error type; only Prism's own error
  // bodies mark a request Prism could not accept.
  let body = null;
  try {
    body = JSON.parse(bodyText);
  } catch {}
  const prismError =
    typeof body?.type === "string" && body.type.includes("stoplight.io/prism/errors")
      ? body.type.split("#")[1]
      : null;
  if (prismError == null) return { verdict: "ok", detail: "" };

  // Failures to fabricate a mock response say nothing about the request we sent
  if (prismError === "NO_COMPLEX_OBJECT_TEXT" || prismError === "NO_RESPONSE_DEFINED") {
    return { verdict: "ok", detail: "" };
  }

  const bodyViolations = Array.isArray(body.validation)
    ? body.validation.filter((v) => v.location?.[0] === "request")
    : [];
  if (prismError === "VIOLATIONS" && bodyViolations.length === 0) {
    return { verdict: "ok", detail: "" }; // response-side only
  }
  return {
    verdict:
      prismError === "VIOLATIONS" || prismError === "UNPROCESSABLE_ENTITY"
        ? "VIOLATION"
        : prismError.includes("MATCHED")
          ? "NO ROUTE"
          : prismError === "UNAUTHORIZED"
            ? "SECURITY"
            : prismError,
    detail:
      bodyViolations.map((v) => `${v.location.join(".")}: ${v.message}`).join("; ") ||
      body.detail ||
      "",
  };
}

let totalProblems = 0;
let port = 4010;

for (const spec of specs) {
  const name = path.basename(spec);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "yaak-roundtrip-"));
  console.log(`\n=== ${name} ===`);

  try {
    yaak(dataDir, ["import", spec]);
    const workspaceId = listIds(yaak(dataDir, ["workspace", "list"]))[0];
    if (workspaceId == null) {
      console.log("  IMPORT PRODUCED NO WORKSPACE");
      totalProblems++;
      continue;
    }
    // Prism mocks redirect responses without a Location header; following them
    // would fail the send for a reason unrelated to the import. Workspace-level
    // OAuth2 gets the same dummy-bearer treatment as request-level below.
    const workspace = yaakJson(dataDir, ["workspace", "show", workspaceId]);
    yaak(dataDir, [
      "workspace",
      "update",
      "--json",
      JSON.stringify({
        id: workspaceId,
        settingFollowRedirects: false,
        ...(workspace.authenticationType === "oauth2"
          ? {
              authenticationType: "bearer",
              authentication: { token: "test-token", prefix: "Bearer" },
            }
          : {}),
      }),
    ]);

    const { prism, port: boundPort, getLog } = await startPrism(spec, port);
    port = boundPort + 1;
    try {
      const prismUrl = `http://127.0.0.1:${boundPort}`;
      const environmentIds = listIds(yaak(dataDir, ["environment", "list", workspaceId]));
      let activeEnvironment = null;
      for (const id of environmentIds) {
        const environment = yaakJson(dataDir, ["environment", "show", id]);
        yaak(dataDir, [
          "environment",
          "update",
          "--json",
          JSON.stringify({
            id,
            variables: pointVariablesAtPrism(environment.variables ?? [], prismUrl),
          }),
        ]);
        if (environment.parentModel === "environment" && activeEnvironment == null) {
          activeEnvironment = id;
        }
      }

      const requestIds = listIds(yaak(dataDir, ["request", "list", workspaceId]));
      const requests = new Map();
      for (const id of requestIds) {
        const request = yaakJson(dataDir, ["request", "show", id]);
        requests.set(id, request);
        // OAuth2 would try to fetch a real token; Prism only checks that the
        // Authorization header is present, so a dummy bearer keeps it satisfied.
        if (request.authenticationType === "oauth2") {
          yaak(dataDir, [
            "request",
            "update",
            "--json",
            JSON.stringify({
              id,
              authenticationType: "bearer",
              authentication: { token: "test-token", prefix: "Bearer" },
            }),
          ]);
        }
      }

      const sendArgs = ["send", workspaceId];
      if (activeEnvironment != null) sendArgs.push("-e", activeEnvironment);
      try {
        yaak(dataDir, sendArgs);
      } catch {
        // Individual send failures surface per-request below.
      }

      let problems = 0;
      for (const id of requestIds) {
        const request = requests.get(id);
        const label = `${request.method} ${request.url}`;
        let response = null;
        let bodyText = "";
        try {
          response = yaakJson(dataDir, ["response", "show", id]);
          try {
            bodyText = yaak(dataDir, ["response", "body", id]);
          } catch {}
        } catch {
          console.log(`  NEVER SENT   ${label}`);
          problems++;
          continue;
        }
        const { verdict, detail } = classify(response, bodyText);
        if (verdict === "ok") continue;
        if (KNOWN_FLAGS.has(`${name} ${label}`)) {
          console.log(`  known        ${label}`);
          continue;
        }
        problems++;
        console.log(`  ${verdict.padEnd(12)} ${label}`);
        console.log(`               sent: ${response.url ?? "?"}`);
        if (detail) console.log(`               ${detail}`);
      }

      const requestCount = requestIds.length;
      if (problems === 0) {
        console.log(`  all ${requestCount} requests validated clean against the mock`);
      } else {
        console.log(`  ${problems}/${requestCount} requests flagged`);
        totalProblems += problems;
      }
      const inputWarnings = getLog()
        .split("\n")
        .filter((l) => l.includes("[VALIDATOR]") && !l.includes("output"));
      if (inputWarnings.length > 0) {
        console.log(`  prism validator log lines: ${inputWarnings.length}`);
      }
    } finally {
      prism.kill();
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

process.exit(totalProblems > 0 ? 1 : 0);
