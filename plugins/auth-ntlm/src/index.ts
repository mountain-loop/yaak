import type { HttpRequest, PluginDefinition } from '@yaakapp/api';

import { ntlm } from 'httpntlm';

export const plugin: PluginDefinition = {
  authentication: {
    name: 'windows',
    label: 'NTLM Auth',
    shortLabel: 'NTLM',
    args: [
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

      const negotiateRequest = ntlm.createType1Message({});

      const httpRequest: Partial<HttpRequest> = {
        method,
        url,
        headers: [
          { name: 'Authorization', value: negotiateRequest },
          { name: 'Connection', value: 'keep-alive' },
        ],
      };

      const negotiateResponse = await ctx.httpRequest.send({ httpRequest });
      const wwwAuthenticateHeader = negotiateResponse.headers.find(
        (h) => h.name.toLowerCase() === 'www-authenticate',
      );

      if (!wwwAuthenticateHeader?.value) {
        throw new Error('Unable to find www-authenticate response header for NTLM');
      }

      const type2 = ntlm.parseType2Message(wwwAuthenticateHeader.value);
      const type3 = ntlm.createType3Message(type2, { username, password, domain, workstation });

      return { setHeaders: [{ name: 'Authorization', value: type3 }] };
    },
  },
};
