import type { InternalEvent } from '@yaakapp/api';
import { EventChannel } from './EventChannel';
import { PluginHandle } from './PluginHandle';
import WebSocket from 'ws';

const port = process.env.PORT;
if (!port) {
  throw new Error('Plugin runtime missing PORT')
}

const events = new EventChannel();
const plugins: Record<string, PluginHandle> = {};

const ws = new WebSocket(`ws://localhost:${port}`);

ws.on('message', async (e: Buffer) => {
  try {
    await handleIncoming(e.toString());
  } catch (err) {
    console.log('Failed to handle incoming plugin event', err);
  }
});
ws.on('open', () => console.log('Plugin runtime connected to websocket'));
ws.on('error', (err: any) => console.error('Plugin runtime websocket error', err));
ws.on('close', (code: number) => console.log('Plugin runtime websocket closed', code));

// Listen for incoming events from plugins
events.listen((e) => {
  const eventStr = JSON.stringify(e);
  ws.send(eventStr);
});

async function handleIncoming(msg: string) {
  const pluginEvent: InternalEvent = JSON.parse(msg);
  // Handle special event to bootstrap plugin
  if (pluginEvent.payload.type === 'boot_request') {
    const plugin = new PluginHandle(pluginEvent.pluginRefId, pluginEvent.payload, events);
    plugins[pluginEvent.pluginRefId] = plugin;
  }

  // Once booted, forward all events to the plugin worker
  const plugin = plugins[pluginEvent.pluginRefId];
  if (!plugin) {
    console.warn('Failed to get plugin for event by', pluginEvent.pluginRefId);
    return;
  }

  if (pluginEvent.payload.type === 'terminate_request') {
    await plugin.terminate();
    console.log('Terminated plugin worker', pluginEvent.pluginRefId);
    delete plugins[pluginEvent.pluginRefId];
  }

  plugin.sendToWorker(pluginEvent);
}
