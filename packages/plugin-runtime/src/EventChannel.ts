import type { InternalEvent } from '@yaakapp/api';
import EventEmitter from 'node:events';
import type { EventStreamEvent } from './gen/plugins/runtime';

export class EventChannel {
  emitter: EventEmitter = new EventEmitter();

  emit(e: InternalEvent) {
    this.emitter.emit('__plugin_event__', { event: JSON.stringify(e) });
  }

  async *listen(): AsyncGenerator<EventStreamEvent> {
    while (true) {
      yield new Promise<EventStreamEvent>((resolve) => {
        this.emitter.once('__plugin_event__', (event: EventStreamEvent) => {
          resolve(event);
        });
      });
    }
  }
}
