const sharedConfig = require("@yaakapp-internal/tailwind-config");

/** @type {import('tailwindcss').Config} */
module.exports = {
  ...sharedConfig,
  content: [
    "./*.{html,ts,tsx}",
    "./commands/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./init/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./routes/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
};
