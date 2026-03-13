import type { InternalEvent } from "@yaakapp/api";

export class EventChannel {
  #listeners = new Set<(event: InternalEvent) => void>();

  emit(e: InternalEvent) {
    for (const l of this.#listeners) {
      l(e);
    }
  }

  listen(cb: (e: InternalEvent) => void) {
    this.#listeners.add(cb);
  }

  unlisten(cb: (e: InternalEvent) => void) {
    this.#listeners.delete(cb);
  }
}
