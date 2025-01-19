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
    console.log("FAILED TO HANDLE", err);
  }
});
ws.addEventListener('open', (e) => {
  console.log('WEBSOCKET CONNECTION OPENED');
});
ws.addEventListener('error', (e) => {
  console.log('WEBSOCKET CONNECTION ERROR', e);
});
ws.addEventListener('close', (e) => {
  console.log('WEBSOCKET CONNECTION CLOSE', e);
});

// Listen for incoming events from plugins
events.listen(e => {
  console.log('SENDING EVENT TO APP', e);
  ws.send(JSON.stringify(e, null, 2));
})

async function handleIncoming(msg: MessageEvent) {
  const pluginEvent: InternalEvent = JSON.parse(msg.data);
  console.log('WEBSOCKET CONNECTION MESSAGE', pluginEvent);
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
