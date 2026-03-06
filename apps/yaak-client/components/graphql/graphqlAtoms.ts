import { atomWithKVStorage } from '../../lib/atoms/atomWithKVStorage';

export const showGraphQLDocExplorerAtom = atomWithKVStorage<
  Record<
    string,
    | {
        type?: string;
        field?: string;
        parentType?: string;
      }
    | null
    | undefined
  >
>('show_graphql_docs', {});
