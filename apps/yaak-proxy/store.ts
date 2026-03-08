import { createModelStore } from "@yaakapp-internal/model-store";
import type { HttpExchange } from "../../crates-proxy/yaak-proxy-lib/bindings/gen_models";

export const { dataAtom, applyChange, listAtom, orderedListAtom } =
  createModelStore<HttpExchange>();

export const httpExchangesAtom = orderedListAtom(
  "http_exchange",
  "createdAt",
  "desc",
);
