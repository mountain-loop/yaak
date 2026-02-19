use crate::error::Error::{
    self, AuthPluginNotFound, ClientNotInitializedErr, PluginErr, PluginNotFoundErr,
    UnknownEventErr,
};
use crate::error::Result;
use crate::events::{
    BootRequest, CallFolderActionRequest, CallGrpcRequestActionRequest,
    CallHttpAuthenticationActionArgs, CallHttpAuthenticationActionRequest,
    CallHttpAuthenticationRequest, CallHttpAuthenticationResponse, CallHttpRequestActionRequest,
    CallTemplateFunctionArgs, CallTemplateFunctionRequest, CallTemplateFunctionResponse,
    CallWebsocketRequestActionRequest, CallWorkspaceActionRequest, EmptyPayload, ErrorResponse,
    FilterRequest, FilterResponse, GetFolderActionsResponse, GetGrpcRequestActionsResponse,
    GetHttpAuthenticationConfigRequest, GetHttpAuthenticationConfigResponse,
    GetHttpAuthenticationSummaryResponse, GetHttpRequestActionsResponse,
    GetTemplateFunctionConfigRequest, GetTemplateFunctionConfigResponse,
    GetTemplateFunctionSummaryResponse, GetThemesRequest, GetThemesResponse,
    GetWebsocketRequestActionsResponse, GetWorkspaceActionsResponse, ImportRequest, ImportResponse,
    InternalEvent, InternalEventPayload, JsonPrimitive, PluginContext, RenderPurpose,
    ShowToastRequest,
};
use crate::native_template_functions::{template_function_keyring, template_function_secure};
use crate::nodejs::start_nodejs_plugin_runtime;
use crate::plugin_handle::PluginHandle;
use crate::server_ws::PluginRuntimeServerWebsocket;
use log::{error, info, warn};
use std::collections::HashMap;
use std::env;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::fs::read_dir;
use tokio::net::TcpListener;
use tokio::sync::mpsc::error::TrySendError;
use tokio::sync::{Mutex, mpsc, oneshot};
use tokio::time::{Instant, timeout};
use yaak_models::models::Plugin;
use yaak_models::util::generate_id;
use yaak_templates::error::Error::RenderError;
use yaak_templates::error::Result as TemplateResult;

#[derive(Clone)]
pub struct PluginManager {
    subscribers: Arc<Mutex<HashMap<String, mpsc::Sender<InternalEvent>>>>,
    plugin_handles: Arc<Mutex<Vec<PluginHandle>>>,
    kill_tx: tokio::sync::watch::Sender<bool>,
    killed_rx: Arc<Mutex<Option<oneshot::Receiver<()>>>>,
    ws_service: Arc<PluginRuntimeServerWebsocket>,
    vendored_plugin_dir: PathBuf,
    pub(crate) installed_plugin_dir: PathBuf,
    dev_mode: bool,
}

/// Callback for plugin initialization events (e.g., toast notifications)
pub type PluginInitCallback = Box<dyn Fn(ShowToastRequest) + Send + Sync>;

