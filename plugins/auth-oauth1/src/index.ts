import type { Context, GetHttpAuthenticationConfigRequest, PluginDefinition } from '@yaakapp/api';
import crypto from 'node:crypto';
import OAuth from 'oauth-1.0a';

const signatures = {
  HMAC_SHA1: 'HMAC-SHA1',
  HMAC_SHA256: 'HMAC-SHA256',
  HMAC_SHA512: 'HMAC-SHA512',
  RSA_SHA1: 'RSA-SHA1',
  RSA_SHA256: 'RSA-SHA256',
  RSA_SHA512: 'RSA-SHA512',
  PLAINTEXT: 'PLAINTEXT',
} as const;
const defaultSig = signatures.HMAC_SHA1;

const pkSigs = Object.values(signatures).filter((k) => k.startsWith('RSA-'));
const nonPkSigs = Object.values(signatures).filter((k) => !pkSigs.includes(k));

type SigMethod = (typeof signatures)[keyof typeof signatures];

function hiddenIfNot(
  sigMethod: SigMethod[],
  ...other: ((values: GetHttpAuthenticationConfigRequest['values']) => boolean)[]
) {
  return (_ctx: Context, { values }: GetHttpAuthenticationConfigRequest) => {
    const hasGrantType = sigMethod.find((t) => t === String(values.signatureMethod ?? defaultSig));
    const hasOtherBools = other.every((t) => t(values));
    const show = hasGrantType && hasOtherBools;
    return { hidden: !show };
  };
}

export const plugin: PluginDefinition = {
  authentication: {
    name: 'oauth1',
    label: 'OAuth 1.0',
    shortLabel: 'OAuth 1',
    args: [
      {
        name: 'signatureMethod',
        label: 'Signature Method',
        type: 'select',
        defaultValue: defaultSig,
        options: Object.values(signatures).map((v) => ({ label: v, value: v })),
      },
      { name: 'consumerKey', label: 'Consumer Key', type: 'text', password: true, optional: true },
      {
        name: 'consumerSecret',
        label: 'Consumer Secret',
        type: 'text',
        password: true,
        optional: true,
      },
      {
        name: 'tokenKey',
        label: 'Access Token',
        type: 'text',
        password: true,
        optional: true,
      },
      {
        name: 'tokenSecret',
        label: 'Token Secret',
        type: 'text',
        password: true,
        optional: true,
        dynamic: hiddenIfNot(nonPkSigs),
      },
      {
        name: 'privateKey',
        label: 'Private Key (RSA-SHA1)',
        type: 'text',
        multiLine: true,
        optional: true,
        password: true,
        placeholder:
          '-----BEGIN RSA PRIVATE KEY-----\nPrivate key in PEM format\n-----END RSA PRIVATE KEY-----',
        dynamic: hiddenIfNot(pkSigs),
      },
      {
        type: 'accordion',
        label: 'Advanced',
        inputs: [
          { name: 'callback', label: 'Callback Url', type: 'text', optional: true },
          { name: 'verifier', label: 'Verifier', type: 'text', optional: true, password: true },
          { name: 'timestamp', label: 'Timestamp', type: 'text', optional: true },
          { name: 'nonce', label: 'Nonce', type: 'text', optional: true },
          {
            name: 'version',
            label: 'OAuth Version',
            type: 'text',
            optional: true,
            defaultValue: '1.0',
          },
          { name: 'realm', label: 'Realm', type: 'text', optional: true },
        ],
      },
    ],

    onApply(
      _ctx,
      { values, method, url },
    ): {
      setHeaders?: { name: string; value: string }[];
      setQueryParameters?: { name: string; value: string }[];
    } {
      const consumerKey = String(values.consumerKey || '');
      const consumerSecret = String(values.consumerSecret || '');

      const signatureMethod = String(values.signatureMethod || signatures.HMAC_SHA1) as SigMethod;
      const version = String(values.version || '1.0');
      const realm = String(values.realm || '') || undefined;

      const oauth = new OAuth({
        consumer: { key: consumerKey, secret: consumerSecret },
        signature_method: signatureMethod,
        version,
        hash_function: hashFunction(signatureMethod),
        realm,
      });

      if (pkSigs.includes(signatureMethod)) {
        oauth.getSigningKey = (tokenSecret?: string) => tokenSecret || '';
      }

      const requestUrl = new URL(url);

      // Base request options passed to oauth-1.0a
      const requestData: Omit<OAuth.RequestOptions, 'data'> & {
        data: Record<string, string | string[]>;
      } = {
        method,
        url: requestUrl.toString(),
        includeBodyHash: false,
        data: {},
      };

      // (1) Include existing query params in signature base string
      for (const key of requestUrl.searchParams.keys()) {
        if (key.startsWith('oauth_')) continue;
        const all = requestUrl.searchParams.getAll(key);
        requestData.data[key] = all.length > 1 ? all : all[0]!;
      }

      // (2) Manual oauth_* overrides
      if (values.callback) requestData.data.oauth_callback = String(values.callback);
      if (values.nonce) requestData.data.oauth_nonce = String(values.nonce);
      if (values.timestamp) requestData.data.oauth_timestamp = String(values.timestamp);
      if (values.verifier) requestData.data.oauth_verifier = String(values.verifier);

      let token: OAuth.Token | { key: string } | undefined = undefined;

      if (pkSigs.includes(signatureMethod)) {
        token = {
          key: String(values.tokenKey || ''),
          secret: String(values.privateKey || ''),
        };
      } else if (values.tokenKey && values.tokenSecret) {
        token = { key: String(values.tokenKey), secret: String(values.tokenSecret) };
      } else if (values.tokenKey) {
        token = { key: String(values.tokenKey) };
      }

      const authParams = oauth.authorize(requestData, token as OAuth.Token | undefined);
      const { Authorization } = oauth.toHeader(authParams);
      return { setHeaders: [{ name: 'Authorization', value: Authorization }] };
    },
  },
};

function hashFunction(signatureMethod: SigMethod) {
  switch (signatureMethod) {
    case signatures.HMAC_SHA1:
      return (base: string, key: string) =>
        crypto.createHmac('sha1', key).update(base).digest('base64');
    case signatures.HMAC_SHA256:
      return (base: string, key: string) =>
        crypto.createHmac('sha256', key).update(base).digest('base64');
    case signatures.HMAC_SHA512:
      return (base: string, key: string) =>
        crypto.createHmac('sha512', key).update(base).digest('base64');
    case signatures.RSA_SHA1:
      return (base: string, privateKey: string) =>
        crypto.createSign('RSA-SHA1').update(base).sign(privateKey, 'base64');
    case signatures.RSA_SHA256:
      return (base: string, privateKey: string) =>
        crypto.createSign('RSA-SHA256').update(base).sign(privateKey, 'base64');
    case signatures.RSA_SHA512:
      return (base: string, privateKey: string) =>
        crypto.createSign('RSA-SHA512').update(base).sign(privateKey, 'base64');
    case signatures.PLAINTEXT:
      return (base: string) => base;
    default:
      return (base: string, key: string) =>
        crypto.createHmac('sha1', key).update(base).digest('base64');
  }
}
