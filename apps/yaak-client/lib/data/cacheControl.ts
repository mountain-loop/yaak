// Common Cache-Control directives (request and response).
export const cacheControlDirectives = [
  "no-cache",
  "no-store",
  "no-transform",
  "max-age=0",
  "max-age=3600",
  "max-age=86400",
  "s-maxage=3600",
  "must-revalidate",
  "proxy-revalidate",
  "stale-while-revalidate=60",
  "public",
  "private",
  "immutable",
];
