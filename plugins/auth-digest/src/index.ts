import { randomBytes } from "node:crypto";
import type { PluginDefinition } from "@yaakapp/api";

import {
  buildDigestAuthorization,
  parseChallenges,
  requestTarget,
  selectDigestChallenge,
} from "./digest";

export const plugin: PluginDefinition = {
  authentication: {
    name: "digest",
    label: "Digest Auth",
    shortLabel: "Digest",
    args: [
      {
        type: "text",
        name: "username",
        label: "Username",
        optional: true,
      },
      {
        type: "text",
        name: "password",
        label: "Password",
        optional: true,
        password: true,
      },
      {
        type: "accordion",
        label: "Advanced",
        inputs: [
          {
            type: "text",
            name: "realm",
            label: "Realm",
            optional: true,
            description: "Only needed when the server offers more than one realm",
          },
        ],
      },
    ],
    async onApply(ctx, { values, method, url, body }) {
      const username = values.username ? String(values.username) : "";
      const password = values.password ? String(values.password) : "";
      const realm = values.realm ? String(values.realm) : undefined;

      // Digest needs a server-issued nonce, so the challenge has to be provoked
      // before the real request can be signed. The probe carries nothing but the
      // method and URL: a cookie or an API key header would let it authorize the
      // very operation it is only meant to ask permission for, and there is no
      // telling a routing header from a credential by looking at it.
      const { httpResponse } = await ctx.httpRequest.send({ httpRequest: { method, url } });

      const headerValues = httpResponse.headers
        .filter((h) => h.name.toLowerCase() === "www-authenticate")
        .map((h) => h.value);

      const challenge = selectDigestChallenge(parseChallenges(headerValues), realm);
      const value = buildDigestAuthorization({
        username,
        password,
        method,
        uri: requestTarget(url),
        body,
        challenge,
        cnonce: randomBytes(16).toString("hex"),
        nc: 1,
      });

      return { setHeaders: [{ name: "Authorization", value }] };
    },
  },
};
