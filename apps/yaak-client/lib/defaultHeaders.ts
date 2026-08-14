import type { HttpRequestHeader } from "@yaakapp-internal/models";
import { rpc } from "./rpc";

/**
 * Global default headers fetched from the backend.
 * These are static and fetched once on module load.
 */
export const defaultHeaders: HttpRequestHeader[] = await rpc("cmd_default_headers");