impl PluginManager {
    /// Create a new PluginManager with the given paths.
    ///
    /// # Arguments
    /// * `vendored_plugin_dir` - Path to vendored plugins directory
    /// * `installed_plugin_dir` - Path to installed plugins directory
    /// * `node_bin_path` - Path to the yaaknode binary
    /// * `plugin_runtime_main` - Path to the plugin runtime index.cjs
    /// * `dev_mode` - Whether the app is in dev mode (affects plugin loading)
    pub async fn new(
        vendored_plugin_dir: PathBuf,
        installed_plugin_dir: PathBuf,
        node_bin_path: PathBuf,
        plugin_runtime_main: PathBuf,
        dev_mode: bool,
    ) -> PluginManager {
        let (events_tx, mut events_rx) = mpsc::channel(2048);
        let (kill_server_tx, kill_server_rx) = tokio::sync::watch::channel(false);
        let (killed_tx, killed_rx) = oneshot::channel();

        let (client_disconnect_tx, mut client_disconnect_rx) = mpsc::channel(128);
        let (client_connect_tx, mut client_connect_rx) = tokio::sync::watch::channel(false);
        let ws_service =
            PluginRuntimeServerWebsocket::new(events_tx, client_disconnect_tx, client_connect_tx);

        let plugin_manager = PluginManager {
            plugin_handles: Default::default(),
            subscribers: Default::default(),
            ws_service: Arc::new(ws_service.clone()),
            kill_tx: kill_server_tx,
            killed_rx: Arc::new(Mutex::new(Some(killed_rx))),
            vendored_plugin_dir,
            installed_plugin_dir,
            dev_mode,
        };

        // Forward events to subscribers
        let subscribers = plugin_manager.subscribers.clone();
        tokio::spawn(async move {
            while let Some(event) = events_rx.recv().await {
                for (tx_id, tx) in subscribers.lock().await.iter_mut() {
                    if let Err(e) = tx.try_send(event.clone()) {
                        match e {
                            TrySendError::Full(e) => {
                                error!("Failed to send event to full subscriber {tx_id} {e:?}");
                            }
                            TrySendError::Closed(_) => {
                                // Subscriber already unsubscribed
                            }
                        }
                    }
                }
            }
        });

        // Handle when client plugin runtime disconnects
        tokio::spawn(async move {
            while (client_disconnect_rx.recv().await).is_some() {
                // Happens when the app is closed
                info!("Plugin runtime client disconnected");
            }
        });

        let listen_addr = match option_env!("YAAK_PLUGIN_SERVER_PORT") {
            Some(port) => format!("127.0.0.1:{port}"),
            None => "127.0.0.1:0".to_string(),
        };
        let listener = TcpListener::bind(listen_addr).await.expect("Failed to bind TCP listener");
        let addr = listener.local_addr().expect("Failed to get local address");

        // 1. Wait for Node.js runtime to connect
        let init_plugins_task = tokio::spawn(async move {
            match client_connect_rx.changed().await {
                Ok(_) => {
                    info!("Plugin runtime client connected!");
                    // Note: initialize_all_plugins is now called separately by the app
                    // after setting up the plugin list
                }
                Err(e) => {
                    warn!("Failed to receive from client connection rx {e:?}");
                }
            }
        });

        // 1. Spawn server in the background
        info!("Starting plugin server on {addr}");
        tokio::spawn(async move {
            ws_service.listen(listener).await;
        });

        // 2. Start Node.js runtime
        start_nodejs_plugin_runtime(
            &node_bin_path,
            &plugin_runtime_main,
            addr,
            &kill_server_rx,
            killed_tx,
        )
        .await
        .unwrap();
        info!("Waiting for plugins to initialize");
        init_plugins_task.await.unwrap();

        plugin_manager
    }

    /// Get the vendored plugin directory path (resolves dev mode path if applicable)
    pub fn get_plugins_dir(&self) -> PathBuf {
        if self.dev_mode {
            // Use plugins directly for easy development
            // Tauri runs from crates-tauri/yaak-app/, so go up two levels to reach project root
            env::current_dir()
                .map(|cwd| cwd.join("../../plugins").canonicalize().unwrap())
                .unwrap_or_else(|_| self.vendored_plugin_dir.clone())
        } else {
            self.vendored_plugin_dir.clone()
        }
    }

    /// Read plugin directories from disk and return their paths.
    /// This is useful for discovering bundled plugins.
    pub async fn list_bundled_plugin_dirs(&self) -> Result<Vec<String>> {
        let plugins_dir = self.get_plugins_dir();
        info!("Loading bundled plugins from {plugins_dir:?}");
        read_plugins_dir(&plugins_dir).await
    }

    pub async fn uninstall(&self, plugin_context: &PluginContext, dir: &str) -> Result<()> {
        let plugin = self.get_plugin_by_dir(dir).await.ok_or(PluginNotFoundErr(dir.to_string()))?;
        self.remove_plugin(plugin_context, &plugin).await
    }

    async fn remove_plugin(
        &self,
        plugin_context: &PluginContext,
        plugin: &PluginHandle,
    ) -> Result<()> {
        // Terminate the plugin if it's enabled
        if plugin.enabled {
            self.send_to_plugin_and_wait(
                plugin_context,
                plugin,
                &InternalEventPayload::TerminateRequest,
                Duration::from_secs(5),
            )
            .await?;
        }

        // Remove the plugin from the list
        let mut plugins = self.plugin_handles.lock().await;
        let pos = plugins.iter().position(|p| p.ref_id == plugin.ref_id);
        if let Some(pos) = pos {
            plugins.remove(pos);
        }

        Ok(())
    }

