import { shellQuote } from "./curl";

/** The shells the terminal environment is written for */
export type TerminalShell = "posix" | "fish" | "powershell" | "cmd";

export const TERMINAL_SHELLS: { value: TerminalShell; label: string }[] = [
  { value: "posix", label: "bash / zsh" },
  { value: "fish", label: "fish" },
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "cmd" },
];

/** The shell a platform's terminal opens by default */
export function defaultShell(osType: string | null | undefined): TerminalShell {
  return osType === "windows" ? "powershell" : "posix";
}

/**
 * The variables that send one terminal's traffic through the proxy on `port` and trust its CA
 * at `caPath`, for tools that read neither the system proxy nor the login keychain: Node,
 * Python, and anything built on OpenSSL.
 */
export function environmentVars(port: number, caPath: string): [string, string][] {
  const proxy = `http://127.0.0.1:${port}`;
  return [
    ["HTTP_PROXY", proxy],
    ["HTTPS_PROXY", proxy],
    // curl reads only the lowercase name for plain HTTP.
    ["http_proxy", proxy],
    ["https_proxy", proxy],
    ["SSL_CERT_FILE", caPath],
    ["NODE_EXTRA_CA_CERTS", caPath],
    ["REQUESTS_CA_BUNDLE", caPath],
  ];
}

/** The variables as `shell` sets them, one a line */
export function environmentBlock(shell: TerminalShell, port: number, caPath: string): string {
  return environmentVars(port, caPath)
    .map(([name, value]) => setLine(shell, name, value))
    .join("\n");
}

function setLine(shell: TerminalShell, name: string, value: string): string {
  switch (shell) {
    case "posix":
      return `export ${name}=${SAFE.test(value) ? value : shellQuote(value)}`;
    case "fish":
      return `set -gx ${name} ${fishQuote(value)}`;
    case "powershell":
      return `$env:${name} = '${value.replaceAll("'", "''")}'`;
    case "cmd":
      // The quotes around the pair keep spaces and stop at the closing one, unlike `set A="b"`
      return `set "${name}=${value}"`;
  }
}

/** Needs no quotes in any POSIX shell or fish */
const SAFE = /^[\w@%+=:,./-]+$/;

/** Fish quotes like the POSIX shells, except a backslash and a quote escape inside single quotes */
function fishQuote(value: string): string {
  if (SAFE.test(value)) return value;
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

/** Shell exports for bash and zsh, as the palette and Settings copy them */
export function environmentExports(port: number, caPath: string): string {
  return environmentBlock("posix", port, caPath);
}
