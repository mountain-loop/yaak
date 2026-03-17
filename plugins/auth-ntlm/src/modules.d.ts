declare module "httpntlm/ntlm" {
  export interface Type2Message {
    [key: string]: unknown;
  }

  export interface NtlmOptions {
    username?: string;
    password?: string;
    domain?: string;
    workstation?: string;
  }

  export function createType1Message(options: NtlmOptions): string;
  export function parseType2Message(
    message: string,
    cb: (err: Error | null) => void,
  ): Type2Message;
  export function createType3Message(type2: Type2Message, options: NtlmOptions): string;
}