    pub async fn add_plugin(&self, plugin_context: &PluginContext, plugin: &Plugin) -> Result<()> {
        info!("Adding plugin by dir {}", plugin.directory);

        let maybe_tx = self.ws_service.app_to_plugin_events_tx.lock().await;
        let tx = match &*maybe_tx {
            None => return Err(ClientNotInitializedErr),
            Some(tx) => tx,
        };
        let plugin_handle = PluginHandle::new(&plugin.directory, plugin.enabled, tx.clone())?;
        let dir_path = Path::new(&plugin.directory);
        let is_vendored = dir_path.starts_with(self.vendored_plugin_dir.as_path());
        let is_installed = dir_path.starts_with(self.installed_plugin_dir.as_path());

        // Boot the plugin if it's enabled
        if plugin.enabled {
            let event = self
                .send_to_plugin_and_wait(
                    plugin_context,
                    &plugin_handle,
                    &InternalEventPayload::BootRequest(BootRequest {
                        dir: plugin.directory.clone(),
                        watch: !is_vendored && !is_installed,
                    }),
                    Duration::from_secs(5),
                )
                .await?;

            if !matches!(event.payload, InternalEventPayload::BootResponse) {
                // Add it to the plugin handles anyway...
                let mut plugin_handles = self.plugin_handles.lock().await;
                plugin_handles.retain(|p| p.dir != plugin.directory);
                plugin_handles.push(plugin_handle.clone());
                return Err(UnknownEventErr);
            }
        }

        let mut plugin_handles = self.plugin_handles.lock().await;
        plugin_handles.retain(|p| p.dir != plugin.directory);
        plugin_handles.push(plugin_handle.clone());

        Ok(())
    }

    /// Initialize all plugins from the provided list.
    /// Returns a list of (plugin_directory, error_message) for any plugins that failed to initialize.
    pub async fn initialize_all_plugins(
        &self,
        plugins: Vec<Plugin>,
        plugin_context: &PluginContext,
    ) -> Vec<(String, String)> {
        info!("Initializing all plugins");
        let start = Instant::now();
        let mut errors = Vec::new();

        for plugin in plugins {
            // First remove the plugin if it exists and is enabled
            if let Some(plugin_handle) = self.get_plugin_by_dir(&plugin.directory).await {
                if let Err(e) = self.remove_plugin(plugin_context, &plugin_handle).await {
                    error!("Failed to remove plugin {} {e:?}", plugin.directory);
                    continue;
                }
            }
            if let Err(e) = self.add_plugin(plugin_context, &plugin).await {
                warn!("Failed to add plugin {} {e:?}", plugin.directory);
                errors.push((plugin.directory.clone(), e.to_string()));
            }
        }

        let plugin_handles = self.plugin_handles.lock().await;
        let names = plugin_handles.iter().map(|p| p.dir.to_string()).collect::<Vec<String>>();
        info!(
            "Initialized {} plugins in {:?}:\n  - {}",
            plugin_handles.len(),
            start.elapsed(),
            names.join("\n  - "),
        );

        errors
    }

    pub async fn subscribe(&self, label: &str) -> (String, mpsc::Receiver<InternalEvent>) {
        let (tx, rx) = mpsc::channel(2048);
        let rx_id = format!("{label}_{}", generate_id());
        self.subscribers.lock().await.insert(rx_id.clone(), tx);
        (rx_id, rx)
    }

    pub async fn unsubscribe(&self, rx_id: &str) {
        self.subscribers.lock().await.remove(rx_id);
    }

    pub async fn terminate(&self) {
        self.kill_tx.send_replace(true);

        // Wait for the plugin runtime process to actually exit
        let killed_rx = self.killed_rx.lock().await.take();
        if let Some(rx) = killed_rx {
            if timeout(Duration::from_secs(5), rx).await.is_err() {
                warn!("Timed out waiting for plugin runtime to exit");
            } else {
                info!("Plugin runtime exited")
            }
        }
    }

    pub async fn reply(
        &self,
        source_event: &InternalEvent,
        payload: &InternalEventPayload,
    ) -> Result<()> {
        let plugin_context = source_event.to_owned().context;
        let reply_id = Some(source_event.to_owned().id);
        let plugin = self
            .get_plugin_by_ref_id(source_event.plugin_ref_id.as_str())
            .await
            .ok_or(PluginNotFoundErr(source_event.plugin_ref_id.to_string()))?;
        let event = plugin.build_event_to_send_raw(&plugin_context, &payload, reply_id);
        plugin.send(&event).await
    }

    pub async fn get_plugin_by_ref_id(&self, ref_id: &str) -> Option<PluginHandle> {
        self.plugin_handles.lock().await.iter().find(|p| p.ref_id == ref_id).cloned()
    }

    pub async fn get_plugin_by_dir(&self, dir: &str) -> Option<PluginHandle> {
        self.plugin_handles.lock().await.iter().find(|p| p.dir == dir).cloned()
    }

    pub async fn get_plugin_by_name(&self, name: &str) -> Option<PluginHandle> {
        for plugin in self.plugin_handles.lock().await.iter().cloned() {
            let info = plugin.info();
            if info.name == name {
                return Some(plugin);
            }
        }
        None
    }

