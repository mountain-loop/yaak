import {
  CallHttpAuthenticationRequest,
  CallHttpAuthenticationResponse,
  FormInput,
  GetHttpAuthenticationConfigRequest,
  GetHttpAuthenticationSummaryResponse,
} from '../bindings/gen_events';
import { MaybePromise } from '../helpers';
import { Context } from './Context';

type DynamicFormInput = FormInput & {
  dynamic(
    ctx: Context,
    args: GetHttpAuthenticationConfigRequest,
  ): MaybePromise<Partial<FormInput> | undefined | null>;
};

export type AuthenticationPlugin = GetHttpAuthenticationSummaryResponse & {
  args: (FormInput | DynamicFormInput)[];
  onApply(
    ctx: Context,
    args: CallHttpAuthenticationRequest,
  ): MaybePromise<CallHttpAuthenticationResponse>;
};
