// Adds missing `resolved` URLs to package-lock.json for nested workspace deps.
// npm omits these fields for some packages (see https://github.com/npm/cli/issues/4460),
// which breaks offline installs. This script constructs the URL from the package
// name and version without requiring network access.

const fs = require("fs");

const p = process.argv[2] || "package-lock.json";
const d = JSON.parse(fs.readFileSync(p, "utf-8"));

for (const [name, info] of Object.entries(d.packages || {})) {
  if (!name || info.link || info.resolved) continue;
  if (!name.includes("node_modules/") || !info.version) continue;
  const pkg = name.split("node_modules/").pop();
  const base = pkg.split("/").pop();
  info.resolved =
    "https://registry.npmjs.org/" + pkg + "/-/" + base + "-" + info.version + ".tgz";
}

fs.writeFileSync(p, JSON.stringify(d, null, 2));