    async fn send_to_plugin_and_wait(
        &self,
        plugin_context: &PluginContext,
        plugin: &PluginHandle,
        payload: &InternalEventPayload,
        timeout_duration: Duration,
    ) -> Result<InternalEvent> {
        if !plugin.enabled {
            return Err(Error::PluginErr(format!("Plugin {} is disabled", plugin.metadata.name)));
        }

        let events = self
            .send_to_plugins_and_wait(
                plugin_context,
                payload,
                vec![plugin.to_owned()],
                timeout_duration,
            )
            .await?;
        Ok(events
            .first()
            .ok_or(Error::PluginErr(format!(
                "No plugin events returned for: {}",
                plugin.metadata.name
            )))?
            .to_owned())
    }

    async fn send_and_wait(
        &self,
        plugin_context: &PluginContext,
        payload: &InternalEventPayload,
        timeout_duration: Duration,
    ) -> Result<Vec<InternalEvent>> {
        let plugins = { self.plugin_handles.lock().await.clone() };
        self.send_to_plugins_and_wait(plugin_context, payload, plugins, timeout_duration).await
    }

    async fn send_to_plugins_and_wait(
        &self,
        plugin_context: &PluginContext,
        payload: &InternalEventPayload,
        plugins: Vec<PluginHandle>,
        timeout_duration: Duration,
    ) -> Result<Vec<InternalEvent>> {
        let event_type = payload.type_name();
        let label = format!("wait[{}.{}]", plugins.len(), event_type);
        let (rx_id, mut rx) = self.subscribe(label.as_str()).await;

        // 1. Build the events with IDs and everything
        let events_to_send = plugins
            .iter()
            .filter(|p| p.enabled)
            .map(|p| p.build_event_to_send(plugin_context, payload, None))
            .collect::<Vec<InternalEvent>>();

        // 2. Spawn thread to subscribe to incoming events and check reply ids
        let sub_events_fut = {
            let events_to_send = events_to_send.clone();

            tokio::spawn(async move {
                let mut found_events = Vec::new();

                let collect_events = async {
                    while let Some(event) = rx.recv().await {
                        let matched_sent_event =
                            events_to_send.iter().any(|e| Some(e.id.to_owned()) == event.reply_id);
                        if matched_sent_event {
                            found_events.push(event.clone());
                        };

                        let found_them_all = found_events.len() == events_to_send.len();
                        if found_them_all {
                            break;
                        }
                    }
                };

                // Timeout to prevent hanging forever if plugin doesn't respond
                if timeout(timeout_duration, collect_events).await.is_err() {
                    let responded_ids: Vec<&String> =
                        found_events.iter().filter_map(|e| e.reply_id.as_ref()).collect();
                    let non_responding: Vec<&str> = events_to_send
                        .iter()
                        .filter(|e| !responded_ids.contains(&&e.id))
                        .map(|e| e.plugin_name.as_str())
                        .collect();
                    warn!(
                        "Timeout ({:?}) waiting for {} responses. Got {}/{} responses. \
                        Non-responding plugins: [{}]",
                        timeout_duration,
                        event_type,
                        found_events.len(),
                        events_to_send.len(),
                        non_responding.join(", ")
                    );
                }

                found_events
            })
        };

        // 3. Send the events
        for event in events_to_send {
            let plugin = plugins
                .iter()
                .find(|p| p.ref_id == event.plugin_ref_id)
                .expect("Didn't find plugin in list");
            plugin.send(&event).await?
        }

        // 4. Join on the spawned thread
        let events = sub_events_fut.await.expect("Thread didn't succeed");

        // 5. Unsubscribe
        self.unsubscribe(&rx_id).await;

        Ok(events)
    }

    pub async fn get_themes(
        &self,
        plugin_context: &PluginContext,
    ) -> Result<Vec<GetThemesResponse>> {
        let reply_events = self
            .send_and_wait(
                plugin_context,
                &InternalEventPayload::GetThemesRequest(GetThemesRequest {}),
                Duration::from_secs(5),
            )
            .await?;

        let mut themes = Vec::new();
        for event in reply_events {
            if let InternalEventPayload::GetThemesResponse(resp) = event.payload {
                themes.push(resp.clone());
            }
        }

        Ok(themes)
    }

    pub async fn get_grpc_request_actions(
        &self,
        plugin_context: &PluginContext,
    ) -> Result<Vec<GetGrpcRequestActionsResponse>> {
        let reply_events = self
            .send_and_wait(
                plugin_context,
                &InternalEventPayload::GetGrpcRequestActionsRequest(EmptyPayload {}),
                Duration::from_secs(5),
            )
            .await?;

        let mut all_actions = Vec::new();
        for event in reply_events {
            if let InternalEventPayload::GetGrpcRequestActionsResponse(resp) = event.payload {
                all_actions.push(resp.clone());
            }
        }

        Ok(all_actions)
    }

