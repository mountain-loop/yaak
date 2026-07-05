type GraphQLDetectionSignal = {
  score: number;
  requiresGraphQLDocument?: boolean;
};

export type GraphQLJsonBody = {
  query: string;
  variables?: string;
  operationName?: string;
};

type GraphQLJsonBodyArgs = {
  mimeType: string | null;
  text: string;
  url: string;
};

export function isGraphQLJsonBody(args: GraphQLJsonBodyArgs): boolean {
  return parseGraphQLJsonBody(args) != null;
}

export function parseGraphQLJsonBody({
  mimeType,
  text,
  url,
}: GraphQLJsonBodyArgs): GraphQLJsonBody | null {
  if (mimeType !== "application/json") {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const body = parsed as Record<string, unknown>;
  if (typeof body.query !== "string") {
    return null;
  }

  const signals = getGraphQLDetectionSignals(body, url);
  const score = signals.reduce((total, signal) => total + signal.score, 0);
  const hasGraphQLDocument = signals.some((signal) => signal.requiresGraphQLDocument);
  if (!hasGraphQLDocument || score < 4) {
    return null;
  }

  const result: GraphQLJsonBody = { query: body.query };
  if (body.variables != null) {
    result.variables =
      typeof body.variables === "string" ? body.variables : JSON.stringify(body.variables, null, 2);
  }
  if (typeof body.operationName === "string") {
    result.operationName = body.operationName;
  }

  return result;
}

function getGraphQLDetectionSignals(
  body: Record<string, unknown>,
  url: string,
): GraphQLDetectionSignal[] {
  const signals: GraphQLDetectionSignal[] = [];
  const query = body.query as string;
  const urlPath = getUrlPath(url).toLowerCase();

  if (/\b(graphql|gql)\b/.test(urlPath)) {
    signals.push({ score: 2 });
  }

  if (/^(query|mutation|subscription|fragment)\b/.test(query.trim())) {
    signals.push({ score: 3 });
  } else if (/^\{[\s\S]*\}$/.test(query.trim())) {
    signals.push({ score: 3, requiresGraphQLDocument: true });
  }

  if (/\{[\s\S]*\}/.test(query)) {
    signals.push({ score: 1, requiresGraphQLDocument: true });
  }

  if (typeof body.operationName === "string" && body.operationName.trim() !== "") {
    signals.push({ score: 1 });
  }

  if (
    body.variables != null &&
    (typeof body.variables === "object" || typeof body.variables === "string")
  ) {
    signals.push({ score: 1 });
  }

  return signals;
}

function getUrlPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
