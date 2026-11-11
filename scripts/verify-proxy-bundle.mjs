#!/usr/bin/env node

/**
 * Checks a built Yaak Proxy bundle before it ships: its version and architecture, the
 * privileged helper and its LaunchDaemon plist where `SMAppService` looks for them, and every
 * signature. With `--signed`, also that the app and helper are signed by the same Developer ID
 * team with the hardened runtime, that the app meets the requirement the helper holds callers
 * to, and that Gatekeeper accepts the notarized, stapled app. Without it (an ad-hoc local
 * build) the signatures need only be intact.
 *
 *   node scripts/verify-proxy-bundle.mjs "<path>/Yaak Proxy.app" \
 *     [--version 2026.11.0] [--arch arm64|x86_64] [--signed] [--team ABCDE12345]
 *
 * Registers nothing: `--helper-status` only asks `SMAppService` what it knows.
 */

import { spawnSync } from "child_process";
import { existsSync, statSync } from "fs";
import path from "path";
import { parseArgs } from "util";

const APP_IDENTIFIER = "app.yaak.proxy";
const HELPER_LABEL = "app.yaak.proxy.helper";
const HELPER_PROGRAM = "Contents/MacOS/yaak-proxy-helper";
const HELPER_PLIST = `Contents/Library/LaunchDaemons/${HELPER_LABEL}.plist`;
const MAIN_PROGRAM = "Contents/MacOS/yaak-app-proxy";
const PROTOC = "Contents/Resources/vendored/protoc/yaakprotoc";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    version: { type: "string" },
    arch: { type: "string" },
    signed: { type: "boolean", default: false },
    team: { type: "string" },
  },
});

const app = positionals[0];
if (app == null || !existsSync(app)) {
  console.error(`No app bundle at ${app ?? "(none given)"}`);
  process.exit(2);
}

const failures = [];
function check(ok, what) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
}

/** Runs a tool and returns its exit status and output, stderr included, as codesign writes there */
function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: "utf8" });
  const error = result.error ? `${result.error.message}\n` : "";
  return { status: result.status, out: `${error}${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function plistValue(file, key, format = "raw") {
  const { status, out } = run("plutil", ["-extract", key, format, "-o", "-", file]);
  return status === 0 ? out.trim() : null;
}

/** What `codesign -dv` says of a signature, by its keys: TeamIdentifier, Identifier, flags… */
function signature(file) {
  const { status, out } = run("codesign", ["-dvvv", file]);
  const info = { status, authorities: /** @type {string[]} */ ([]) };
  for (const line of out.split("\n")) {
    const match = line.match(/^(\w+)=(.*)$/);
    if (match == null) continue;
    if (match[1] === "Authority") info.authorities.push(match[2]);
    else info[match[1]] = match[2];
  }
  const flags = out.match(/flags=0x[0-9a-f]+\(([^)]*)\)/);
  info.flags = flags ? flags[1].split(",") : [];
  return info;
}

const at = (relative) => path.join(app, relative);
const infoPlist = at("Contents/Info.plist");

// The app itself
const identifier = plistValue(infoPlist, "CFBundleIdentifier");
check(identifier === APP_IDENTIFIER, `bundle identifier is ${APP_IDENTIFIER} (${identifier})`);
const version = plistValue(infoPlist, "CFBundleShortVersionString");
if (values.version != null) {
  const expected = values.version.replace(/^v/, "");
  // macOS takes the release part of a prerelease version as its short version
  check(
    version === expected || version === expected.split("-")[0],
    `version is ${expected} (${version})`,
  );
}
check(version !== "0.0.0", `version is not the unset 0.0.0 (${version})`);

// The helper and its plist, where SMAppService.daemon(plistName:) expects them
const helper = at(HELPER_PROGRAM);
const helperPlist = at(HELPER_PLIST);
check(existsSync(helper) && (statSync(helper).mode & 0o111) !== 0, `helper at ${HELPER_PROGRAM}`);
check(existsSync(helperPlist), `helper plist at ${HELPER_PLIST}`);
if (existsSync(helperPlist)) {
  check(plistValue(helperPlist, "Label") === HELPER_LABEL, `plist Label is ${HELPER_LABEL}`);
  check(
    plistValue(helperPlist, "BundleProgram") === HELPER_PROGRAM,
    `plist BundleProgram is ${HELPER_PROGRAM}`,
  );
  const associated = JSON.parse(
    plistValue(helperPlist, "AssociatedBundleIdentifiers", "json") ?? "[]",
  );
  check(
    associated.includes(identifier),
    `plist AssociatedBundleIdentifiers includes the app's ${identifier}`,
  );
}

