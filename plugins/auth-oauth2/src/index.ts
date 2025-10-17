import type {
  Context,
  FormInputSelectOption,
  GetHttpAuthenticationConfigRequest,
  JsonPrimitive,
  PluginDefinition,
} from '@yaakapp/api';
import {
  genPkceCodeVerifier,
  DEFAULT_PKCE_METHOD,
  getAuthorizationCode,
  PKCE_PLAIN,
  PKCE_SHA256,
} from './grants/authorizationCode';
import { getClientCredentials } from './grants/clientCredentials';
import { getImplicit } from './grants/implicit';
import { getPassword } from './grants/password';
import type { AccessToken, TokenStoreArgs } from './store';
import { deleteToken, getToken, resetDataDirKey } from './store';

type GrantType = 'authorization_code' | 'implicit' | 'password' | 'client_credentials';

const grantTypes: FormInputSelectOption[] = [
  { label: 'Authorization Code', value: 'authorization_code' },
  { label: 'Implicit', value: 'implicit' },
  { label: 'Resource Owner Password Credential', value: 'password' },
  { label: 'Client Credentials', value: 'client_credentials' },
];

const defaultGrantType = grantTypes[0]!.value;

function hiddenIfNot(
  grantTypes: GrantType[],
  ...other: ((values: GetHttpAuthenticationConfigRequest['values']) => boolean)[]
) {
  return (_ctx: Context, { values }: GetHttpAuthenticationConfigRequest) => {
    const hasGrantType = grantTypes.find((t) => t === String(values.grantType ?? defaultGrantType));
    const hasOtherBools = other.every((t) => t(values));
    const show = hasGrantType && hasOtherBools;
    return { hidden: !show };
  };
}

const authorizationUrls = [
  'https://github.com/login/oauth/authorize',
  'https://account.box.com/api/oauth2/authorize',
  'https://accounts.google.com/o/oauth2/v2/auth',
  'https://api.imgur.com/oauth2/authorize',
  'https://bitly.com/oauth/authorize',
  'https://gitlab.example.com/oauth/authorize',
  'https://medium.com/m/oauth/authorize',
  'https://public-api.wordpress.com/oauth2/authorize',
  'https://slack.com/oauth/authorize',
  'https://todoist.com/oauth/authorize',
  'https://www.dropbox.com/oauth2/authorize',
  'https://www.linkedin.com/oauth/v2/authorization',
  'https://MY_SHOP.myshopify.com/admin/oauth/access_token',
  'https://appcenter.intuit.com/app/connect/oauth2/authorize',
];

const accessTokenUrls = [
  'https://github.com/login/oauth/access_token',
  'https://api-ssl.bitly.com/oauth/access_token',
  'https://api.box.com/oauth2/token',
  'https://api.dropboxapi.com/oauth2/token',
  'https://api.imgur.com/oauth2/token',
  'https://api.medium.com/v1/tokens',
  'https://gitlab.example.com/oauth/token',
  'https://public-api.wordpress.com/oauth2/token',
  'https://slack.com/api/oauth.access',
  'https://todoist.com/oauth/access_token',
  'https://www.googleapis.com/oauth2/v4/token',
  'https://www.linkedin.com/oauth/v2/accessToken',
  'https://MY_SHOP.myshopify.com/admin/oauth/authorize',
  'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
];

