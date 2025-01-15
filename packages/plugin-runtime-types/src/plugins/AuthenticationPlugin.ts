import {CallHttpAuthenticationRequest, CallHttpAuthenticationResponse, GetHttpAuthenticationResponse} from '..';
import type { Context } from './Context';

export type AuthenticationPlugin = GetHttpAuthenticationResponse & {
  onApply(
    ctx: Context,
    args: CallHttpAuthenticationRequest,
  ): Promise<CallHttpAuthenticationResponse> | CallHttpAuthenticationResponse;
};