// Built for the architecture asked for
if (values.arch != null) {
  for (const file of [MAIN_PROGRAM, HELPER_PROGRAM]) {
    const { out } = run("lipo", ["-archs", at(file)]);
    check(
      out.split(/\s+/).includes(values.arch),
      `${file} is built for ${values.arch} (${out.trim()})`,
    );
  }
}

// What SMAppService makes of the bundled plist, without registering anything. An Intel build
// on an Apple silicon runner without Rosetta can't run, so it is only reported as skipped.
const helperStatus = run(at(MAIN_PROGRAM), ["--helper-status"]);
if (helperStatus.status !== 0 && /bad cpu type|EBADARCH/i.test(helperStatus.out)) {
  console.log(`skip --helper-status: this Mac can't run ${values.arch ?? "this"} code`);
} else {
  console.log(helperStatus.out.trim().replace(/^/gm, "     "));
  check(helperStatus.status === 0, "--helper-status runs");
  check(!/^plist: none/m.test(helperStatus.out), "the app finds its helper plist");
  if (values.signed) {
    check(
      /^state: (NotRegistered|RequiresApproval|Enabled)$/m.test(helperStatus.out),
      "SMAppService knows the helper",
    );
  }
}

// Signatures
const deep = run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
check(deep.status === 0, `codesign --verify --deep --strict\n${deep.out.trim()}`);

if (values.signed) {
  const appSig = signature(app);
  const helperSig = signature(helper);
  const protocSig = signature(at(PROTOC));
  const team = appSig.TeamIdentifier;
  check(
    team != null && team !== "not set" && /^[A-Z0-9]{10}$/.test(team),
    `app is signed by a team (${team})`,
  );
  if (values.team != null) {
    check(team === values.team, `app team is the helper's built-in team ${values.team} (${team})`);
  }
  check(
    appSig.authorities.some((a) => a.startsWith("Developer ID Application:")),
    `app is signed with a Developer ID Application identity (${appSig.authorities[0] ?? "none"})`,
  );
  check(appSig.flags.includes("runtime"), "app has the hardened runtime");
  check(
    helperSig.TeamIdentifier === team,
    `helper is signed by the app's team (${helperSig.TeamIdentifier})`,
  );
  check(helperSig.flags.includes("runtime"), "helper has the hardened runtime");
  check(
    protocSig.TeamIdentifier === team,
    `protoc is signed by the app's team (${protocSig.TeamIdentifier})`,
  );
  check(protocSig.flags.includes("runtime"), "protoc has the hardened runtime");

  // The requirement the helper holds its callers to (yaak-proxy-helper's code_requirement)
  const requirement = `anchor apple generic and (identifier "${APP_IDENTIFIER}") and certificate leaf[subject.OU] = "${values.team ?? team}"`;
  const meets = run("codesign", ["--verify", `-R=${requirement}`, app]);
  check(meets.status === 0, `app meets the helper's caller requirement\n${meets.out.trim()}`);

  const gatekeeper = run("spctl", ["--assess", "--type", "execute", "--verbose=4", app]);
  check(gatekeeper.status === 0, `spctl --assess accepts the app\n${gatekeeper.out.trim()}`);
  const stapled = run("xcrun", ["stapler", "validate", app]);
  check(stapled.status === 0, `notarization ticket is stapled\n${stapled.out.trim()}`);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
