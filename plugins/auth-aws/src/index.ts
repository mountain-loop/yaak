import type { CallHttpAuthenticationResponse } from '@yaakapp-internal/plugins';
import type { PluginDefinition } from '@yaakapp/api';
import aws4 from 'aws4';
import type { Request } from 'aws4';
import { URL } from 'node:url';
import { fromIni } from "@aws-sdk/credential-providers";

export const plugin: PluginDefinition = {
  authentication: {
    name: 'awsv4',
    label: 'AWS Signature',
    shortLabel: 'AWS v4',
    args: [
      {
        name: 'accessKeyId',
        label: 'Access Key ID',
        type: 'text',
        password: false,
        optional: true,
      },
      {
        name: 'secretAccessKey',
        label: 'Secret Access Key',
        type: 'text',
        password: true,
        optional: true,
      },
      {
        name: 'service',
        label: 'Service Name',
        type: 'text',
        defaultValue: 'sts',
        placeholder: 'sts',
        description: 'The service that is receiving the request (sts, s3, sqs, ...)',
        optional: true,
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
      {
        name: 'profileName',
        label: 'Profile Name',
        type: 'text',
        password: false,
        optional: true,
        description: 'If set, will load credentials from the AWS credentials file using this profile name (overrides other parameters)',
      },
    ],
    async onApply(_ctx, {values, ...args}): Promise<CallHttpAuthenticationResponse> {

      const profileName = String(values.profile || '') || undefined;
      const service = String(values.service || 'sts')
      let accessKeyId = String(values.accessKeyId || '');
      let secretAccessKey = String(values.secretAccessKey || '');
      let sessionToken = String(values.sessionToken || '') || undefined;

      if (!accessKeyId || !secretAccessKey) {
        try {
          const credentialsProvider = fromIni({
            profile: profileName,
            ignoreCache: true
          });
          const credentials = await credentialsProvider();
          accessKeyId = credentials.accessKeyId;
          secretAccessKey = credentials.secretAccessKey;
          sessionToken = credentials.sessionToken;
        } catch {
          throw Error(`Failed to fetch credentials from AWS profile.`);
        }
      }

      const url = new URL(args.url);

      const headers: NonNullable<Request['headers']> = {};
      for (const headerName of ['content-type', 'host', 'x-amz-date', 'x-amz-security-token']) {
        const v = args.headers.find((h) => h.name.toLowerCase() === headerName);
        if (v != null) {
          headers[headerName] = v.value;
        }
      }

      if (service !== 'lambda') {
        headers['x-amz-content-sha256'] = 'UNSIGNED-PAYLOAD';
      }

      const signature = aws4.sign(
        {
          host: url.host,
          method: args.method,
          path: url.pathname + (url.search || ''),
          service: service,
          region: values.region ? String(values.region) : undefined,
          headers: headers,
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
