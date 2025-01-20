import type { BootRequest, InternalEvent } from '@yaakapp/api';
import { Worker } from 'node:worker_threads';
import type { EventChannel } from './EventChannel';
import type { PluginWorkerData } from './index.worker';
import path from 'node:path';

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
    const workerPath = path.join(__dirname, './index.worker.cjs');
    const workerData: PluginWorkerData = {
      pluginRefId: this.pluginRefId,
      bootRequest: this.bootRequest,
    };
    const worker = new Worker(workerPath, {
      workerData,
      deno: {
        permissions: 'none',
      },
    });

    worker.on('message', (e: InternalEvent) => this.events.emit(e));
    worker.on('error', this.#handleError.bind(this));
    worker.on('exit', this.#handleExit.bind(this));

    console.log('Created plugin worker for ', this.bootRequest.dir);

    return worker;
  }

  #handleError(err: Error) {
    console.error('Plugin errored', this.bootRequest.dir, err);
  }

  #handleExit(code: number) {
    if (code === 0) {
      console.log('Plugin exited successfully', this.bootRequest.dir);
    } else {
      console.log('Plugin exited with status', code, this.bootRequest.dir);
    }
  }
}
