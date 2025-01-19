import type { BootRequest, InternalEvent } from '@yaakapp-internal/plugins';
import { Worker } from 'node:worker_threads';
import type { EventChannel } from './EventChannel';
import type { PluginWorkerData } from './index.worker';

export class PluginHandle {
  #worker: Worker;

  constructor(
    readonly pluginRefId: string,
    readonly bootRequest: BootRequest,
    readonly events: EventChannel,
  ) {
    this.#worker = this.#createWorker();
  }

  sendToWorker(event: InternalEvent) {
    this.#worker.postMessage(event);
  }

  async terminate() {
    await this.#worker.terminate();
  }

  #createWorker(): Worker {
    const workerUrl = new URL('./index.worker.ts', import.meta.url).href;
    const workerData: PluginWorkerData = {
      pluginRefId: this.pluginRefId,
      bootRequest: this.bootRequest,
    };
    const worker = new Worker(workerUrl, {
      type: 'module',
      workerData,
    });

    worker.on('message', (e) => this.events.emit(e));
    worker.on('error', this.#handleError.bind(this));
    worker.on('exit', this.#handleExit.bind(this));

    console.log('Created plugin worker for ', this.bootRequest.dir);

    return worker;
  }

  async #handleError(err: Error) {
    console.error('Plugin errored', this.bootRequest.dir, err);
  }

  async #handleExit(code: number) {
    if (code === 0) {
      console.log('Plugin exited successfully', this.bootRequest.dir);
    } else {
      console.log('Plugin exited with status', code, this.bootRequest.dir);
    }
  }
}
