import type { HeaderValuePreset } from "./headerValuePresets";

// Common, real-world User-Agent strings. The short `label` is shown in the
// dropdown/autocomplete, while the full UA string is what gets inserted.
export const userAgents: HeaderValuePreset[] = [
  {
    label: "Chrome 120 · Windows 10/11 · x64",
    value:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },
  {
    label: "Edge 120 · Windows 10/11 · x64",
    value:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  },
  {
    label: "Firefox 121 · Windows 10/11 · x64",
    value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  },
  {
    label: "Chrome 120 · macOS",
    value:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },
  {
    label: "Safari 17.1 · macOS",
    value:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
  },
  {
    label: "Chrome 120 · Linux · x64",
    value:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },
  {
    label: "Safari 17.1 · iOS 17 · iPhone",
    value:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
  },
  {
    label: "Chrome 120 · Android 14 · Pixel 8",
    value:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  },
  { label: "curl 8.4.0 · CLI", value: "curl/8.4.0" },
  { label: "Postman 7.36 · API client", value: "PostmanRuntime/7.36.0" },
  { label: "Insomnia 8.0 · API client", value: "insomnia/8.0.0" },
];