    pub async fn get_http_request_actions(
        &self,
        plugin_context: &PluginContext,
    ) -> Result<Vec<GetHttpRequestActionsResponse>> {
        let reply_events = self
            .send_and_wait(
                plugin_context,
                &InternalEventPayload::GetHttpRequestActionsRequest(EmptyPayload {}),
                Duration::from_secs(5),
            )
            .await?;

        let mut all_actions = Vec::new();
        for event in reply_events {
            if let InternalEventPayload::GetHttpRequestActionsResponse(resp) = event.payload {
                all_actions.push(resp.clone());
            }
        }

        Ok(all_actions)
    }

    pub async fn get_websocket_request_actions(
        &self,
        plugin_context: &PluginContext,
    ) -> Result<Vec<GetWebsocketRequestActionsResponse>> {
        let reply_events = self
            .send_and_wait(
                plugin_context,
                &InternalEventPayload::GetWebsocketRequestActionsRequest(EmptyPayload {}),
                Duration::from_secs(5),
            )
            .await?;

        let mut all_actions = Vec::new();
        for event in reply_events {
            if let InternalEventPayload::GetWebsocketRequestActionsResponse(resp) = event.payload {
                all_actions.push(resp.clone());
            }
        }

        Ok(all_actions)
    }

    pub async fn get_workspace_actions(
        &self,
        plugin_context: &PluginContext,
    ) -> Result<Vec<GetWorkspaceActionsResponse>> {
        let reply_events = self
            .send_and_wait(
                plugin_context,
                &InternalEventPayload::GetWorkspaceActionsRequest(EmptyPayload {}),
                Duration::from_secs(5),
            )
            .await?;

        let mut all_actions = Vec::new();
        for event in reply_events {
            if let InternalEventPayload::GetWorkspaceActionsResponse(resp) = event.payload {
                all_actions.push(resp.clone());
            }
        }

        Ok(all_actions)
    }

    pub async fn get_folder_actions(
        &self,
        plugin_context: &PluginContext,
    ) -> Result<Vec<GetFolderActionsResponse>> {
        let reply_events = self
            .send_and_wait(
                plugin_context,
                &InternalEventPayload::GetFolderActionsRequest(EmptyPayload {}),
                Duration::from_secs(5),
            )
            .await?;

        let mut all_actions = Vec::new();
        for event in reply_events {
            if let InternalEventPayload::GetFolderActionsResponse(resp) = event.payload {
                all_actions.push(resp.clone());
            }
        }

        Ok(all_actions)
    }

    /// Get template function config.
    /// Note: Values should be pre-rendered by the caller if needed.
    pub async fn get_template_function_config(
        &self,
        plugin_context: &PluginContext,
        fn_name: &str,
        rendered_values: HashMap<String, JsonPrimitive>,
        model_id: &str,
    ) -> Result<GetTemplateFunctionConfigResponse> {
        let results = self.get_template_function_summaries(plugin_context).await?;
        let r = results
            .iter()
            .find(|r| r.functions.iter().any(|f| f.name == fn_name))
            .ok_or_else(|| PluginNotFoundErr(fn_name.into()))?;

        let plugin = match self.get_plugin_by_ref_id(&r.plugin_ref_id).await {
            None => {
                // It's probably a native function, so just fallback to the summary
                let function = r
                    .functions
                    .iter()
                    .find(|f| f.name == fn_name)
                    .ok_or_else(|| PluginNotFoundErr(fn_name.into()))?;
                return Ok(GetTemplateFunctionConfigResponse {
                    function: function.clone(),
                    plugin_ref_id: r.plugin_ref_id.clone(),
                });
            }
            Some(v) => v,
        };

        let context_id = format!("{:x}", md5::compute(model_id));

        let event = self
            .send_to_plugin_and_wait(
                plugin_context,
                &plugin,
                &InternalEventPayload::GetTemplateFunctionConfigRequest(
                    GetTemplateFunctionConfigRequest {
                        values: rendered_values,
                        name: fn_name.to_string(),
                        context_id,
                    },
                ),
                Duration::from_secs(5),
            )
            .await?;
        match event.payload {
            InternalEventPayload::GetTemplateFunctionConfigResponse(resp) => Ok(resp),
            InternalEventPayload::EmptyResponse(_) => {
                Err(PluginErr("Template function plugin returned empty".to_string()))
            }
            InternalEventPayload::ErrorResponse(e) => Err(PluginErr(e.error)),
            e => Err(PluginErr(format!("Template function plugin returned invalid event {:?}", e))),
        }
    }

