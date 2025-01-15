import {CallHttpAuthenticationRequest, CallHttpAuthenticationResponse, GetHttpAuthenticationResponse} from '..';
import type { Context } from './Context';

export type AuthenticationPlugin = Omit<GetHttpAuthenticationResponse, 'pluginName'> & {
  onApply(
    ctx: Context,
    args: CallHttpAuthenticationRequest,
  ): Promise<CallHttpAuthenticationResponse> | CallHttpAuthenticationResponse;
};