export const plugin: PluginDefinition = {
  authentication: {
    name: 'oauth2',
    label: 'OAuth 2.0',
    shortLabel: 'OAuth 2',
    actions: [
      {
        label: 'Copy Current Token',
        async onSelect(ctx, { contextId, values }) {
          const tokenArgs: TokenStoreArgs = {
            contextId,
            authorizationUrl: stringArg(values, 'authorizationUrl'),
            accessTokenUrl: stringArg(values, 'accessTokenUrl'),
            clientId: stringArg(values, 'clientId'),
          };
          const token = await getToken(ctx, tokenArgs);
          if (token == null) {
            await ctx.toast.show({ message: 'No token to copy', color: 'warning' });
          } else {
            await ctx.clipboard.copyText(token.response.access_token);
            await ctx.toast.show({
              message: 'Token copied to clipboard',
              icon: 'copy',
              color: 'success',
            });
          }
        },
      },
      {
        label: 'Delete Token',
        async onSelect(ctx, { contextId, values }) {
          const tokenArgs: TokenStoreArgs = {
            contextId,
            authorizationUrl: stringArg(values, 'authorizationUrl'),
            accessTokenUrl: stringArg(values, 'accessTokenUrl'),
            clientId: stringArg(values, 'clientId'),
          };
          if (await deleteToken(ctx, tokenArgs)) {
            await ctx.toast.show({ message: 'Token deleted', color: 'success' });
          } else {
            await ctx.toast.show({ message: 'No token to delete', color: 'warning' });
          }
        },
      },
      {
        label: 'Clear Window Session',
        async onSelect(ctx, { contextId }) {
          await resetDataDirKey(ctx, contextId);
        },
      },
      {
        label: 'Toggle Debug Logs',
        async onSelect(ctx) {
          const enableLogs = !(await ctx.store.get('enable_logs'));
          await ctx.store.set('enable_logs', enableLogs);
          await ctx.toast.show({
            message: `Debug logs ${enableLogs ? 'enabled' : 'disabled'}`,
            color: 'info',
          });
        },
      },
    ],
    args: [
      {
        type: 'select',
        name: 'grantType',
        label: 'Grant Type',
        hideLabel: true,
        defaultValue: defaultGrantType,
        options: grantTypes,
      },

      // Always-present fields
      {
        type: 'text',
        name: 'clientId',
        label: 'Client ID',
        optional: true,
      },
      {
        type: 'text',
        name: 'clientSecret',
        label: 'Client Secret',
        optional: true,
        password: true,
        dynamic: hiddenIfNot(['authorization_code', 'password', 'client_credentials']),
      },
      {
        type: 'text',
        name: 'authorizationUrl',
        optional: true,
        label: 'Authorization URL',
        dynamic: hiddenIfNot(['authorization_code', 'implicit']),
        placeholder: authorizationUrls[0],
        completionOptions: authorizationUrls.map((url) => ({ label: url, value: url })),
      },
      {
        type: 'text',
        name: 'accessTokenUrl',
        optional: true,
        label: 'Access Token URL',
        placeholder: accessTokenUrls[0],
        dynamic: hiddenIfNot(['authorization_code', 'password', 'client_credentials']),
        completionOptions: accessTokenUrls.map((url) => ({ label: url, value: url })),
      },
      {
        type: 'text',
        name: 'redirectUri',
        label: 'Redirect URI',
        optional: true,
        dynamic: hiddenIfNot(['authorization_code', 'implicit']),
      },
      {
        type: 'text',
        name: 'state',
        label: 'State',
        optional: true,
        dynamic: hiddenIfNot(['authorization_code', 'implicit']),
      },
      {
        type: 'text',
        name: 'audience',
        label: 'Audience',
        optional: true,
      },
      {
        type: 'select',
        name: 'tokenName',
        label: 'Token for authorization',
        description:
          'Select which token to send in the "Authorization: Bearer" header. Most APIs expect ' +
          'access_token, but some (like OpenID Connect) require id_token.',
        defaultValue: 'access_token',
        options: [
          { label: 'access_token', value: 'access_token' },
          { label: 'id_token', value: 'id_token' },
        ],
        dynamic: hiddenIfNot(['authorization_code', 'implicit']),
      },
      {
        type: 'checkbox',
        name: 'usePkce',
        label: 'Use PKCE',
        dynamic: hiddenIfNot(['authorization_code']),
      },
      {
        type: 'select',
        name: 'pkceChallengeMethod',
        label: 'Code Challenge Method',
        options: [
          { label: 'SHA-256', value: PKCE_SHA256 },
          { label: 'Plain', value: PKCE_PLAIN },
        ],
        defaultValue: DEFAULT_PKCE_METHOD,
        dynamic: hiddenIfNot(['authorization_code'], ({ usePkce }) => !!usePkce),
      },
      {
        type: 'text',
        name: 'pkceCodeChallenge',
        label: 'Code Verifier',
        placeholder: 'Automatically generated when not set',
        optional: true,
        dynamic: hiddenIfNot(['authorization_code'], ({ usePkce }) => !!usePkce),
      },
      {
        type: 'text',
        name: 'username',
        label: 'Username',
        optional: true,
        dynamic: hiddenIfNot(['password']),
      },
      {
        type: 'text',
        name: 'password',
        label: 'Password',
        password: true,
        optional: true,
        dynamic: hiddenIfNot(['password']),
      },
      {
        type: 'select',
        name: 'responseType',
        label: 'Response Type',
        defaultValue: 'token',
        options: [
          { label: 'Access Token', value: 'token' },
          { label: 'ID Token', value: 'id_token' },
          { label: 'ID and Access Token', value: 'id_token token' },
        ],
        dynamic: hiddenIfNot(['implicit']),
      },
      {
        type: 'accordion',
        label: 'Advanced',
        inputs: [
          { type: 'text', name: 'scope', label: 'Scope', optional: true },
          {
            type: 'text',
            name: 'headerName',
            label: 'Header Name',
            defaultValue: 'Authorization',
          },
          {
            type: 'text',
            name: 'headerPrefix',
            label: 'Header Prefix',
            optional: true,
            defaultValue: 'Bearer',
          },
          {
            type: 'select',
            name: 'credentials',
            label: 'Send Credentials',
            defaultValue: 'body',
            options: [
              { label: 'In Request Body', value: 'body' },
              { label: 'As Basic Authentication', value: 'basic' },
            ],
          },
        ],
      },
      {
        type: 'accordion',
        label: 'Access Token Response',
        async dynamic(ctx, { contextId, values }) {
          const tokenArgs: TokenStoreArgs = {
            contextId,
            authorizationUrl: stringArg(values, 'authorizationUrl'),
            accessTokenUrl: stringArg(values, 'accessTokenUrl'),
            clientId: stringArg(values, 'clientId'),
          };
          const token = await getToken(ctx, tokenArgs);
          if (token == null) {
            return { hidden: true };
          }
          return {
            label: 'Access Token Response',
            inputs: [
              {
                type: 'editor',
                defaultValue: JSON.stringify(token.response, null, 2),
                hideLabel: true,
                readOnly: true,
                language: 'json',
              },
            ],
          };
        },
      },
    ],
    async onApply(ctx, { values, contextId }) {
      const headerPrefix = stringArg(values, 'headerPrefix');
      const grantType = stringArg(values, 'grantType') as GrantType;
      const credentialsInBody = values.credentials === 'body';
      const tokenName = values.tokenName === 'id_token' ? 'id_token' : 'access_token';

      let token: AccessToken;
      if (grantType === 'authorization_code') {
        const authorizationUrl = stringArg(values, 'authorizationUrl');
        const accessTokenUrl = stringArg(values, 'accessTokenUrl');
        token = await getAuthorizationCode(ctx, contextId, {
          accessTokenUrl:
            accessTokenUrl === '' || accessTokenUrl.match(/^https?:\/\//)
              ? accessTokenUrl
              : `https://${accessTokenUrl}`,
          authorizationUrl:
            authorizationUrl === '' || authorizationUrl.match(/^https?:\/\//)
              ? authorizationUrl
              : `https://${authorizationUrl}`,
          clientId: stringArg(values, 'clientId'),
          clientSecret: stringArg(values, 'clientSecret'),
          redirectUri: stringArgOrNull(values, 'redirectUri'),
          scope: stringArgOrNull(values, 'scope'),
          audience: stringArgOrNull(values, 'audience'),
          state: stringArgOrNull(values, 'state'),
          credentialsInBody,
          pkce: values.usePkce
            ? {
                challengeMethod: stringArg(values, 'pkceChallengeMethod') || DEFAULT_PKCE_METHOD,
                codeVerifier: stringArg(values, 'pkceCodeVerifier') || genPkceCodeVerifier(),
              }
            : null,
          tokenName: tokenName,
        });
      } else if (grantType === 'implicit') {
        const authorizationUrl = stringArg(values, 'authorizationUrl');
        token = await getImplicit(ctx, contextId, {
          authorizationUrl: authorizationUrl.match(/^https?:\/\//)
            ? authorizationUrl
            : `https://${authorizationUrl}`,
          clientId: stringArg(values, 'clientId'),
          redirectUri: stringArgOrNull(values, 'redirectUri'),
          responseType: stringArg(values, 'responseType'),
          scope: stringArgOrNull(values, 'scope'),
          audience: stringArgOrNull(values, 'audience'),
          state: stringArgOrNull(values, 'state'),
          tokenName: tokenName,
        });
      } else if (grantType === 'client_credentials') {
        const accessTokenUrl = stringArg(values, 'accessTokenUrl');
        token = await getClientCredentials(ctx, contextId, {
          accessTokenUrl: accessTokenUrl.match(/^https?:\/\//)
            ? accessTokenUrl
            : `https://${accessTokenUrl}`,
          clientId: stringArg(values, 'clientId'),
          clientSecret: stringArg(values, 'clientSecret'),
          scope: stringArgOrNull(values, 'scope'),
          audience: stringArgOrNull(values, 'audience'),
          credentialsInBody,
        });
      } else if (grantType === 'password') {
        const accessTokenUrl = stringArg(values, 'accessTokenUrl');
        token = await getPassword(ctx, contextId, {
          accessTokenUrl: accessTokenUrl.match(/^https?:\/\//)
            ? accessTokenUrl
            : `https://${accessTokenUrl}`,
          clientId: stringArg(values, 'clientId'),
          clientSecret: stringArg(values, 'clientSecret'),
          username: stringArg(values, 'username'),
          password: stringArg(values, 'password'),
          scope: stringArgOrNull(values, 'scope'),
          audience: stringArgOrNull(values, 'audience'),
          credentialsInBody,
        });
      } else {
        throw new Error('Invalid grant type ' + grantType);
      }

      const headerName = stringArg(values, 'headerName') || 'Authorization';
      const headerValue = `${headerPrefix} ${token.response[tokenName]}`.trim();
      return { setHeaders: [{ name: headerName, value: headerValue }] };
    },
  },
};

function stringArgOrNull(
  values: Record<string, JsonPrimitive | undefined>,
  name: string,
): string | null {
  const arg = values[name];
  if (arg == null || arg == '') return null;
  return `${arg}`;
}

function stringArg(values: Record<string, JsonPrimitive | undefined>, name: string): string {
  const arg = stringArgOrNull(values, name);
  if (!arg) return '';
  return arg;
}