    pub async fn call_http_request_action(
        &self,
        plugin_context: &PluginContext,
        req: CallHttpRequestActionRequest,
    ) -> Result<()> {
        let ref_id = req.plugin_ref_id.clone();
        let plugin =
            self.get_plugin_by_ref_id(ref_id.as_str()).await.ok_or(PluginNotFoundErr(ref_id))?;
        let event = plugin.build_event_to_send(
            plugin_context,
            &InternalEventPayload::CallHttpRequestActionRequest(req),
            None,
        );
        plugin.send(&event).await?;
        Ok(())
    }

    pub async fn call_websocket_request_action(
        &self,
        plugin_context: &PluginContext,
        req: CallWebsocketRequestActionRequest,
    ) -> Result<()> {
        let ref_id = req.plugin_ref_id.clone();
        let plugin =
            self.get_plugin_by_ref_id(ref_id.as_str()).await.ok_or(PluginNotFoundErr(ref_id))?;
        let event = plugin.build_event_to_send(
            plugin_context,
            &InternalEventPayload::CallWebsocketRequestActionRequest(req),
            None,
        );
        plugin.send(&event).await?;
        Ok(())
    }

    pub async fn call_workspace_action(
        &self,
        plugin_context: &PluginContext,
        req: CallWorkspaceActionRequest,
    ) -> Result<()> {
        let ref_id = req.plugin_ref_id.clone();
        let plugin =
            self.get_plugin_by_ref_id(ref_id.as_str()).await.ok_or(PluginNotFoundErr(ref_id))?;
        let event = plugin.build_event_to_send(
            plugin_context,
            &InternalEventPayload::CallWorkspaceActionRequest(req),
            None,
        );
        plugin.send(&event).await?;
        Ok(())
    }

    pub async fn call_folder_action(
        &self,
        plugin_context: &PluginContext,
        req: CallFolderActionRequest,
    ) -> Result<()> {
        let ref_id = req.plugin_ref_id.clone();
        let plugin =
            self.get_plugin_by_ref_id(ref_id.as_str()).await.ok_or(PluginNotFoundErr(ref_id))?;
        let event = plugin.build_event_to_send(
            plugin_context,
            &InternalEventPayload::CallFolderActionRequest(req),
            None,
        );
        plugin.send(&event).await?;
        Ok(())
    }

    pub async fn call_grpc_request_action(
        &self,
        plugin_context: &PluginContext,
        req: CallGrpcRequestActionRequest,
    ) -> Result<()> {
        let ref_id = req.plugin_ref_id.clone();
        let plugin =
            self.get_plugin_by_ref_id(ref_id.as_str()).await.ok_or(PluginNotFoundErr(ref_id))?;
        let event = plugin.build_event_to_send(
            plugin_context,
            &InternalEventPayload::CallGrpcRequestActionRequest(req),
            None,
        );
        plugin.send(&event).await?;
        Ok(())
    }

    pub async fn get_http_authentication_summaries(
        &self,
        plugin_context: &PluginContext,
    ) -> Result<Vec<(PluginHandle, GetHttpAuthenticationSummaryResponse)>> {
        let reply_events = self
            .send_and_wait(
                plugin_context,
                &InternalEventPayload::GetHttpAuthenticationSummaryRequest(EmptyPayload {}),
                Duration::from_secs(5),
            )
            .await?;

        let mut results = Vec::new();
        for event in reply_events {
            if let InternalEventPayload::GetHttpAuthenticationSummaryResponse(resp) = event.payload
            {
                let plugin = self
                    .get_plugin_by_ref_id(&event.plugin_ref_id)
                    .await
                    .ok_or(PluginNotFoundErr(event.plugin_ref_id))?;
                results.push((plugin, resp.clone()));
            }
        }

        Ok(results)
    }

