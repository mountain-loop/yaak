import { Kind, parse } from "graphql";

export function getGraphQLOperationNames(query: string): string[] {
  return parseGraphQLOperationNames(query) ?? [];
}

export function parseGraphQLOperationNames(query: string): string[] | null {
  try {
    const names: string[] = [];

    for (const definition of parse(query).definitions) {
      if (definition.kind !== Kind.OPERATION_DEFINITION || definition.name == null) {
        continue;
      }

      const name = definition.name.value;
      if (!names.includes(name)) {
        names.push(name);
      }
    }

    return names;
  } catch {
    return null;
  }
}
