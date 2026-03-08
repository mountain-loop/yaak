use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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

/// Define RPC commands with a single source of truth.
///
/// Generates:
/// - `build_router()` — creates an `RpcRouter` with all handlers registered
/// - `RpcSchema` — a struct with ts-rs derives for TypeScript type generation
///
/// # Example
/// ```ignore
/// define_rpc! {
///     ProxyCtx;
///     "proxy_start" => proxy_start(ProxyStartRequest) -> ProxyStartResponse,
///     "proxy_stop" => proxy_stop(ProxyStopRequest) -> bool,
/// }
/// ```
#[macro_export]
macro_rules! define_rpc {
    (
        $ctx:ty;
        $( $name:literal => $handler:ident ( $req:ty ) -> $res:ty ),* $(,)?
    ) => {
        pub fn build_router() -> $crate::RpcRouter<$ctx> {
            let mut router = $crate::RpcRouter::new();
            $( router.register($name, $crate::rpc_handler!($handler)); )*
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
