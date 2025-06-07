import { PluginDefinition } from '@yaakapp/api';
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
          options: algorithms.map(value => ({ label: value === 'none' ? 'None' : value, value })),
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
          label: 'Payload',
          language: 'json',
          defaultValue: '{\n  "foo": "bar"\n}',
          placeholder: '{ }',
        },
      ],
      async onApply(_ctx, { values }) {
        const { algorithm, secret: _secret, secretBase64, payload } = values;
        const secret = secretBase64 ? Buffer.from(`${_secret}`, 'base64') : `${_secret}`;
        const token = jwt.sign(`${payload}`, secret, { algorithm: algorithm as any });
        const value = `Bearer ${token}`;
        return { setHeaders: [{ name: 'Authorization', value }] };
      }
      ,
    },
  }
;
