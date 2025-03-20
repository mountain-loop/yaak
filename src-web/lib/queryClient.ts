import {QueryCache, QueryClient} from "@tanstack/react-query";

export const queryClient = new QueryClient({
    queryCache: new QueryCache({
        onError: (err, query) => {
            console.log('Query client error', { err, query });
        },
    }),
    defaultOptions: {
        queries: {
            retry: false,
            networkMode: 'always',
            refetchOnWindowFocus: true,
            refetchOnReconnect: false,
            refetchOnMount: false, // Don't refetch when a hook mounts
        },
    },
});
