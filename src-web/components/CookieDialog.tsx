import type { Cookie, CookieDomain, CookieJar } from "@yaakapp-internal/models";
import { cookieJarsAtom, patchModelById } from "@yaakapp-internal/models";
import { useAtomValue } from "jotai";
import { cookieDomain } from "../lib/model_util";
import { showPromptForm } from "../lib/prompt-form";
import { Banner } from "./core/Banner";
import { IconButton } from "./core/IconButton";
import { InlineCode } from "./core/InlineCode";

interface Props {
  cookieJarId: string | null;
}

async function showAddCookieForm(cookieJarId: string): Promise<void> {
  const result = await showPromptForm({
    id: "add-cookie",
    title: "Add Cookie",
    size: "md",
    inputs: [
      {
        name: "cookie_pairs",
        label: "Cookie Attributes",
        type: "key_value",
        description:
          "Add key-value pairs for the cookie. These will be combined into the cookie string.",
      },
      {
        name: "domain_value",
        label: "Domain",
        type: "text",
        placeholder: "example.com",
      },
      {
        name: "hostOnly",
        label: "Host Only",
        type: "checkbox",
        defaultValue: "true",
        description:
          "If enabled, cookie is restricted to the exact host. Otherwise, it applies to the domain and its subdomains.",
      },
      {
        name: "path",
        label: "Path",
        type: "text",
        placeholder: "/",
        defaultValue: "/",
      },
      {
        name: "secure",
        label: "Secure",
        type: "checkbox",
        defaultValue: "true",
        description: "If enabled, cookie will only be sent over HTTPS connections.",
      },
    ],
  });

  if (result == null) return;

  // Parse the form results
  const cookie_pairs_raw = result.cookie_pairs;
  const domain_value = (result.domain_value as string) ?? "";
  const path = (result.path as string) ?? "/";
  const hostOnly = (result.hostOnly as string) === "true";
  const secure = (result.secure as string) === "true";

  // Convert key-value pairs to raw_cookie string format: key1=value1;key2=value2
  // Parse cookie_pairs - it comes as a JSON string from the key_value input
  let parsedPairs: Array<{ name: string; value: string }> = [];
  try {
    // Handle null, undefined, or string value
    const pairsStr =
      typeof cookie_pairs_raw === "string"
        ? cookie_pairs_raw
        : cookie_pairs_raw != null
          ? JSON.stringify(cookie_pairs_raw)
          : "[]";
    if (pairsStr && pairsStr !== "") {
      parsedPairs = JSON.parse(pairsStr);
    }
  } catch {
    parsedPairs = [];
  }

  const validPairs = parsedPairs.filter((p) => p?.name?.trim());
  // Ensure at least one valid pair exists
  if (validPairs.length === 0) {
    console.log("No valid cookie pairs provided");
    return;
  }

  const raw_cookie = validPairs.map((p) => `${p.name}=${p.value}`).join(";");

  const domain: CookieDomain = hostOnly
    ? { HostOnly: domain_value ?? "" }
    : { Suffix: domain_value ?? "" };

  // Build the new cookie with explicit tuple type for path
  const newCookie: Cookie = {
    raw_cookie,
    domain,
    expires: "SessionEnd",
    path: [path, secure] as [string, boolean],
  };

  try {
    await patchModelById<"cookie_jar", CookieJar>("cookie_jar", cookieJarId, (prev) => ({
      ...prev,
      cookies: [...prev.cookies, newCookie],
    }));
  } catch (error) {
    console.error("Failed to add cookie:", error);
    throw error;
  }
}

export const CookieDialog = ({ cookieJarId }: Props) => {
  const cookieJars = useAtomValue(cookieJarsAtom);
  const cookieJar = cookieJars?.find((c) => c.id === cookieJarId);

  if (cookieJar == null) {
    return <div>No cookie jar selected</div>;
  }

  const onAddCookie = () => showAddCookieForm(cookieJar.id);

  let tableBody;
  if (cookieJar.cookies.length === 0) {
    tableBody = (
      <tr>
        <td colSpan={3}>
          <Banner>
            Cookies will appear when a response contains the <InlineCode>Set-Cookie</InlineCode>{" "}
            header
          </Banner>
        </td>
      </tr>
    );
    // );
  } else {
    tableBody = cookieJar?.cookies.map((c: Cookie) => (
      <tr key={JSON.stringify(c)}>
        <td className="py-2 select-text cursor-text font-mono font-semibold max-w-0">
          {cookieDomain(c)}
        </td>
        <td className="py-2 pl-4 select-text cursor-text font-mono text-text-subtle whitespace-nowrap overflow-x-auto max-w-[200px] hide-scrollbars">
          {c.raw_cookie}
        </td>
        <td className="max-w-0 w-10">
          <IconButton
            icon="trash"
            size="xs"
            iconSize="sm"
            title="Delete"
            className="ml-auto"
            onClick={async () =>
              await patchModelById<"cookie_jar", CookieJar>("cookie_jar", cookieJar.id, (prev) => ({
                ...prev,
                cookies: prev.cookies.filter((c2: Cookie) => c2 !== c),
              }))
            }
          />
        </td>
      </tr>
    ));
  }

  return (
    <div className="pb-2">
      <table className="w-full text-sm mb-auto min-w-full max-w-full divide-y divide-surface-highlight">
        <thead>
          <tr>
            <th className="py-2 text-left">Domain</th>
            <th className="py-2 text-left pl-4">Cookie</th>
            <th className="py-2 pl-4 w-10">
              <IconButton
                icon="plus"
                size="xs"
                iconSize="sm"
                title="Add Cookie"
                className="ml-auto"
                onClick={onAddCookie}
              />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-highlight">{tableBody}</tbody>
      </table>
    </div>
  );
};
