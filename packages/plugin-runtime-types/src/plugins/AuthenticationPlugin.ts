import {
  CallHttpAuthenticationActionArgs,
  CallHttpAuthenticationRequest,
  CallHttpAuthenticationResponse,
  FormInput,
  GetHttpAuthenticationSummaryResponse,
  HttpAuthenticationAction,
} from '../bindings/gen_events';
import { MaybePromise } from '../helpers';
import { Context } from './Context';

type AddDynamicMethod<T> = {
  dynamic?: (
    ctx: Context,
    args: CallHttpAuthenticationActionArgs,
  ) => MaybePromise<Partial<T> | null | undefined>;
};

type AddDynamic<T> = T extends any
  ? T extends { inputs?: FormInput[] }
    ? Omit<T, 'inputs'> & {
        inputs: Array<AddDynamic<FormInput>>;
        dynamic?: (
          ctx: Context,
          args: CallHttpAuthenticationActionArgs,
        ) => MaybePromise<
          Partial<Omit<T, 'inputs'> & { inputs: Array<AddDynamic<FormInput>> }> | null | undefined
        >;
      }
    : T & AddDynamicMethod<T>
  : never;

export type DynamicAuthenticationArg = AddDynamic<FormInput>;

export type AuthenticationPlugin = GetHttpAuthenticationSummaryResponse & {
  args: DynamicAuthenticationArg[];
  onApply(
    ctx: Context,
    args: CallHttpAuthenticationRequest,
  ): MaybePromise<CallHttpAuthenticationResponse>;
  actions?: (HttpAuthenticationAction & {
    onSelect(ctx: Context, args: CallHttpAuthenticationActionArgs): Promise<void> | void;
  })[];
};
