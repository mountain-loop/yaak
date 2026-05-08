use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::mpsc;

/// Type-erased handler function: takes context + JSON payload, returns JSON or error.
type HandlerFn<Ctx> = Box<dyn Fn(&Ctx, serde_json::Value) -> Result<serde_json::Value, RpcError> + Send + Sync>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    pub message: String,
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for RpcError {}

impl From<serde_json::Error> for RpcError {
    fn from(e: serde_json::Error) -> Self {
        Self { message: e.to_string() }
    }
}

/// Incoming message from a client (Tauri invoke, WebSocket, etc.).
#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub id: String,
    pub cmd: String,
    #[serde(default)]
    pub payload: serde_json::Value,
}

/// Outgoing response to a client.
#[derive(Debug, Serialize)]
#[serde(tag = "type")]
pub enum RpcResponse {
    Success {
        id: String,
        payload: serde_json::Value,
    },
    Error {
        id: String,
        error: String,
    },
}

/// Transport-agnostic command router.
///
/// Register typed handler functions, then dispatch incoming JSON messages.
/// Each transport adapter (Tauri, WebSocket, etc.) calls `dispatch()`.
pub struct RpcRouter<Ctx> {
    handlers: HashMap<&'static str, HandlerFn<Ctx>>,
}

impl<Ctx> RpcRouter<Ctx> {
    pub fn new() -> Self {
        Self {
            handlers: HashMap::new(),
        }
    }

    /// Register a handler for a command name.
    /// Use the `rpc_handler!` macro to wrap a typed function.
    pub fn register(&mut self, cmd: &'static str, handler: HandlerFn<Ctx>) {
        self.handlers.insert(cmd, handler);
    }

    /// Dispatch a command by name with a JSON payload.
    pub fn dispatch(
        &self,
        cmd: &str,
        payload: serde_json::Value,
        ctx: &Ctx,
    ) -> Result<serde_json::Value, RpcError> {
        match self.handlers.get(cmd) {
            Some(handler) => handler(ctx, payload),
            None => Err(RpcError {
                message: format!("unknown command: {cmd}"),
            }),
        }
    }

    /// Handle a full `RpcRequest`, returning an `RpcResponse`.
    pub fn handle(&self, req: RpcRequest, ctx: &Ctx) -> RpcResponse {
        match self.dispatch(&req.cmd, req.payload, ctx) {
            Ok(payload) => RpcResponse::Success {
                id: req.id,
                payload,
            },
            Err(e) => RpcResponse::Error {
                id: req.id,
                error: e.message,
            },
        }
    }

    pub fn commands(&self) -> Vec<&'static str> {
        self.handlers.keys().copied().collect()
    }
}

/// A named event carrying a JSON payload, emitted from backend to frontend.
#[derive(Debug, Clone, Serialize)]
pub struct RpcEvent {
    pub event: &'static str,
    pub payload: serde_json::Value,
}

/// Channel-based event emitter. The backend calls `emit()`, the transport
/// adapter (Tauri, WebSocket, etc.) drains the receiver and delivers events.
#[derive(Clone)]
pub struct RpcEventEmitter {
    tx: mpsc::Sender<RpcEvent>,
}

impl RpcEventEmitter {
    pub fn new() -> (Self, mpsc::Receiver<RpcEvent>) {
        let (tx, rx) = mpsc::channel();
        (Self { tx }, rx)
    }

    /// Emit a typed event. Serializes the payload to JSON.
    pub fn emit<T: Serialize>(&self, event: &'static str, payload: &T) {
        if let Ok(value) = serde_json::to_value(payload) {
            let _ = self.tx.send(RpcEvent { event, payload: value });
        }
    }
}

/// Define RPC commands and events with a single source of truth.
///
/// Generates:
/// - `build_router()` — creates an `RpcRouter` with all handlers registered
/// - `RpcSchema` — a struct with ts-rs derives for TypeScript type generation
/// - `RpcEventSchema` — (if events declared) a struct mapping event names to payload types
///
/// The wire name for each command/event is derived from `stringify!($ident)`.
///
/// # Example
/// ```ignore
/// define_rpc! {
///     ProxyCtx;
///     commands {
///         proxy_start(ProxyStartRequest) -> ProxyStartResponse,
///         proxy_stop(ProxyStopRequest) -> bool,
///     }
///     events {
///         model_write(ModelPayload),
///     }
/// }
/// ```
#[macro_export]
macro_rules! define_rpc {
    // With both commands and events
    (
        $ctx:ty;
        commands {
            $( $handler:ident ( $req:ty ) -> $res:ty ),* $(,)?
        }
        events {
            $( $evt_ident:ident ( $evt_payload:ty ) ),* $(,)?
        }
    ) => {
        pub fn build_router() -> $crate::RpcRouter<$ctx> {
            let mut router = $crate::RpcRouter::new();
            $( router.register(stringify!($handler), $crate::rpc_handler!($handler)); )*
            router
        }

        #[derive(ts_rs::TS)]
        #[ts(export, export_to = "gen_rpc.ts")]
        pub struct RpcSchema {
            $( pub $handler: ($req, $res), )*
        }

        #[derive(ts_rs::TS)]
        #[ts(export, export_to = "gen_rpc.ts")]
        pub struct RpcEventSchema {
            $( pub $evt_ident: $evt_payload, )*
        }
    };

    // Commands only (no events)
    (
        $ctx:ty;
        commands {
            $( $handler:ident ( $req:ty ) -> $res:ty ),* $(,)?
        }
    ) => {
        pub fn build_router() -> $crate::RpcRouter<$ctx> {
            let mut router = $crate::RpcRouter::new();
            $( router.register(stringify!($handler), $crate::rpc_handler!($handler)); )*
            router
        }

        #[derive(ts_rs::TS)]
        #[ts(export, export_to = "gen_rpc.ts")]
        pub struct RpcSchema {
            $( pub $handler: ($req, $res), )*
        }
    };
}

/// Wrap a typed handler function into a type-erased `HandlerFn`.
///
/// The function must have the signature:
/// `fn(ctx: &Ctx, req: Req) -> Result<Res, RpcError>`
/// where `Req: DeserializeOwned` and `Res: Serialize`.
///
/// # Example
/// ```ignore
/// fn proxy_start(ctx: &MyCtx, req: StartReq) -> Result<StartRes, RpcError> { ... }
///
/// router.register("proxy_start", rpc_handler!(proxy_start));
/// ```
#[macro_export]
macro_rules! rpc_handler {
    ($f:expr) => {
        Box::new(|ctx, payload| {
            let req = serde_json::from_value(payload).map_err($crate::RpcError::from)?;
            let res = $f(ctx, req)?;
            serde_json::to_value(res).map_err($crate::RpcError::from)
        })
    };
}
