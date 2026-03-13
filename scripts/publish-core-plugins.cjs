const { readdirSync } = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const pluginsDir = path.join(__dirname, "..", "plugins");

console.log("Publishing core Yaak plugins");

for (const name of readdirSync(pluginsDir)) {
  const dir = path.join(pluginsDir, name);
  if (name.startsWith(".")) continue;
  console.log("Building plugin", dir);
  execSync("npm run build", { stdio: "inherit", cwd: dir });
  execSync("yaakcli publish", {
    stdio: "inherit",
    cwd: dir,
    env: { ...process.env, ENVIRONMENT: "development" },
  });
}
