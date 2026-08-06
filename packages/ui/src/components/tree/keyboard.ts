export type ImeKeyboardEvent = Pick<KeyboardEvent, "isComposing" | "keyCode">;

export function isImeCompositionEvent(event: ImeKeyboardEvent): boolean {
  // Safari can clear `isComposing` on the keydown that finishes composition.
  // `229` is retained as the compatibility signal that an IME is processing it.
  return event.isComposing || event.keyCode === 229;
}
