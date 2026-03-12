import type { RpcEventSchema } from '@yaakapp-internal/proxy-lib';
import { useEffect } from 'react';
import { listen } from '../lib/rpc';

/**
 * Subscribe to an RPC event. Cleans up automatically on unmount.
 */
export function useRpcEvent<K extends keyof RpcEventSchema>(
  event: K & string,
  callback: (payload: RpcEventSchema[K]) => void,
) {
  useEffect(() => {
    return listen(event, callback);
  }, [event, callback]);
}
