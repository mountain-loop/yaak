import type { BootRequest, InternalEvent } from '@yaakapp/api';
import type { EventChannel } from './EventChannel';
import { PluginInstance, PluginWorkerData } from './PluginInstance';

export class PluginHandle {
  #instance: PluginInstance;

  constructor(
    readonly pluginRefId: string,
    readonly bootRequest: BootRequest,
    readonly pluginToAppEvents: EventChannel,
  ) {
    const workerData: PluginWorkerData = {
      pluginRefId: this.pluginRefId,
      bootRequest: this.bootRequest,
    };
    this.#instance = new PluginInstance(workerData, pluginToAppEvents);
  }

  sendToWorker(event: InternalEvent) {
    this.#instance.postMessage(event);
  }

  terminate() {
    this.#instance.terminate();
  }
}