    /// Get HTTP authentication config.
    /// Note: Values should be pre-rendered by the caller if needed.
    pub async fn get_http_authentication_config(
        &self,
        plugin_context: &PluginContext,
        auth_name: &str,
        rendered_values: HashMap<String, JsonPrimitive>,
        model_id: &str,
    ) -> Result<GetHttpAuthenticationConfigResponse> {
        if auth_name == "none" {
            return Ok(GetHttpAuthenticationConfigResponse {
                args: Vec::new(),
                plugin_ref_id: "auth-none".to_string(),
                actions: None,
            });
        }

        let results = self.get_http_authentication_summaries(plugin_context).await?;
        let plugin = results
            .iter()
            .find_map(|(p, r)| if r.name == auth_name { Some(p) } else { None })
            .ok_or(PluginNotFoundErr(auth_name.into()))?;

        let context_id = format!("{:x}", md5::compute(model_id));
        let event = self
            .send_to_plugin_and_wait(
                plugin_context,
                &plugin,
                &InternalEventPayload::GetHttpAuthenticationConfigRequest(
                    GetHttpAuthenticationConfigRequest { values: rendered_values, context_id },
                ),
                Duration::from_secs(5),
            )
            .await?;
        match event.payload {
            InternalEventPayload::GetHttpAuthenticationConfigResponse(resp) => Ok(resp),
            InternalEventPayload::EmptyResponse(_) => {
                Err(PluginErr("Auth plugin returned empty".to_string()))
            }
            InternalEventPayload::ErrorResponse(e) => Err(PluginErr(e.error)),
            e => Err(PluginErr(format!("Auth plugin returned invalid event {:?}", e))),
        }
    }

    /// Call HTTP authentication action.
    /// Note: Values should be pre-rendered by the caller if needed.
    pub async fn call_http_authentication_action(
        &self,
        plugin_context: &PluginContext,
        auth_name: &str,
        action_index: i32,
        rendered_values: HashMap<String, JsonPrimitive>,
        model_id: &str,
    ) -> Result<()> {
        let results = self.get_http_authentication_summaries(plugin_context).await?;
        let plugin = results
            .iter()
            .find_map(|(p, r)| if r.name == auth_name { Some(p) } else { None })
            .ok_or(PluginNotFoundErr(auth_name.into()))?;

        let context_id = format!("{:x}", md5::compute(model_id));
        self.send_to_plugin_and_wait(
            plugin_context,
            &plugin,
            &InternalEventPayload::CallHttpAuthenticationActionRequest(
                CallHttpAuthenticationActionRequest {
                    index: action_index,
                    plugin_ref_id: plugin.clone().ref_id,
                    args: CallHttpAuthenticationActionArgs { context_id, values: rendered_values },
                },
            ),
            Duration::from_secs(300), // 5 minutes for OAuth flows
        )
        .await?;
        Ok(())
    }

    pub async fn call_http_authentication(
        &self,
        plugin_context: &PluginContext,
        auth_name: &str,
        req: CallHttpAuthenticationRequest,
    ) -> Result<CallHttpAuthenticationResponse> {
        let disabled = match req.values.get("disabled") {
            Some(JsonPrimitive::Boolean(v)) => *v,
            _ => false,
        };

        // Auth is disabled, so don't do anything
        if disabled {
            info!("Not applying disabled auth {:?}", auth_name);
            return Ok(CallHttpAuthenticationResponse {
                set_headers: None,
                set_query_parameters: None,
            });
        }

        let handlers = self.get_http_authentication_summaries(plugin_context).await?;
        let (plugin, _) = handlers
            .iter()
            .find(|(_, a)| a.name == auth_name)
            .ok_or(AuthPluginNotFound(auth_name.to_string()))?;

        let event = self
            .send_to_plugin_and_wait(
                plugin_context,
                &plugin,
                &InternalEventPayload::CallHttpAuthenticationRequest(req),
                Duration::from_secs(300), // 5 minutes for OAuth flows
            )
            .await?;
        match event.payload {
            InternalEventPayload::CallHttpAuthenticationResponse(resp) => Ok(resp),
            InternalEventPayload::EmptyResponse(_) => {
                Err(PluginErr("Auth plugin returned empty".to_string()))
            }
            InternalEventPayload::ErrorResponse(e) => Err(PluginErr(e.error)),
            e => Err(PluginErr(format!("Auth plugin returned invalid event {:?}", e))),
        }
    }

    pub async fn get_template_function_summaries(
        &self,
        plugin_context: &PluginContext,
    ) -> Result<Vec<GetTemplateFunctionSummaryResponse>> {
        let reply_events = self
            .send_and_wait(
                plugin_context,
                &InternalEventPayload::GetTemplateFunctionSummaryRequest(EmptyPayload {}),
                Duration::from_secs(5),
            )
            .await?;

        let mut results = Vec::new();
        for event in reply_events {
            if let InternalEventPayload::GetTemplateFunctionSummaryResponse(resp) = event.payload {
                results.push(resp.clone());
            }
        }

        // Add Rust-based functions
        results.push(GetTemplateFunctionSummaryResponse {
            plugin_ref_id: "__NATIVE__".to_string(), // Meh
            functions: vec![template_function_secure(), template_function_keyring()],
        });

        Ok(results)
    }

