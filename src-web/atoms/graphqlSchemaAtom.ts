import { atom } from "jotai";
import type { GraphQLSchema } from "graphql/index";

export const graphqlSchemaAtom = atom<GraphQLSchema | null>(null);
export const graphqlDocStateAtom = atom<boolean>(false);
