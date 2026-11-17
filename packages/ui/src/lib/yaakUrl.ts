/**
 * Whether a link goes to Yaak's own site: https, on `yaak.app` or one of its subdomains. Parsed
 * rather than matched on the prefix, which `https://yaak.app.evil.com` would pass.
 */
export function isYaakUrl(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" && (url.hostname === "yaak.app" || url.hostname.endsWith(".yaak.app"))
  );
}
