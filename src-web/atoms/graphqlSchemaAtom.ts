import { atom } from "jotai";
import { GraphQLSchema } from "graphql/index";

export const graphqlSchemaAtom = atom<GraphQLSchema | null>(null);
