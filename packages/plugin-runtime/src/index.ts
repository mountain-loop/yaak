import type { InternalEvent } from '@yaakapp/api';
import { EventChannel } from './EventChannel';
import { PluginHandle } from './PluginHandle';

const port = process.env.PORT || '50051';

const events = new EventChannel();
const plugins: Record<string, PluginHandle> = {};

const ws = new WebSocket(`ws://localhost:${port}`);
ws.addEventListener('message', async (e) => {
  try {
    await handleIncoming(e);
  } catch (err) {
    console.log('Failed to handle incoming plugin event', err);
  }
});
ws.addEventListener('open', () => {
  console.log('Plugin runtime connected to websocket');
});
ws.addEventListener('error', (e) => {
  console.error('Plugin runtime websocket error', e);
});
ws.addEventListener('close', () => {
  console.log('Plugin runtime websocket closed');
});

// Listen for incoming events from plugins
events.listen((e) => {
  const eventStr = JSON.stringify(e);
  ws.send(eventStr);
});

async function handleIncoming(msg: MessageEvent) {
  const pluginEvent: InternalEvent = JSON.parse(msg.data);
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
