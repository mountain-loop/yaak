import { PluginContext } from '@yaakapp-internal/plugins';
import type { BootRequest, InternalEvent } from '@yaakapp/api';
import type { EventChannel } from './EventChannel';
import { PluginInstance, PluginWorkerData } from './PluginInstance';

export class PluginHandle {
  #instance: PluginInstance;

  constructor(
    pluginRefId: string,
    context: PluginContext,
    bootRequest: BootRequest,
    pluginToAppEvents: EventChannel,
  ) {
    const workerData: PluginWorkerData = { pluginRefId, context, bootRequest };
    this.#instance = new PluginInstance(workerData, pluginToAppEvents);
  }

  sendToWorker(event: InternalEvent) {
    this.#instance.postMessage(event);
  }

  async terminate() {
    await this.#instance.terminate();
  }
}
