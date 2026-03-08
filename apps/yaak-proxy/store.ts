import { createModelStore } from "@yaakapp-internal/model-store";
import type { HttpExchange } from "../../crates-proxy/yaak-proxy-lib/bindings/gen_models";

type ProxyModels = {
  http_exchange: HttpExchange;
};

export const { dataAtom, applyChange, listAtom, orderedListAtom } =
  createModelStore<ProxyModels>(["http_exchange"]);

export const httpExchangesAtom = orderedListAtom(
  "http_exchange",
  "createdAt",
  "desc",
);
