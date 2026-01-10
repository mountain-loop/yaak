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
        type: 'editor',
        name: 'payload',
        label: 'JWT Payload',
        language: 'json',
        defaultValue: '{\n  "foo": "bar"\n}',
        placeholder: '{ }',
      },
      {
        type: 'accordion',
        label: 'Advanced',
        inputs: [
          {
            type: 'editor',
            name: 'headers',
            label: 'JWT Header',
            description: 'Merged with auto-generated header fields like alg (e.g., kid)',
            language: 'json',
            defaultValue: '{}',
            placeholder: '{ }',
            optional: true,
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
            type: 'h_stack',
            inputs: [
              {
                type: 'text',
                name: 'name',
                label: 'Header Name',
                defaultValue: 'Authorization',
                optional: true,
                description: 'The name of the header to add to the request',
              },
              {
                type: 'text',
                name: 'headerPrefix',
                label: 'Header Prefix',
                optional: true,
                defaultValue: 'Bearer',
              },
            ],
            dynamic(_ctx, args) {
              if (args.values.location === 'query') {
                return {
                  hidden: true,
                };
              }
            },
          },
          {
            type: 'text',
            name: 'name',
            label: 'Parameter Name',
            description: 'The name of the query parameter to add to the request',
            defaultValue: 'token',
            optional: true,
            dynamic(_ctx, args) {
              if (args.values.location !== 'query') {
                return {
                  hidden: true,
                };
              }
            },
          },
        ],
      },
    ],
    async onApply(_ctx, { values }) {
      const { algorithm, secret: _secret, secretBase64, payload, headers } = values;
      const secret = secretBase64 ? Buffer.from(`${_secret}`, 'base64') : `${_secret}`;

      const parsedHeaders = headers ? JSON.parse(`${headers}`) : undefined;

      const token = jwt.sign(`${payload}`, secret, {
        algorithm: algorithm as (typeof algorithms)[number],
        // Extra header fields are merged with the auto-generated header (which includes alg)
        header: parsedHeaders as jwt.JwtHeader | undefined,
      });

      if (values.location === 'query') {
        const paramName = String(values.name || 'token');
        return { setQueryParameters: [{ name: paramName, value: token }] };
      }
      const headerPrefix = values.headerPrefix != null ? values.headerPrefix : 'Bearer';
      const headerName = String(values.name || 'Authorization');
      const headerValue = `${headerPrefix} ${token}`.trim();
      return { setHeaders: [{ name: headerName, value: headerValue }] };
    },
  },
};
