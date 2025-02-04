import type { InternalEvent } from "@yaakapp/api";
import EventEmitter from "node:events";

export class EventChannel {
  emitter: EventEmitter = new EventEmitter();

  emit(e: InternalEvent) {
    this.emitter.emit("__plugin_event__", e);
  }

  listen(cb: (e: InternalEvent) => void) {
    this.emitter.on("__plugin_event__", cb);
  }
}
