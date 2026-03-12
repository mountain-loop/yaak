const sharedConfig = require("@yaakapp-internal/tailwind-config");

/** @type {import('tailwindcss').Config} */
module.exports = {
  ...sharedConfig,
  content: ["./**/*.{html,ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
};
