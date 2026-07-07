//! HTTP API 层：统一响应、状态、中间件、辅助函数与全部路由。

pub mod helpers;
pub mod middleware;
pub mod response;
pub mod routes;
pub mod state;
pub mod ws;

pub use response::{ApiError, ApiResult, ErrorType, RequestId};
pub use state::{AppState, SharedState};
