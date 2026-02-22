const fs = require("node:fs");
const path = require("node:path");

const readme = path.join(__dirname, "..", "..", "README.md");
fs.copyFileSync(readme, path.join(__dirname, "README.md"));
