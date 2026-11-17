import classNames from "classnames";
import { useMemo } from "react";
import type { JSX } from "react/jsx-runtime";
import { CountBadge } from "../CountBadge";
import { DetailsBanner } from "../DetailsBanner";
import { useEditorHost } from "../EditorHost";
import { KeyValueRows } from "../KeyValueRow";
import { KeyValueRow } from "./ResponseHeaders";
import type { HttpResponseView } from "./types";

interface Props {
  response: HttpResponseView;
  /** Only the cookies sent or only those received, for a pane that shows one side */
  side?: "sent" | "received";
}

interface ParsedCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  maxAge?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
  isDeleted?: boolean;
}

function parseCookieHeader(cookieHeader: string): Array<{ name: string; value: string }> {
  // Parse "Cookie: name=value; name2=value2" format
  return cookieHeader.split(";").map((pair) => {
    const [name = "", ...valueParts] = pair.split("=");
    return {
      name: name.trim(),
      value: valueParts.join("=").trim(),
    };
  });
}

function parseSetCookieHeader(setCookieHeader: string): ParsedCookie {
  // Parse "Set-Cookie: name=value; Domain=...; Path=..." format
  const parts = setCookieHeader.split(";").map((p) => p.trim());
  const [nameValue = "", ...attributes] = parts;
  const [name = "", ...valueParts] = nameValue.split("=");

  const cookie: ParsedCookie = {
    name: name.trim(),
    value: valueParts.join("=").trim(),
  };

  for (const attr of attributes) {
    const [key = "", val] = attr.split("=").map((s) => s.trim());
    const lowerKey = key.toLowerCase();

    if (lowerKey === "domain") cookie.domain = val;
    else if (lowerKey === "path") cookie.path = val;
    else if (lowerKey === "expires") cookie.expires = val;
    else if (lowerKey === "max-age") cookie.maxAge = val;
    else if (lowerKey === "secure") cookie.secure = true;
    else if (lowerKey === "httponly") cookie.httpOnly = true;
    else if (lowerKey === "samesite") cookie.sameSite = val;
  }

  // Detect if cookie is being deleted
  if (cookie.maxAge !== undefined) {
    const maxAgeNum = Number.parseInt(cookie.maxAge, 10);
    if (!Number.isNaN(maxAgeNum) && maxAgeNum <= 0) {
      cookie.isDeleted = true;
    }
  } else if (cookie.expires !== undefined) {
    // Check if expires date is in the past
    try {
      const expiresDate = new Date(cookie.expires);
      if (expiresDate.getTime() < Date.now()) {
        cookie.isDeleted = true;
      }
    } catch {
      // Invalid date, ignore
    }
  }

  return cookie;
}

/** The cookies a response's headers sent and received, the latest value of each name winning */
export function parseCookieHeaders({ sent, received }: HttpResponseView["cookieHeaders"]) {
  const sentMap = new Map<string, { name: string; value: string }>();
  const receivedMap = new Map<string, ParsedCookie>();

  for (const header of sent) {
    for (const cookie of parseCookieHeader(header)) {
      sentMap.set(cookie.name, cookie);
    }
  }
  for (const header of received) {
    const cookie = parseSetCookieHeader(header);
    receivedMap.set(cookie.name, cookie);
  }

  return {
    sentCookies: Array.from(sentMap.values()),
    receivedCookies: Array.from(receivedMap.values()),
  };
}

export function ResponseCookies({ response, side }: Props) {
  const { useDetailsBannerStoredValue } = useEditorHost();
  const { sentCookies, receivedCookies } = useMemo(
    () => parseCookieHeaders(response.cookieHeaders),
    [response.cookieHeaders],
  );

  return (
    <div className="overflow-auto h-full pb-4 gap-y-3 flex flex-col pr-0.5">
      {side !== "received" && (
      <DetailsBanner
        defaultOpen
        useStoredValue={useDetailsBannerStoredValue}
        storageKey={`${response.ownerId}.sent_cookies`}
        summary={
          <h2 className="flex items-center">
            Sent Cookies <CountBadge showZero count={sentCookies.length} />
          </h2>
        }
      >
        {sentCookies.length === 0 ? (
          <NoCookies />
        ) : (
          <KeyValueRows>
            {sentCookies.map((cookie, i) => (
              // oxlint-disable-next-line react/no-array-index-key
              <KeyValueRow labelColor="primary" key={i} label={cookie.name}>
                {cookie.value}
              </KeyValueRow>
            ))}
          </KeyValueRows>
        )}
      </DetailsBanner>
      )}

      {side !== "sent" && (
      <DetailsBanner
        defaultOpen
        useStoredValue={useDetailsBannerStoredValue}
        storageKey={`${response.ownerId}.received_cookies`}
        summary={
          <h2 className="flex items-center">
            Received Cookies <CountBadge showZero count={receivedCookies.length} />
          </h2>
        }
      >
        {receivedCookies.length === 0 ? (
          <NoCookies />
        ) : (
          <div className="flex flex-col gap-4">
            {receivedCookies.map((cookie, i) => (
              // oxlint-disable-next-line react/no-array-index-key
              <div key={i} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 my-1">
                  <span
                    className={classNames(
                      "font-mono text-editor select-auto cursor-auto",
                      cookie.isDeleted ? "line-through opacity-60 text-text-subtle" : "text-text",
                    )}
                  >
                    {cookie.name}
                    <span className="text-text-subtlest select-auto cursor-auto mx-0.5">=</span>
                    {cookie.value}
                  </span>
                  {cookie.isDeleted && (
                    <span className="text-xs font-sans text-danger bg-danger/10 px-1.5 py-0.5 rounded-sm">
                      Deleted
                    </span>
                  )}
                </div>
                <KeyValueRows>
                  {[
                    cookie.domain && (
                      <KeyValueRow labelColor="info" label="Domain" key="domain">
                        {cookie.domain}
                      </KeyValueRow>
                    ),
                    cookie.path && (
                      <KeyValueRow labelColor="info" label="Path" key="path">
                        {cookie.path}
                      </KeyValueRow>
                    ),
                    cookie.expires && (
                      <KeyValueRow labelColor="info" label="Expires" key="expires">
                        {cookie.expires}
                      </KeyValueRow>
                    ),
                    cookie.maxAge && (
                      <KeyValueRow labelColor="info" label="Max-Age" key="maxAge">
                        {cookie.maxAge}
                      </KeyValueRow>
                    ),
                    cookie.secure && (
                      <KeyValueRow labelColor="info" label="Secure" key="secure">
                        true
                      </KeyValueRow>
                    ),
                    cookie.httpOnly && (
                      <KeyValueRow labelColor="info" label="HttpOnly" key="httpOnly">
                        true
                      </KeyValueRow>
                    ),
                    cookie.sameSite && (
                      <KeyValueRow labelColor="info" label="SameSite" key="sameSite">
                        {cookie.sameSite}
                      </KeyValueRow>
                    ),
                  ].filter((item): item is JSX.Element => Boolean(item))}
                </KeyValueRows>
              </div>
            ))}
          </div>
        )}
      </DetailsBanner>
      )}
    </div>
  );
}

function NoCookies() {
  return <span className="text-text-subtlest text-sm italic">No Cookies</span>;
}
