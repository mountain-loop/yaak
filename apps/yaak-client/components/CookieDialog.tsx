import type { Cookie } from "@yaakapp-internal/models";
import { cookieJarsAtom, patchModel } from "@yaakapp-internal/models";
import { formatDate } from "date-fns/format";
import { useAtomValue } from "jotai";
import {
  type ComponentProps,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type RefObject,
  useMemo,
  useRef,
  useState,
} from "react";
import { showDialog } from "../lib/dialog";
import { jotaiStore } from "../lib/jotai";
import { cookieDomain } from "../lib/model_util";
import {
  Icon,
  SplitLayout,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TruncatedWideTableCell,
} from "@yaakapp-internal/ui";
import { IconButton } from "./core/IconButton";
import { Checkbox } from "./core/Checkbox";
import classNames from "classnames";
import { EventDetailHeader } from "./core/EventViewer";
import { KeyValueRow, KeyValueRows } from "./core/KeyValueRow";
import { EmptyStateText } from "./EmptyStateText";
import { PlainInput } from "./core/PlainInput";
import { Select } from "./core/Select";
import { showAlert } from "../lib/alert";

interface Props {
  cookieJarId: string | null;
}

export const CookieDialog = ({ cookieJarId }: Props) => {
  const cookieJars = useAtomValue(cookieJarsAtom);
  const cookieJar = cookieJars?.find((c) => c.id === cookieJarId);
  const [filter, setFilter] = useState("");
  const [filterUpdateKey, setFilterUpdateKey] = useState(0);
  const [selectedCookieKey, setSelectedCookieKey] = useState<string | null>(null);
  const [editingCookieKey, setEditingCookieKey] = useState<string | null>(null);
  const [draftCookie, setDraftCookie] = useState<Cookie | null>(null);
  const [draftExpiresInput, setDraftExpiresInput] = useState("");
  const editorFormRef = useRef<HTMLFormElement>(null);
  const filteredCookies = useMemo(() => {
    return cookieJar?.cookies.filter((cookie) => cookieMatchesFilter(cookie, filter)) ?? [];
  }, [cookieJar?.cookies, filter]);
  const selectedCookie = useMemo(
    () =>
      selectedCookieKey == null
        ? null
        : (filteredCookies.find((cookie) => cookieKey(cookie) === selectedCookieKey) ?? null),
    [filteredCookies, selectedCookieKey],
  );
  const detailCookie = draftCookie ?? selectedCookie;
  const isCreatingCookie = editingCookieKey === NEW_COOKIE_KEY;
  const isEditingCookie = draftCookie != null;

  const handleAddCookie = () => {
    setSelectedCookieKey(null);
    setEditingCookieKey(NEW_COOKIE_KEY);
    setDraftCookie(newCookieDraft());
    setDraftExpiresInput("");
  };

  const handleEditCookie = () => {
    if (selectedCookie == null) {
      return;
    }

    setEditingCookieKey(cookieKey(selectedCookie));
    setDraftCookie(selectedCookie);
    setDraftExpiresInput(cookieExpiresInputValue(selectedCookie));
  };

  const handleCancelEdit = () => {
    if (isCreatingCookie) {
      setSelectedCookieKey(null);
    }
    setEditingCookieKey(null);
    setDraftCookie(null);
    setDraftExpiresInput("");
  };

  const handleCloseDetails = () => {
    if (isEditingCookie) {
      handleCancelEdit();
      return;
    }

    setSelectedCookieKey(null);
  };

  const handleSaveCookie = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (cookieJar == null || draftCookie == null) {
      return;
    }

    let nextCookie = normalizeCookie(draftCookie);
    if (nextCookie.expires !== "SessionEnd") {
      const expires = cookieExpiresFromInput(draftExpiresInput);
      if (expires == null) {
        showAlert({
          id: "invalid-cookie-expires",
          title: "Invalid Cookie",
          body: "Cookie expiration must be a valid date.",
        });
        return;
      }

      nextCookie = { ...nextCookie, expires };
    }

    const nextCookieKey = cookieKey(nextCookie);
    const nextCookies = cookieJar.cookies.filter((cookie) => {
      const key = cookieKey(cookie);
      if (editingCookieKey != null && key === editingCookieKey) {
        return false;
      }
      return key !== nextCookieKey;
    });

    patchModel(cookieJar, { cookies: [...nextCookies, nextCookie] });
    setSelectedCookieKey(nextCookieKey);
    setEditingCookieKey(null);
    setDraftCookie(null);
    setDraftExpiresInput("");
  };

  if (cookieJar == null) {
    return <div>No cookie jar selected</div>;
  }

  return (
    <div className="pb-2 grid grid-rows-[auto_minmax(0,1fr)] space-y-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <PlainInput
          name="cookie-filter"
          label="Filter cookies"
          hideLabel
          placeholder="Filter cookies"
          defaultValue={filter}
          forceUpdateKey={filterUpdateKey}
          onChange={setFilter}
          rightSlot={
            filter.length > 0 && (
              <IconButton
                className="!bg-transparent !h-auto min-h-full opacity-50 hover:opacity-100 -mr-1"
                icon="x"
                title="Clear filter"
                onClick={() => {
                  setFilter("");
                  setFilterUpdateKey((key) => key + 1);
                }}
              />
            )
          }
        />
        <IconButton icon="plus" size="sm" title="Add cookie" onClick={handleAddCookie} />
      </div>
      {cookieJar.cookies.length === 0 && detailCookie == null ? (
        <EmptyStateText>
          Cookies will appear when a response includes a Set-Cookie header.
        </EmptyStateText>
      ) : filteredCookies.length === 0 && detailCookie == null ? (
        <EmptyStateText>No cookies match the current filter.</EmptyStateText>
      ) : (
        <SplitLayout
          layout="vertical"
          storageKey="cookie-dialog-details"
          defaultRatio={0.5}
          className="-mx-2"
          minHeightPx={10}
          firstSlot={({ style }) =>
            filteredCookies.length === 0 ? (
              <div style={style}>
                <EmptyStateText>No cookies match the current filter.</EmptyStateText>
              </div>
            ) : (
              <Table scrollable style={style} className="pr-0.5">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Name</TableHeaderCell>
                    <TableHeaderCell>Value</TableHeaderCell>
                    <TableHeaderCell>Domain</TableHeaderCell>
                    <TableHeaderCell>Path</TableHeaderCell>
                    <TableHeaderCell>Expires</TableHeaderCell>
                    <TableHeaderCell>Size</TableHeaderCell>
                    <TableHeaderCell>HTTP Only</TableHeaderCell>
                    <TableHeaderCell>Secure</TableHeaderCell>
                    <TableHeaderCell>Same Site</TableHeaderCell>
                    <TableHeaderCell>
                      <IconButton
                        icon="list_x"
                        size="sm"
                        className="text-text-subtle"
                        title="Clear all cookies"
                        onClick={() => {
                          setSelectedCookieKey(null);
                          setEditingCookieKey(null);
                          setDraftCookie(null);
                          setDraftExpiresInput("");
                          patchModel(cookieJar, { cookies: [] });
                        }}
                      />
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody className="[&_td]:select-auto [&_td]:cursor-auto">
                  {filteredCookies.map((c: Cookie) => {
                    const key = cookieKey(c);
                    const isSelected = key === selectedCookieKey;

                    return (
                      <TableRow
                        key={key}
                        className={classNames(
                          "group/tr cursor-default",
                          isSelected && "[&_td]:bg-surface-highlight",
                          !isSelected && "hover:[&_td]:bg-surface-hover",
                        )}
                        onClick={() => {
                          setSelectedCookieKey(key);
                          setEditingCookieKey(null);
                          setDraftCookie(null);
                          setDraftExpiresInput("");
                        }}
                      >
                        <TableCell className={classNames("pl-2", isSelected && "rounded-l")}>
                          {c.name}
                        </TableCell>
                        <TruncatedWideTableCell className="min-w-[10rem]">
                          {c.value}
                        </TruncatedWideTableCell>
                        <TableCell>{cookieDomain(c)}</TableCell>
                        <TableCell>{c.path}</TableCell>
                        <TableCell>{cookieExpires(c)}</TableCell>
                        <TableCell>{cookieSize(c)}</TableCell>
                        <TableCell>
                          <Icon
                            icon={c.httpOnly ? "check" : "x"}
                            className={classNames(!c.httpOnly && "opacity-10")}
                          />
                        </TableCell>
                        <TableCell>
                          <Icon
                            icon={c.secure ? "check" : "x"}
                            className={classNames(!c.secure && "opacity-10")}
                          />
                        </TableCell>
                        <TableCell>{c.sameSite}</TableCell>
                        <TableCell className="rounded-r pr-2">
                          <IconButton
                            icon="trash"
                            size="xs"
                            iconSize="sm"
                            title="Delete"
                            className="text-text-subtlest ml-auto group-hover/tr:text-text transition-colors"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (isSelected) {
                                setSelectedCookieKey(null);
                              }
                              if (editingCookieKey === key) {
                                setEditingCookieKey(null);
                                setDraftCookie(null);
                                setDraftExpiresInput("");
                              }
                              patchModel(cookieJar, {
                                cookies: cookieJar.cookies.filter(
                                  (c2: Cookie) => cookieKey(c2) !== key,
                                ),
                              });
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )
          }
          secondSlot={
            detailCookie == null
              ? null
              : ({ style }) => (
                  <CookieDetailsPane
                    formRef={editorFormRef}
                    isEditing={isEditingCookie}
                    onSubmit={handleSaveCookie}
                    style={style}
                  >
                    <EventDetailHeader
                      title={isCreatingCookie ? "New Cookie" : detailCookie.name || "Cookie"}
                      copyText={isEditingCookie ? undefined : detailCookie.value}
                      actions={
                        isEditingCookie
                          ? [
                              {
                                key: "save",
                                label: isCreatingCookie ? "Create" : "Save",
                                onClick: () => editorFormRef.current?.requestSubmit(),
                              },
                              {
                                key: "cancel",
                                label: "Cancel",
                                onClick: handleCancelEdit,
                              },
                            ]
                          : [
                              {
                                key: "edit",
                                label: "Edit",
                                onClick: handleEditCookie,
                              },
                            ]
                      }
                      onClose={handleCloseDetails}
                    />
                    {isEditingCookie ? (
                      <CookieEditor
                        cookie={detailCookie}
                        expiresInputValue={draftExpiresInput}
                        onChange={setDraftCookie}
                        onExpiresInputChange={setDraftExpiresInput}
                      />
                    ) : (
                      <CookieDetails cookie={detailCookie} />
                    )}
                  </CookieDetailsPane>
                )
          }
        />
      )}
    </div>
  );
};

function CookieDetailsPane({
  children,
  formRef,
  isEditing,
  onSubmit,
  style,
}: {
  children: ReactNode;
  formRef: RefObject<HTMLFormElement | null>;
  isEditing: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  style: CSSProperties;
}) {
  const className = "grid grid-rows-[auto_minmax(0,1fr)] bg-surface border-t border-border pt-2";

  if (isEditing) {
    return (
      <form ref={formRef} style={style} className={className} onSubmit={onSubmit}>
        {children}
      </form>
    );
  }

  return (
    <div style={style} className={className}>
      {children}
    </div>
  );
}

CookieDialog.show = (cookieJarId: string | null) => {
  const cookieJar = jotaiStore.get(cookieJarsAtom)?.find((jar) => jar.id === cookieJarId);
  if (cookieJar == null) {
    showAlert({
      id: "invalid-jar",
      body: `Failed to find cookie jar for ID: ${cookieJarId}`,
      title: "Invalid Cookie Jar",
    });
    return;
  }

  showDialog({
    id: "cookies",
    title: `${cookieJar.name} Cookies`,
    size: "full",
    render: () => <CookieDialog cookieJarId={cookieJarId} />,
  });
};

function CookieDetails({ cookie }: { cookie: Cookie }) {
  return (
    <div className="overflow-y-auto">
      <KeyValueRows selectable>
        <CookieKeyValueRow label="Name">{cookie.name}</CookieKeyValueRow>
        <CookieKeyValueRow label="Value" enableCopy copyText={cookie.value}>
          <pre className="whitespace-pre-wrap break-all">{cookie.value}</pre>
        </CookieKeyValueRow>
        <CookieKeyValueRow label="Domain">{cookieDomain(cookie)}</CookieKeyValueRow>
        <CookieKeyValueRow label="Path">{cookie.path}</CookieKeyValueRow>
        <CookieKeyValueRow label="Expires">{cookieExpires(cookie)}</CookieKeyValueRow>
        <CookieKeyValueRow label="Size">{cookieSize(cookie)}</CookieKeyValueRow>
        <CookieKeyValueRow label="HTTP Only">{cookie.httpOnly ? "Yes" : "No"}</CookieKeyValueRow>
        <CookieKeyValueRow label="Secure">{cookie.secure ? "Yes" : "No"}</CookieKeyValueRow>
        {cookie.sameSite && (
          <CookieKeyValueRow label="Same Site">{cookie.sameSite}</CookieKeyValueRow>
        )}
      </KeyValueRows>
    </div>
  );
}

function CookieEditor({
  cookie,
  expiresInputValue,
  onChange,
  onExpiresInputChange,
}: {
  cookie: Cookie;
  expiresInputValue: string;
  onChange: (cookie: Cookie) => void;
  onExpiresInputChange: (value: string) => void;
}) {
  const sessionCookie = cookie.expires === "SessionEnd";

  return (
    <div className="overflow-y-auto">
      <KeyValueRows>
        <CookieKeyValueRow align="middle" label="Name">
          <CookieTextInput
            required
            autoFocus
            pattern={NON_EMPTY_INPUT_PATTERN}
            value={cookie.name}
            onChange={(name) => onChange({ ...cookie, name })}
          />
        </CookieKeyValueRow>
        <CookieKeyValueRow label="Value">
          <CookieTextarea
            value={cookie.value}
            onChange={(value) => onChange({ ...cookie, value })}
          />
        </CookieKeyValueRow>
        <CookieKeyValueRow align="middle" label="Domain">
          <CookieTextInput
            required
            pattern={NON_EMPTY_INPUT_PATTERN}
            value={cookieDomainInputValue(cookie)}
            placeholder="example.com"
            onChange={(domain) => onChange(cookieWithDomain(cookie, domain))}
          />
        </CookieKeyValueRow>
        <CookieKeyValueRow align="middle" label="Path">
          <CookieTextInput
            value={cookie.path}
            placeholder="/"
            onChange={(path) => onChange({ ...cookie, path })}
          />
        </CookieKeyValueRow>
        <CookieKeyValueRow label="Expires">
          <div className="grid gap-1">
            <Checkbox
              checked={sessionCookie}
              title="Session cookie"
              onChange={(checked) => {
                if (checked) {
                  onChange({ ...cookie, expires: "SessionEnd" });
                  return;
                }

                const expiresInput =
                  cookieExpiresFromInput(expiresInputValue) == null
                    ? defaultCookieExpiresInputValue()
                    : expiresInputValue;

                onExpiresInputChange(expiresInput);
                onChange({
                  ...cookie,
                  expires: cookieExpiresFromInput(expiresInput)!,
                });
              }}
            />
            <CookieTextInput
              value={sessionCookie ? "" : expiresInputValue}
              disabled={sessionCookie}
              onChange={(value) => {
                onExpiresInputChange(value);

                const expires = cookieExpiresFromInput(value);
                if (expires != null) {
                  onChange({ ...cookie, expires });
                }
              }}
            />
          </div>
        </CookieKeyValueRow>
        <CookieKeyValueRow label="Size">{cookieSize(cookie)}</CookieKeyValueRow>
        <CookieKeyValueRow align="middle" label="HTTP Only">
          <Checkbox
            hideLabel
            title="HTTP Only"
            checked={cookie.httpOnly}
            onChange={(httpOnly) => onChange({ ...cookie, httpOnly })}
          />
        </CookieKeyValueRow>
        <CookieKeyValueRow align="middle" label="Secure">
          <Checkbox
            hideLabel
            title="Secure"
            checked={cookie.secure}
            onChange={(secure) => onChange({ ...cookie, secure })}
          />
        </CookieKeyValueRow>
        <CookieKeyValueRow align="middle" label="Same Site">
          <Select
            hideLabel
            name="cookie-same-site"
            label="Same Site"
            value={cookie.sameSite ?? ""}
            size="xs"
            className="w-full"
            options={[
              { label: "n/a", value: "" },
              { label: "Lax", value: "Lax" },
              { label: "Strict", value: "Strict" },
              { label: "None", value: "None" },
            ]}
            onChange={(sameSite) =>
              onChange({
                ...cookie,
                sameSite: sameSite === "" ? null : (sameSite as Cookie["sameSite"]),
              })
            }
          />
        </CookieKeyValueRow>
      </KeyValueRows>
    </div>
  );
}

function CookieKeyValueRow({ labelClassName, ...props }: ComponentProps<typeof KeyValueRow>) {
  return <KeyValueRow labelClassName={classNames("w-[7rem]", labelClassName)} {...props} />;
}

function CookieTextInput({
  autoFocus,
  disabled,
  onChange,
  pattern,
  placeholder,
  required,
  value,
}: {
  autoFocus?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  pattern?: string;
  placeholder?: string;
  required?: boolean;
  value: string;
}) {
  return (
    <input
      autoFocus={autoFocus}
      className={cookieInputClassName}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      pattern={pattern}
      placeholder={placeholder}
      required={required}
      type="text"
      value={value}
    />
  );
}

function CookieTextarea({ onChange, value }: { onChange: (value: string) => void; value: string }) {
  return (
    <textarea
      className={classNames(cookieInputClassName, "min-h-[5rem] resize-y")}
      onChange={(event) => onChange(event.target.value)}
      value={value}
    />
  );
}

const NEW_COOKIE_KEY = "__new-cookie__";
const NON_EMPTY_INPUT_PATTERN = ".*\\S.*";
const cookieInputClassName = classNames(
  "x-theme-input w-full min-w-0 min-h-sm rounded-md bg-transparent",
  "border border-border-subtle outline-none",
  "px-2 text-xs font-mono cursor-text placeholder:text-placeholder",
  "focus:border-border-focus invalid:border-danger",
  "disabled:opacity-disabled disabled:border-dotted",
);

function cookieSize(cookie: Cookie) {
  const encoder = new TextEncoder();
  return encoder.encode(cookie.name).length + encoder.encode(cookie.value).length;
}

function newCookieDraft(): Cookie {
  return {
    name: "",
    value: "",
    domain: "NotPresent",
    expires: "SessionEnd",
    path: "/",
    secure: false,
    httpOnly: false,
    sameSite: null,
  };
}

function normalizeCookie(cookie: Cookie): Cookie {
  return {
    ...cookie,
    domain: normalizeCookieDomain(cookie.domain),
    name: cookie.name.trim(),
    path: cookie.path.trim() || "/",
  };
}

function normalizeCookieDomain(domain: Cookie["domain"]): Cookie["domain"] {
  if (domain === "NotPresent" || domain === "Empty") {
    return domain;
  }

  if ("Suffix" in domain) {
    return { Suffix: domain.Suffix.trim() };
  }

  return { HostOnly: domain.HostOnly.trim() };
}

function cookieDomainInputValue(cookie: Cookie) {
  const domain = cookieDomain(cookie);
  return domain === "n/a" ? "" : domain;
}

function cookieWithDomain(cookie: Cookie, domain: string): Cookie {
  const trimmedDomain = domain.trim();
  if (trimmedDomain.length === 0) {
    return { ...cookie, domain: "NotPresent" };
  }

  if (cookie.domain !== "NotPresent" && cookie.domain !== "Empty" && "Suffix" in cookie.domain) {
    return { ...cookie, domain: { Suffix: trimmedDomain } };
  }

  return { ...cookie, domain: { HostOnly: trimmedDomain } };
}

function cookieExpires(cookie: Cookie) {
  if (cookie.expires === "SessionEnd") {
    return "Session";
  }

  const expiresSeconds = Number(cookie.expires.AtUtc);
  if (!Number.isFinite(expiresSeconds)) {
    return cookie.expires.AtUtc;
  }

  const date = new Date(expiresSeconds * 1000);
  return formatDate(date, "MMM d, yyyy, h:mm:ss a");
}

function cookieExpiresInputValue(cookie: Cookie) {
  if (cookie.expires === "SessionEnd") {
    return "";
  }

  const expiresSeconds = Number(cookie.expires.AtUtc);
  if (!Number.isFinite(expiresSeconds)) {
    return "";
  }

  return new Date(expiresSeconds * 1000).toISOString();
}

function defaultCookieExpiresInputValue() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

function cookieExpiresFromInput(value: string): Cookie["expires"] | null {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) {
    return null;
  }

  return { AtUtc: `${Math.floor(time / 1000)}` };
}

function cookieMatchesFilter(cookie: Cookie, filter: string) {
  const query = filter.trim().toLowerCase();
  if (query.length === 0) {
    return true;
  }

  return [cookie.name, cookie.value, cookieDomain(cookie)].some((value) =>
    value.toLowerCase().includes(query),
  );
}

function cookieKey(cookie: Cookie) {
  return [cookie.name, cookieDomainKey(cookie.domain), cookie.path].join("|");
}

function cookieDomainKey(domain: Cookie["domain"]) {
  if (typeof domain !== "string" && "HostOnly" in domain) {
    return `HostOnly:${domain.HostOnly}`;
  }

  if (typeof domain !== "string" && "Suffix" in domain) {
    return `Suffix:${domain.Suffix}`;
  }

  return domain;
}
