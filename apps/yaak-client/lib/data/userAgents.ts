import type { HeaderValuePreset } from "./headerValuePresets";

// Common, real-world User-Agent strings. The short `label` is shown in the
// dropdown/autocomplete, while the full UA string is what gets inserted.
//
// Browsers freeze parts of their UA: Chrome reports its minor version as 0.0.0
// and Safari reports macOS as 10_15_7, regardless of the actual version.
export const userAgents: HeaderValuePreset[] = [
  {
    label: "Chrome 151 · Windows 10/11 · x64",
    value:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  },
  {
    label: "Edge 151 · Windows 10/11 · x64",
    value:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0",
  },
  {
    label: "Firefox 153 · Windows 10/11 · x64",
    value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0",
  },
  {
    label: "Chrome 151 · macOS",
    value:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  },
  {
    label: "Safari 27 · macOS",
    value:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15",
  },
  {
    label: "Chrome 151 · Linux · x64",
    value:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  },
  {
    label: "Safari 27 · iOS 27 · iPhone",
    value:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1",
  },
  {
    label: "Chrome 151 · Android 16 · Pixel 10",
    value:
      "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36",
  },
  { label: "curl 8.21.0 · CLI", value: "curl/8.21.0" },
  { label: "Postman 7.56 · API client", value: "PostmanRuntime/7.56.1" },
  { label: "Insomnia 13.1 · API client", value: "insomnia/13.1.0" },
];
