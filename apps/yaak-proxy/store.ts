import { createModelStore } from "@yaakapp-internal/model-store";
import type { HttpExchange } from "@yaakapp-internal/proxy-lib";

type ProxyModels = {
  http_exchange: HttpExchange;
};

export const { dataAtom, applyChange, replaceAll, listAtom, orderedListAtom } =
  createModelStore<ProxyModels>(["http_exchange"]);

export const httpExchangesAtom = orderedListAtom(
  "http_exchange",
  "createdAt",
  "desc",
);
