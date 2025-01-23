import {
  CallHttpAuthenticationRequest,
  CallHttpAuthenticationResponse,
  FormInput,
  GetHttpAuthenticationConfigRequest,
  GetHttpAuthenticationSummaryResponse,
} from '../bindings/gen_events';
import { MaybePromise } from '../helpers';
import { Context } from './Context';

type DynamicFormInput = Pick<FormInput, 'name' | 'type' | 'defaultValue'> & {
  dynamic: (
    args: GetHttpAuthenticationConfigRequest,
  ) => MaybePromise<Omit<FormInput, 'name' | 'type' | 'defaultValue'>>;
};

export type AuthenticationPlugin = GetHttpAuthenticationSummaryResponse & {
  config: (FormInput | DynamicFormInput)[];
  onApply(
    ctx: Context,
    args: CallHttpAuthenticationRequest,
  ): MaybePromise<CallHttpAuthenticationResponse>;
};
