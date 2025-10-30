import type { PluginDefinition } from '@yaakapp/api';
import jwt from 'jsonwebtoken';

const algorithms = [
  'HS256',
  'HS384',
  'HS512',
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'none',
] as const;

const defaultAlgorithm = algorithms[0];

export const plugin: PluginDefinition = {
  authentication: {
    name: 'jwt',
    label: 'JWT Bearer',
    shortLabel: 'JWT',
    args: [
      {
        type: 'select',
        name: 'algorithm',
        label: 'Algorithm',
        hideLabel: true,
        defaultValue: defaultAlgorithm,
        options: algorithms.map((value) => ({ label: value === 'none' ? 'None' : value, value })),
      },
      {
        type: 'text',
        name: 'secret',
        label: 'Secret or Private Key',
        password: true,
        optional: true,
        multiLine: true,
      },
      {
        type: 'checkbox',
        name: 'secretBase64',
        label: 'Secret is base64 encoded',
      },
      {
        type: 'select',
        name: 'location',
        label: 'Behavior',
        defaultValue: 'header',
        options: [
          { label: 'Insert Header', value: 'header' },
          { label: 'Append Query Parameter', value: 'query' },
        ],
      },
      {
        type: 'text',
        name: 'name',
        label: 'Header Name',
        defaultValue: 'Authorization',
        optional: true,
        dynamic(_ctx, args) {
          if (args.values.location === 'query') {
            return {
              label: 'Parameter Name',
              description: 'The name of the query parameter to add to the request',
            };
          } else {
            return {
              label: 'Header Name',
              description: 'The name of the header to add to the request',
            };
          }
        },
      },
      {
        type: 'text',
        name: 'headerPrefix',
        label: 'Header Prefix',
        optional: true,
        defaultValue: 'Bearer',
        dynamic(_ctx, args) {
          if (args.values.location === 'query') {
            return {
              hidden: true,
            };
          }
        },
      },
      {
        type: 'editor',
        name: 'payload',
        label: 'Payload',
        language: 'json',
        defaultValue: '{\n  "foo": "bar"\n}',
        placeholder: '{ }',
      },
    ],
    async onApply(_ctx, { values }) {
      const { algorithm, secret: _secret, secretBase64, payload } = values;
      const secret = secretBase64 ? Buffer.from(`${_secret}`, 'base64') : `${_secret}`;
      const token = jwt.sign(`${payload}`, secret, {
        algorithm: algorithm as (typeof algorithms)[number],
      });

      if (values.location === 'query') {
        const paramName = String(values.name || 'token');
        const paramValue = String(values.value || '');
        return { setQueryParameters: [{ name: paramName, value: paramValue }] };
      } else {
        const headerPrefix = values.headerPrefix != null ? values.headerPrefix : 'Bearer';
        const headerName = String(values.name || 'Authorization');
        const headerValue = `${headerPrefix} ${token}`.trim();
        return { setHeaders: [{ name: headerName, value: headerValue }] };
      }
    },
  },
};