    pub async fn call_template_function(
        &self,
        plugin_context: &PluginContext,
        fn_name: &str,
        values: HashMap<String, JsonPrimitive>,
        purpose: RenderPurpose,
    ) -> TemplateResult<String> {
        let req = CallTemplateFunctionRequest {
            name: fn_name.to_string(),
            args: CallTemplateFunctionArgs { purpose, values },
        };

        let events = self
            .send_and_wait(
                plugin_context,
                &InternalEventPayload::CallTemplateFunctionRequest(req),
                Duration::from_secs(300), // 5 minutes for user interactions (OAuth, prompts, etc.)
            )
            .await
            .map_err(|e| RenderError(format!("Failed to call template function {e:}")))?;

        let value =
            events.into_iter().find_map(|e| match e.payload {
                // Error returned
                InternalEventPayload::CallTemplateFunctionResponse(
                    CallTemplateFunctionResponse { error: Some(error), .. },
                ) => Some(Err(error)),
                // Value or null returned
                InternalEventPayload::CallTemplateFunctionResponse(
                    CallTemplateFunctionResponse { value, .. },
                ) => Some(Ok(value.unwrap_or_default())),
                // Generic error returned
                InternalEventPayload::ErrorResponse(ErrorResponse { error }) => Some(Err(error)),
                _ => None,
            });

        match value {
            None => Err(RenderError(format!("Template function {fn_name}(…) not found "))),
            Some(Ok(v)) => Ok(v),
            Some(Err(e)) => Err(RenderError(e)),
        }
    }

    pub async fn import_data(
        &self,
        plugin_context: &PluginContext,
        content: &str,
    ) -> Result<ImportResponse> {
        let reply_events = self
            .send_and_wait(
                plugin_context,
                &InternalEventPayload::ImportRequest(ImportRequest {
                    content: content.to_string(),
                }),
                Duration::from_secs(5),
            )
            .await?;

        // TODO: Don't just return the first valid response
        let result = reply_events.into_iter().find_map(|e| match e.payload {
            InternalEventPayload::ImportResponse(resp) => Some(resp),
            _ => None,
        });

        match result {
            None => Err(PluginErr("No importers found for file contents".to_string())),
            Some(resp) => Ok(resp),
        }
    }

    pub async fn filter_data(
        &self,
        plugin_context: &PluginContext,
        filter: &str,
        content: &str,
        content_type: &str,
    ) -> Result<FilterResponse> {
        let ct = content_type.to_lowercase();
        let plugin_name = if ct.contains("xml") || ct.contains("html") {
            "@yaak/filter-xpath"
        } else {
            "@yaak/filter-jsonpath"
        };

        let plugin = self
            .get_plugin_by_name(plugin_name)
            .await
            .ok_or(PluginNotFoundErr(plugin_name.to_string()))?;

        let event = self
            .send_to_plugin_and_wait(
                plugin_context,
                &plugin,
                &InternalEventPayload::FilterRequest(FilterRequest {
                    filter: filter.to_string(),
                    content: content.to_string(),
                }),
                Duration::from_secs(5),
            )
            .await?;

        match event.payload {
            InternalEventPayload::FilterResponse(resp) => Ok(resp),
            InternalEventPayload::EmptyResponse(_) => {
                Err(PluginErr("Filter returned empty".to_string()))
            }
            e => Err(PluginErr(format!("Export returned invalid event {:?}", e))),
        }
    }
}

async fn read_plugins_dir(dir: &PathBuf) -> Result<Vec<String>> {
    let mut result = read_dir(dir).await?;
    let mut dirs: Vec<String> = vec![];
    while let Ok(Some(entry)) = result.next_entry().await {
        if entry.path().is_dir() {
            #[cfg(target_os = "windows")]
            dirs.push(fix_windows_paths(&entry.path()));
            #[cfg(not(target_os = "windows"))]
            dirs.push(entry.path().to_string_lossy().to_string());
        }
    }
    Ok(dirs)
}

#[cfg(target_os = "windows")]
fn fix_windows_paths(p: &PathBuf) -> String {
    use dunce;
    use path_slash::PathBufExt;
    use regex::Regex;

    // 1. Remove UNC prefix for Windows paths to pass to sidecar
    let safe_path = dunce::simplified(p.as_path()).to_string_lossy().to_string();

    // 2. Remove the drive letter
    let safe_path = Regex::new("^[a-zA-Z]:").unwrap().replace(safe_path.as_str(), "");

    // 3. Convert backslashes to forward
    let safe_path = PathBuf::from(safe_path.to_string()).to_slash_lossy().to_string();

    safe_path
}
