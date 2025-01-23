import {
  CallHttpAuthenticationRequest,
  CallHttpAuthenticationResponse,
  GetHttpAuthenticationConfigRequest,
  GetHttpAuthenticationConfigResponse,
  GetHttpAuthenticationSummaryResponse,
} from '../bindings/gen_events';
import { MaybePromise } from '../helpers';
import { Context } from './Context';

export type AuthenticationPlugin = GetHttpAuthenticationSummaryResponse & {
  config:
    | GetHttpAuthenticationConfigResponse['config']
    | ((
        ctx: Context,
        args: GetHttpAuthenticationConfigRequest,
      ) => MaybePromise<GetHttpAuthenticationConfigResponse['config']>);
  onApply(
    ctx: Context,
    args: CallHttpAuthenticationRequest,
  ): MaybePromise<CallHttpAuthenticationResponse>;
};
