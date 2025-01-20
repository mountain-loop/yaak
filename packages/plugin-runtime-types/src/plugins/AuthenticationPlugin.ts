import {
  CallHttpAuthenticationRequest,
  CallHttpAuthenticationResponse,
  GetHttpAuthenticationResponse,
} from '../bindings/events';
import { Context } from './Context';

export type AuthenticationPlugin = Omit<GetHttpAuthenticationResponse, 'pluginName'> & {
  onApply(
    ctx: Context,
    args: CallHttpAuthenticationRequest,
  ): Promise<CallHttpAuthenticationResponse> | CallHttpAuthenticationResponse;
};
