const fs = require("node:fs");
const path = require("node:path");

const cliReadme = path.join(__dirname, "..", "..", "crates-cli", "yaak-cli", "README.md");
fs.copyFileSync(cliReadme, path.join(__dirname, "README.md"));
