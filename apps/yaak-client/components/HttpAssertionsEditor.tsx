import { useQuery } from "@tanstack/react-query";
import type { HttpAssertion, HttpAssertions, HttpRequest } from "@yaakapp-internal/models";
import { patchModelDebounced } from "@yaakapp-internal/models";
import { usePinnedHttpResponse } from "../hooks/usePinnedHttpResponse";
import { JsonPathInput } from "./JsonPathInput";
import { useRequestUpdateKey } from "../hooks/useRequestUpdateKey";
import { useStateWithDeps } from "../hooks/useStateWithDeps";
import { generateId } from "../lib/generateId";
import { rpc } from "../lib/rpc";
import { Button } from "./core/Button";
import { Checkbox } from "./core/Checkbox";
import { IconButton } from "./core/IconButton";
import { PlainInput } from "./core/PlainInput";
import { Select } from "./core/Select";
import { HttpAssertionPreview } from "./HttpAssertionPreview";

const EMPTY: HttpAssertions = { version: 1, checks: [] };
const operators = [
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Does not equal" },
  { value: "greater_than", label: "Greater than" },
  { value: "less_than", label: "Less than" },
  { value: "contains", label: "Contains" },
  { value: "exists", label: "Exists" },
];

export function HttpAssertionsEditor({ request }: { request: HttpRequest }) {
  const updateKey = useRequestUpdateKey(request.id);
  const { activeResponse } = usePinnedHttpResponse(request.id);
  const [definition, setDefinition] = useStateWithDeps(request.assertions ?? EMPTY, [updateKey]);
  const validation = useQuery({
    queryKey: ["validate_assertions", definition],
    queryFn: () =>
      rpc<Record<string, string>>("cmd_validate_http_assertions", { assertions: definition }),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

  const save = (checks: HttpAssertion[]) => {
    const next = { ...definition, checks };
    setDefinition(next);
    patchModelDebounced(request, { assertions: next });
  };
  const update = (id: string, patch: Partial<HttpAssertion>) =>
    save(definition.checks.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  return (
    <div className="@container h-full overflow-auto pb-3 space-y-3">
      <p className="text-sm text-text-subtle">
        Check the response each time you send. Results appear in the response’s Assertions tab.
      </p>
      {definition.checks.map((check, index) => (
        <div key={check.id} className="border border-border-subtle rounded-md p-2 space-y-2">
          <div className="flex items-center gap-2">
            <Checkbox
              title={`Assertion ${index + 1}`}
              checked={check.enabled}
              onChange={(enabled) => update(check.id, { enabled })}
            />
            <IconButton
              icon="trash"
              size="xs"
              title={`Delete assertion ${index + 1}`}
              onClick={() => save(definition.checks.filter((c) => c.id !== check.id))}
            />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] @[28rem]:grid-cols-[8rem_minmax(0,1fr)] gap-2">
            <Select
              name={`target-${check.id}`}
              label="Response"
              size="sm"
              value={check.target}
              options={[
                { value: "json", label: "JSON body" },
                { value: "status", label: "Status" },
                { value: "header", label: "Header" },
              ]}
              onChange={(target) =>
                update(check.id, {
                  target,
                  selector: "",
                  operator: "equals",
                  expected: target === "status" ? "200" : "",
                  expectedType: target === "status" ? "number" : "text",
                })
              }
            />
            {check.target === "json" && (
              <JsonPathInput
                response={activeResponse}
                stateKey={`assertion-path:${request.id}:${check.id}`}
                defaultValue={check.selector}
                forceUpdateKey={updateKey}
                onChange={(selector) => update(check.id, { selector })}
              />
            )}
            {check.target === "header" && (
              <PlainInput
                label="Header name"
                size="sm"
                defaultValue={check.selector}
                forceUpdateKey={`${updateKey}:${check.target}`}
                placeholder="Content-Type"
                onChange={(selector) => update(check.id, { selector })}
              />
            )}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] @[28rem]:grid-cols-[8rem_minmax(0,1fr)] gap-2">
            <Select
              name={`operator-${check.id}`}
              label="Comparison"
              size="sm"
              value={check.operator}
              options={operators.filter(
                (o) =>
                  check.target === "json" ||
                  (check.target === "status"
                    ? o.value !== "contains" && o.value !== "exists"
                    : !["greater_than", "less_than"].includes(o.value)),
              )}
              onChange={(operator) =>
                update(check.id, {
                  operator,
                  ...(["greater_than", "less_than"].includes(operator)
                    ? { expectedType: "number" }
                    : operator === "contains"
                      ? { expectedType: "text" }
                      : {}),
                })
              }
            />
            {check.operator !== "exists" && (
              <div className="flex items-start gap-2 min-w-0">
                {check.expectedType !== "null" && (
                  <div className="flex-1 min-w-0">
                    <PlainInput
                      label="Expected value"
                      size="sm"
                      defaultValue={check.expected}
                      forceUpdateKey={`${updateKey}:${check.target}`}
                      placeholder={check.expectedType === "boolean" ? "true or false" : "Value"}
                      onChange={(expected) => update(check.id, { expected })}
                    />
                  </div>
                )}
                {check.target === "json" &&
                  !["greater_than", "less_than", "contains"].includes(check.operator) && (
                    <div className="w-24 shrink-0">
                      <Select
                        name={`type-${check.id}`}
                        label="Type"
                        size="sm"
                        value={check.expectedType}
                        options={[
                          { value: "text", label: "Text" },
                          { value: "number", label: "Number" },
                          { value: "boolean", label: "Boolean" },
                          { value: "null", label: "Null" },
                        ]}
                        onChange={(expectedType) => update(check.id, { expectedType })}
                      />
                    </div>
                  )}
              </div>
            )}
          </div>
          {validation.data?.[check.id] && (
            <p className="text-xs text-danger" role="status">
              {validation.data[check.id]}
            </p>
          )}
        </div>
      ))}
      {validation.data?.[""] && (
        <p className="text-sm text-danger" role="status">
          {validation.data[""]}
        </p>
      )}
      {validation.isError && (
        <p className="text-sm text-danger" role="status">
          Unable to validate assertions.
        </p>
      )}
      <Button
        size="sm"
        variant="border"
        disabled={definition.version !== 1 || definition.checks.length >= 100}
        onClick={() =>
          save([
            ...definition.checks,
            {
              id: generateId(),
              enabled: true,
              target: "json",
              selector: "",
              operator: "equals",
              expected: "",
              expectedType: "text",
            },
          ])
        }
      >
        Add assertion
      </Button>
      {definition.checks.some((c) => c.target === "json") && (
        <p className="text-xs text-text-subtle">
          Use a JSONPath such as $.user.id or user.id. Comparisons select one value; Exists also
          accepts multiple matches. Suggestions use the selected response, one level at a time.
          Values are literal and types must match.
        </p>
      )}
      <HttpAssertionPreview assertions={definition} response={activeResponse} />
    </div>
  );
}
