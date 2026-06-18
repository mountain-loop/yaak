import type { HttpRequest } from "@yaakapp-internal/models";
import type { RenderPurpose } from "@yaakapp-internal/plugins";
import { activeEnvironmentAtom } from "../hooks/useActiveEnvironment";
import { copyToClipboard } from "./copy";
import { invokeCmd } from "./tauri";
import { jotaiStore } from "./jotai";
import { showToast } from "./toast";

const NEWLINE = "\\\n ";

export async function requestToCurl(
  request: HttpRequest,
  purpose: RenderPurpose = "send",
): Promise<string> {
  const environmentId = jotaiStore.get(activeEnvironmentAtom)?.id ?? null;
  const renderedRequest = await invokeCmd<HttpRequest>("cmd_render_http_request", {
    httpRequest: request,
    environmentId,
    purpose,
  });
  return convertToCurl(renderedRequest);
}

export async function copyRequestAsCurl(request: HttpRequest): Promise<void> {
  try {
    copyToClipboard(await requestToCurl(request));
  } catch (err) {
    console.error(err);
    showToast({
      id: "failed-to-copy-curl",
      color: "danger",
      icon: "copy",
      message: "Failed to copy curl command",
    });
  }
}

export function convertToCurl(request: Partial<HttpRequest>) {
  const xs = ["curl"];
  const authentication = request.authentication as Record<string, unknown> | undefined;

  if (request.method) xs.push("-X", request.method);

  let finalUrl = request.url || "";
  const urlParams = (request.urlParameters ?? []).filter(onlyEnabled);
  if (urlParams.length > 0) {
    const [base, hash] = finalUrl.split("#");
    const separator = base?.includes("?") ? "&" : "?";
    const queryString = urlParams
      .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`)
      .join("&");
    finalUrl = base + separator + queryString + (hash ? `#${hash}` : "");
  }

  if (request.authenticationType === "apikey") {
    if (authentication?.location === "query") {
      const sep = finalUrl.includes("?") ? "&" : "?";
      finalUrl = [
        finalUrl,
        sep,
        encodeURIComponent(String(authentication?.key ?? "token")),
        "=",
        encodeURIComponent(String(authentication?.value ?? "")),
      ].join("");
    } else {
      request.headers = request.headers ?? [];
      request.headers.push({
        name: String(authentication?.key ?? "X-Api-Key"),
        value: String(authentication?.value ?? ""),
        enabled: true,
        id: "",
      });
    }
  }

  xs.push(quote(finalUrl));
  xs.push(NEWLINE);

  for (const h of (request.headers ?? []).filter(onlyEnabled)) {
    xs.push("--header", quote(`${h.name}: ${h.value}`));
    xs.push(NEWLINE);
  }

  const type = request.bodyType ?? "none";
  if (
    (type === "multipart/form-data" || type === "application/x-www-form-urlencoded") &&
    Array.isArray(request.body?.form)
  ) {
    const flag = request.bodyType === "multipart/form-data" ? "--form" : "--data";
    for (const p of (request.body.form ?? []).filter(onlyEnabled)) {
      if (p.file) {
        let v = `${p.name}=@${p.file}`;
        v += p.contentType ? `;type=${p.contentType}` : "";
        xs.push(flag, v);
      } else {
        xs.push(flag, quote(`${p.name}=${p.value}`));
      }
      xs.push(NEWLINE);
    }
  } else if (type === "graphql" && typeof request.body?.query === "string") {
    const body = {
      query: request.body.query || "",
      variables: maybeParseJSON(request.body.variables, undefined),
    };
    xs.push("--data", quote(JSON.stringify(body)));
    xs.push(NEWLINE);
  } else if (type !== "none" && typeof request.body?.text === "string") {
    xs.push("--data", quote(request.body.text));
    xs.push(NEWLINE);
  }

  if (authentication?.disabled !== true) {
    if (request.authenticationType === "basic" || request.authenticationType === "digest") {
      if (request.authenticationType === "digest") xs.push("--digest");
      xs.push(
        "--user",
        quote(
          `${String(authentication?.username ?? "")}:${String(authentication?.password ?? "")}`,
        ),
      );
      xs.push(NEWLINE);
    }

    if (request.authenticationType === "bearer") {
      const value =
        `${String(authentication?.prefix ?? "Bearer")} ${String(authentication?.token ?? "")}`.trim();
      xs.push("--header", quote(`Authorization: ${value}`));
      xs.push(NEWLINE);
    }

    if (request.authenticationType === "auth-aws-sig-v4") {
      xs.push(
        "--aws-sigv4",
        [
          "aws",
          "amz",
          String(authentication?.region ?? ""),
          String(authentication?.service ?? ""),
        ].join(":"),
      );
      xs.push(NEWLINE);
      xs.push(
        "--user",
        quote(
          `${String(authentication?.accessKeyId ?? "")}:${String(
            authentication?.secretAccessKey ?? "",
          )}`,
        ),
      );
      if (authentication?.sessionToken) {
        xs.push(NEWLINE);
        xs.push("--header", quote(`X-Amz-Security-Token: ${String(authentication.sessionToken)}`));
      }
      xs.push(NEWLINE);
    }
  }

  if (xs[xs.length - 1] === NEWLINE) {
    xs.splice(xs.length - 1, 1);
  }

  return xs.join(" ");
}

function quote(arg: string): string {
  const escaped = arg.replace(/'/g, "\\'");
  return `'${escaped}'`;
}

function onlyEnabled(v: { name?: string; enabled?: boolean }): boolean {
  return v.enabled !== false && !!v.name;
}

function maybeParseJSON<T>(v: string, fallback: T) {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}
