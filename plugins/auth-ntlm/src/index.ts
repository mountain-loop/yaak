import type { PluginDefinition } from '@yaakapp/api';

import { ntlm } from 'httpntlm';

function extractNtlmChallenge(headers: Array<{ name: string; value: string }>): string | null {
  const authValues = headers
    .filter((h) => h.name.toLowerCase() === 'www-authenticate')
    .flatMap((h) => h.value.split(','))
    .map((v) => v.trim())
    .filter(Boolean);

  return authValues.find((v) => /^NTLM\s+\S+/i.test(v)) ?? null;
}

export const plugin: PluginDefinition = {
  authentication: {
    name: 'windows',
    label: 'NTLM Auth',
    shortLabel: 'NTLM',
    args: [
      {
        type: 'banner',
        color: 'info',
        inputs: [
          {
            type: 'markdown',
            content:
              'NTLM is still in beta. Please submit any issues to [Feedback](https://yaak.app/feedback).',
          },
        ],
      },
      {
        type: 'text',
        name: 'username',
        label: 'Username',
        optional: true,
      },
      {
        type: 'text',
        name: 'password',
        label: 'Password',
        optional: true,
        password: true,
      },
      {
        type: 'accordion',
        label: 'Advanced',
        inputs: [
          { name: 'domain', label: 'Domain', type: 'text', optional: true },
          { name: 'workstation', label: 'Workstation', type: 'text', optional: true },
        ],
      },
    ],
    async onApply(ctx, { values, method, url }) {
      const username = values.username ? String(values.username) : undefined;
      const password = values.password ? String(values.password) : undefined;
      const domain = values.domain ? String(values.domain) : undefined;
      const workstation = values.workstation ? String(values.workstation) : undefined;

      const options = {
        url,
        username,
        password,
        workstation,
        domain,
      };

      const type1 = ntlm.createType1Message(options);

      const negotiateResponse = await ctx.httpRequest.send({
        httpRequest: {
          method,
          url,
          headers: [
            { name: 'Authorization', value: type1 },
            { name: 'Connection', value: 'keep-alive' },
          ],
        },
      });

      const ntlmChallenge = extractNtlmChallenge(negotiateResponse.headers);
      if (ntlmChallenge == null) {
        throw new Error('Unable to find NTLM challenge in WWW-Authenticate response headers');
      }

      const type2 = ntlm.parseType2Message(ntlmChallenge, (err: Error | null) => {
        if (err != null) throw err;
      });
      const type3 = ntlm.createType3Message(type2, options);

      return { setHeaders: [{ name: 'Authorization', value: type3 }] };
    },
  },
};
