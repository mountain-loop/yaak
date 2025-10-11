import type { CallHttpAuthenticationResponse } from '@yaakapp-internal/plugins';
import type { PluginDefinition } from '@yaakapp/api';
import aws4 from 'aws4';
import type { Request } from 'aws4';
import { URL } from 'node:url';

export const plugin: PluginDefinition = {
  authentication: {
    name: 'auth-aws-sig-v4',
    label: 'AWS Signature',
    shortLabel: 'AWS v4',
    args: [
      { name: 'accessKeyId', label: 'Access Key ID', type: 'text', password: true },
      {
        name: 'secretAccessKey',
        label: 'Secret Access Key',
        type: 'text',
        password: true,
      },
      {
        name: 'service',
        label: 'Service Name',
        type: 'text',
        defaultValue: 'sts',
        placeholder: 'sts',
        description: 'The service that is receiving the request (sts, s3, sqs, ...)',
      },
      {
        name: 'region',
        label: 'Region',
        type: 'text',
        placeholder: 'us-east-1',
        description: 'The region that is receiving the request (defaults to us-east-1)',
        optional: true,
      },
      {
        name: 'sessionToken',
        label: 'Session Token',
        type: 'text',
        password: true,
        optional: true,
        description: 'Only required if you are using temporary credentials',
      },
    ],
    onApply(_ctx, { values, ...args }): CallHttpAuthenticationResponse {
      const accessKeyId = String(values.accessKeyId || '');
      const secretAccessKey = String(values.secretAccessKey || '');
      const sessionToken = String(values.sessionToken || '') || undefined;

      const url = new URL(args.url);

      const headers: NonNullable<Request['headers']> = {};
      for (const headerName of ['content-type', 'host', 'x-amz-date', 'x-amz-security-token']) {
        const v = args.headers.find((h) => h.name.toLowerCase() === headerName);
        if (v != null) {
          headers[headerName] = v.value;
        }
      }

      // TODO: Support body signing here
      headers['x-amz-content-sha256'] = 'UNSIGNED-PAYLOAD';

      const signature = aws4.sign(
        {
          host: url.host,
          method: args.method,
          path: url.pathname + (url.search || '') || undefined,
          service: String(values.service || 'sts') || undefined,
          region: String(values.region || 'us-east-1') || undefined,
          headers,
        },
        {
          accessKeyId,
          secretAccessKey,
          sessionToken,
        },
      );

      // After signing, aws4 will set:
      //  - opts.headers["Authorization"]
      //  - opts.headers["X-Amz-Date"]
      //  - optionally content sha256 header etc

      console.log('ADDING STUFF', signature);

      if (signature.headers == null) {
        return {};
      }

      return {
        setHeaders: Object.entries(signature.headers)
          .filter(([name]) => name !== 'content-type') // Don't add this because we already have it
          .map(([name, value]) => ({ name, value: String(value || '') })),
      };
    },
  },
};
