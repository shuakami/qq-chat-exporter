use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{Extension, State};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::Router;
use serde_json::{json, Map, Value};
use tokio::sync::{broadcast, Mutex};
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

use qce_server::api::middleware::{auth_middleware, request_id_middleware};
use qce_server::api::routes::{
    albums, files, friends, group_files, groups, messages, resources, scheduled, security,
    stickers, system, tasks, users,
};
use qce_server::api::state::{AppState, SharedState};
use qce_server::api::ws;
use qce_server::napcat::NapCatBridgeClient;
use qce_server::paths::PathManager;
use qce_server::progress::ProgressTracker;
use qce_server::resource::{ResourceHandler, ResourceHandlerConfig};
use qce_server::scheduler::ScheduledExportManager;
use qce_server::security::SecurityManager;
use qce_server::storage::DatabaseManager;
use qce_server::version::VERSION;

mod scheduled_executor;

#[tokio::main]
async fn main() {
    // 日志双层：控制台简洁输出 + 文件持久化（~/.qq-chat-exporter/logs/）。
    let log_dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".qq-chat-exporter")
        .join("logs");
    let _ = std::fs::create_dir_all(&log_dir);

    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "info".into());

    let file_appender = tracing_appender::rolling::daily(&log_dir, "qce-server.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;

    let console_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stdout)
        .without_time()
        .with_target(false)
        .with_level(true)
        .with_ansi(true);
    let file_layer = tracing_subscriber::fmt::layer()
        .with_writer(non_blocking)
        .with_ansi(false);

    tracing_subscriber::registry()
        .with(env_filter)
        .with(console_layer)
        .with(file_layer)
        .init();

    // guard 必须在 main 存活期间保持，否则日志丢失。
    let _log_guard = guard;

    tracing::info!("[QCE] qce-server v{VERSION} 启动中...");

    if let Err(error) = run().await {
        tracing::error!("[QCE] 服务启动失败: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let port: u16 = std::env::var("QCE_SERVER_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(40653);
    let bridge_endpoint = std::env::var("QCE_BRIDGE_ENDPOINT")
        .unwrap_or_else(|_| "http://127.0.0.1:40654".to_string());

    // ============ 路径管理器 + 用户自定义目录 ============
    let path_manager = Arc::new(PathManager::new());
    load_custom_dirs(&path_manager).await;

    // ============ 数据库 ============
    // 与 TS 侧 ConfigManager 对齐：databasePath = ~/.qq-chat-exporter/database.db，
    // DatabaseManager 取 parent 目录（~/.qq-chat-exporter/）存放 JSONL 文件，
    // 这样两个版本共享同一份 tasks.jsonl / resources.jsonl 等数据。
    let db_path = path_manager.default_base_dir().join("database.db");
    tokio::fs::create_dir_all(path_manager.default_base_dir())
        .await
        .map_err(|e| format!("创建数据库目录失败: {e}"))?;
    let db = Arc::new(DatabaseManager::new(&db_path));
    db.initialize().await.map_err(|e| format!("数据库初始化失败: {e}"))?;

    // ============ NapCat bridge 客户端 ============
    let napcat = NapCatBridgeClient::new(&bridge_endpoint, 120_000)
        .map_err(|e| format!("创建 bridge 客户端失败: {e}"))?;
    tracing::info!("[QCE] NapCat bridge: {bridge_endpoint}");

    // ============ 资源处理器 ============
    let resource_handler = Arc::new(
        ResourceHandler::new(
            Arc::new(napcat.clone()),
            None,
            Arc::clone(&db),
            ResourceHandlerConfig {
                storage_root: path_manager.resources_dir(),
                ..ResourceHandlerConfig::default()
            },
        )
        .await,
    );
    resource_handler.start_health_check().await;

    // ============ 进度跟踪 / 安全管理 ============
    let progress_tracker = Arc::new(ProgressTracker::new(Arc::clone(&db)));
    let security_manager = Arc::new(
        SecurityManager::new().map_err(|e| format!("创建安全管理器失败: {e}"))?,
    );
    security_manager.initialize();
    let _watcher = security_manager.spawn_config_watcher();

    // ============ 定时导出管理器 ============
    let executor = Arc::new(scheduled_executor::ApiScheduledExportExecutor::new(
        napcat.clone(),
        Arc::clone(&resource_handler),
        Arc::clone(&path_manager),
    ));
    let scheduled_export_manager =
        Arc::new(ScheduledExportManager::new(Arc::clone(&db), executor));
    scheduled_export_manager.initialize().await;

    // ============ 孤儿任务归一化（issue #144） + 任务表加载 ============
    let export_tasks = reconcile_and_load_tasks(&db).await;

    // ============ 静态前端目录 ============
    let static_dir = resolve_static_dir();
    tracing::info!("[QCE] 前端静态目录: {}", static_dir.display());

    let (ws_tx, _) = broadcast::channel(1024);
    let state: SharedState = Arc::new(AppState {
        napcat,
        db,
        resource_handler,
        progress_tracker,
        scheduled_export_manager,
        security_manager,
        path_manager: Arc::clone(&path_manager),
        ws_tx,
        export_tasks: Mutex::new(export_tasks),
        cancelled_task_ids: Mutex::new(std::collections::HashSet::new()),
        running_export_cancel_flags: Mutex::new(HashMap::new()),
        resource_file_cache: Mutex::new(HashMap::new()),
        message_cache: Mutex::new(HashMap::new()),
        started_at: Instant::now(),
        static_dir: static_dir.clone(),
        port,
    });

    let app = build_router(&state, &path_manager, &static_dir);

    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("端口 {port} 绑定失败: {e}"))?;
    tracing::info!("[QCE] HTTP 服务已启动: http://localhost:{port}");
    tracing::info!("[QCE] Web 界面: http://localhost:{port}/qce-v4-tool");
    if let Some(token) = state.security_manager.access_token() {
        tracing::info!(
            "[QCE] 一键登录: http://localhost:{port}/qce-v4-tool/auth?token={token}"
        );
    }

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await
    .map_err(|e| format!("HTTP 服务异常退出: {e}"))
}

/// 装配全部路由与中间件（对应 TS `ApiServer.setupRoutes`）。
fn build_router(state: &SharedState, path_manager: &PathManager, static_dir: &std::path::Path) -> Router {
    let api = Router::new()
        // 基础信息。
        .route("/", get(root_or_ws))
        .route("/ws", get(ws::ws_handler))
        .route("/health", get(system::health))
        .route("/security-status", get(security::security_status))
        .route("/auth", post(security::auth))
        .route("/auth/", post(security::auth))
        .route("/api/server/host", post(security::update_server_host))
        .route(
            "/api/security/ip-whitelist",
            get(security::get_ip_whitelist)
                .post(security::add_ip_whitelist)
                .delete(security::remove_ip_whitelist),
        )
        .route(
            "/api/security/ip-whitelist/toggle",
            put(security::toggle_ip_whitelist),
        )
        .route(
            "/api/security/ip-whitelist/add-current",
            post(security::add_current_ip),
        )
        // 系统信息 / 配置。
        .route("/api/system/info", get(system::system_info))
        .route("/api/system/status", get(system::system_status))
        .route("/api/config", get(system::get_config).put(system::put_config))
        // 群组。
        .route("/api/groups", get(groups::list_groups))
        .route("/api/groups/:groupCode", get(groups::group_detail))
        .route("/api/groups/:groupCode/members", get(groups::group_members))
        .route("/api/group-system-notify", get(groups::group_system_notify))
        .route(
            "/api/groups/:groupCode/join-requests",
            get(groups::group_join_requests),
        )
        .route("/api/groups/:groupCode/essence", get(groups::group_essence))
        .route(
            "/api/groups/:groupCode/essence/export",
            post(groups::export_group_essence),
        )
        .route(
            "/api/groups/:groupCode/avatars/export",
            post(groups::export_group_avatars),
        )
        // 好友 / 用户。
        .route("/api/friends", get(friends::list_friends))
        .route("/api/friends/:uid", get(friends::friend_detail))
        .route("/api/recent-contacts", get(friends::recent_contacts))
        .route("/api/users/lookup", get(users::lookup_user))
        .route("/api/users/:uid", get(users::user_detail))
        // 消息。
        .route("/api/messages/fetch", post(messages::fetch_messages))
        .route("/api/messages/export", post(messages::export_messages))
        .route(
            "/api/messages/export-streaming-zip",
            post(messages::export_streaming_zip),
        )
        .route(
            "/api/messages/export-streaming-jsonl",
            post(messages::export_streaming_jsonl),
        )
        // 任务。
        .route("/api/tasks", get(tasks::list_tasks))
        .route(
            "/api/tasks/:taskId",
            get(tasks::get_task).delete(tasks::delete_task),
        )
        .route("/api/tasks/:taskId/cancel", post(tasks::cancel_task))
        .route(
            "/api/tasks/:taskId/original-files",
            delete(tasks::delete_original_files),
        )
        // 定时导出。
        .route(
            "/api/scheduled-exports",
            get(scheduled::list_scheduled_exports).post(scheduled::create_scheduled_export),
        )
        .route(
            "/api/scheduled-exports/trigger-all",
            post(scheduled::trigger_all_scheduled_exports),
        )
        .route(
            "/api/scheduled-exports/:id",
            get(scheduled::get_scheduled_export)
                .put(scheduled::update_scheduled_export)
                .delete(scheduled::delete_scheduled_export),
        )
        .route(
            "/api/scheduled-exports/:id/trigger",
            post(scheduled::trigger_scheduled_export),
        )
        .route(
            "/api/scheduled-exports/:id/history",
            get(scheduled::scheduled_export_history),
        )
        // 表情包。
        .route("/api/sticker-packs", get(stickers::list_sticker_packs))
        .route("/api/sticker-packs/export", post(stickers::export_sticker_pack))
        .route(
            "/api/sticker-packs/export-all",
            post(stickers::export_all_sticker_packs),
        )
        .route(
            "/api/sticker-packs/export-records",
            get(stickers::sticker_export_records),
        )
        // 群相册。
        .route("/api/groups/:groupCode/albums", get(albums::list_group_albums))
        .route(
            "/api/groups/:groupCode/albums/:albumId/media",
            get(albums::list_album_media),
        )
        .route(
            "/api/groups/:groupCode/albums/export",
            post(albums::export_group_album),
        )
        .route(
            "/api/group-albums/export-records",
            get(albums::album_export_records),
        )
        // 群文件。
        .route("/api/groups/:groupCode/files", get(files::list_group_files))
        .route(
            "/api/groups/:groupCode/files/count",
            get(files::group_file_count),
        )
        .route(
            "/api/groups/:groupCode/files/download",
            post(files::download_group_file),
        )
        .route(
            "/api/groups/:groupCode/files/export",
            post(files::export_group_files_metadata),
        )
        .route(
            "/api/groups/:groupCode/files/export-with-download",
            post(files::export_group_files_with_download),
        )
        .route(
            "/api/group-files/export-records",
            get(group_files::group_files_export_records),
        )
        // 导出文件管理 / 资源。
        .route("/api/exports/files", get(resources::list_export_files))
        .route(
            "/api/exports/files/:fileName",
            delete(resources::delete_export_file),
        )
        .route(
            "/api/exports/files/:fileName/info",
            get(resources::export_file_info),
        )
        .route(
            "/api/exports/files/:fileName/preview",
            get(resources::preview_export_file),
        )
        .route(
            "/api/exports/files/:fileName/resources/*path",
            get(resources::export_file_resource),
        )
        .route("/api/resources/index", get(resources::resources_index))
        .route(
            "/api/resources/export/:fileName",
            get(resources::export_file_resources),
        )
        .route("/api/resources/files", get(resources::global_resource_files))
        .route("/api/download-file", get(resources::download_file))
        .route("/api/open-file-location", post(resources::open_file_location))
        .route(
            "/api/open-export-directory",
            post(resources::open_export_directory),
        )
        .route(
            "/api/merge-resources/available-tasks",
            get(resources::merge_available_tasks),
        )
        .route("/api/merge-resources", post(resources::merge_resources));

    // 静态托管（对应 TS express.static + FrontendBuilder.setupStaticRoutes）。
    let frontend = ServeDir::new(static_dir)
        .append_index_html_on_directories(true);
    let router = api
        .nest_service(
            "/downloads",
            ServeDir::new(path_manager.exports_dir()),
        )
        .nest_service(
            "/scheduled-downloads",
            ServeDir::new(path_manager.scheduled_exports_dir()),
        )
        .nest_service("/resources", ServeDir::new(path_manager.resources_dir()))
        .nest_service("/static/qce-v4-tool", frontend)
        // 前端入口 / 认证页 / SPA 回退（Next 静态导出 basePath 是
        // /static/qce-v4-tool，页面路由需要显式回退到 index.html）。
        .route("/qce-v4-tool", get(frontend_index))
        .route("/qce-v4-tool/", get(frontend_index))
        .route("/qce-v4-tool/auth", get(frontend_auth))
        .route("/qce-v4-tool/auth/", get(frontend_auth))
        .route("/qce-v4-tool/*rest", get(frontend_index))
        // Next trailingSlash 重定向兼容：/auth/?token=... 也回到认证页。
        .route("/auth", get(frontend_auth))
        .route("/auth/", get(frontend_auth))
        // 前端根级静态资源与分析脚本占位。
        .route("/text-logo.png", get(frontend_root_asset))
        .route("/text-full-logo.png", get(frontend_root_asset))
        .route("/placeholder-logo.png", get(frontend_root_asset))
        .route("/placeholder-logo.svg", get(frontend_root_asset))
        .route("/placeholder-user.jpg", get(frontend_root_asset))
        .route("/placeholder.jpg", get(frontend_root_asset))
        .route("/placeholder.svg", get(frontend_root_asset))
        .route("/_vercel/insights/script.js", get(vercel_stub));

    router
        .layer(axum::middleware::from_fn_with_state(
            Arc::clone(state),
            auth_middleware,
        ))
        .layer(axum::middleware::from_fn(request_id_middleware))
        .layer(CorsLayer::permissive())
        .with_state(Arc::clone(state))
}

/// `GET /qce-v4-tool[/*]` — 前端应用入口 / SPA 回退。
async fn frontend_index(State(state): State<SharedState>) -> Response {
    serve_static_file(&state.static_dir.join("index.html"), "text/html; charset=utf-8").await
}

/// `GET /qce-v4-tool/auth`、`GET /auth[/]` — Next.js 构建的认证页面。
async fn frontend_auth(State(state): State<SharedState>) -> Response {
    let auth_page = state.static_dir.join("auth").join("index.html");
    if auth_page.is_file() {
        serve_static_file(&auth_page, "text/html; charset=utf-8").await
    } else {
        serve_static_file(&state.static_dir.join("index.html"), "text/html; charset=utf-8").await
    }
}

/// 前端根级静态资源（logo / placeholder 图片）。
async fn frontend_root_asset(
    State(state): State<SharedState>,
    uri: axum::http::Uri,
) -> Response {
    let name = uri.path().trim_start_matches('/');
    let content_type = match name.rsplit('.').next() {
        Some("png") => "image/png",
        Some("svg") => "image/svg+xml",
        Some("jpg" | "jpeg") => "image/jpeg",
        _ => "application/octet-stream",
    };
    serve_static_file(&state.static_dir.join(name), content_type).await
}

/// Vercel 分析脚本（本地环境返回空脚本）。
async fn vercel_stub() -> Response {
    (
        [(axum::http::header::CONTENT_TYPE, "application/javascript")],
        "// Vercel Analytics disabled in local environment",
    )
        .into_response()
}

async fn serve_static_file(path: &std::path::Path, content_type: &str) -> Response {
    match tokio::fs::read(path).await {
        Ok(bytes) => (
            [(
                axum::http::header::CONTENT_TYPE,
                content_type.to_string(),
            )],
            bytes,
        )
            .into_response(),
        Err(_) => (
            axum::http::StatusCode::NOT_FOUND,
            "前端应用未构建或文件不存在",
        )
            .into_response(),
    }
}

/// `GET /` — 有 WebSocket 升级头时走 WS（TS 的 WebSocketServer 挂在 server
/// 根上），否则返回 API 信息。
async fn root_or_ws(
    State(state): State<SharedState>,
    Extension(request_id): Extension<qce_server::api::RequestId>,
    ws: Option<WebSocketUpgrade>,
    ) -> Response {
    match ws {
        Some(upgrade) => ws::ws_handler(State(state), upgrade).await,
        None => system::root(State(state), Extension(request_id)).await,
    }
}

/// 从 `user-config.json` 加载自定义导出目录（issue #192）。
async fn load_custom_dirs(path_manager: &PathManager) {
    let config_path = path_manager.default_base_dir().join("user-config.json");
    let Ok(raw) = tokio::fs::read_to_string(&config_path).await else {
        return;
    };
    let Ok(config) = serde_json::from_str::<Value>(&raw) else {
        return;
    };
    if let Some(dir) = config.get("customOutputDir").and_then(Value::as_str) {
        if !dir.trim().is_empty() {
            if let Err(error) = path_manager.set_custom_output_dir(Some(dir)) {
                tracing::warn!("[QCE] 自定义导出目录无效: {error}");
            }
        }
    }
    if let Some(dir) = config
        .get("customScheduledExportDir")
        .and_then(Value::as_str)
    {
        if !dir.trim().is_empty() {
            if let Err(error) = path_manager.set_custom_scheduled_export_dir(Some(dir)) {
                tracing::warn!("[QCE] 自定义定时导出目录无效: {error}");
            }
        }
    }
}

/// issue #144：把重启后仍是 `running` / `pending` 的孤儿任务拍成 `failed`，
/// 并把全部任务加载进内存任务表。
async fn reconcile_and_load_tasks(db: &Arc<DatabaseManager>) -> HashMap<String, Value> {
    const ORPHAN_TASK_ERROR_MESSAGE: &str =
        "服务上次启动时进度丢失，请删除该任务后重新创建（issue #144）";

    let mut tasks: HashMap<String, Value> = HashMap::new();
    let mut orphan_count = 0usize;
    for (config, task_state) in db.get_all_tasks().await {
        // config 与 state 合并成前端使用的单一任务视图（state 覆盖 config）。
        let mut merged = match config.clone() {
            Value::Object(map) => map,
            _ => Map::new(),
        };
        if let Value::Object(state_map) = &task_state {
            for (key, value) in state_map {
                merged.insert(key.clone(), value.clone());
            }
        }

        let status = merged
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if status == "running" || status == "pending" {
            orphan_count += 1;
            let has_error = merged
                .get("error")
                .and_then(Value::as_str)
                .is_some_and(|e| !e.is_empty());
            merged.insert("status".to_string(), json!("failed"));
            if !has_error {
                merged.insert("error".to_string(), json!(ORPHAN_TASK_ERROR_MESSAGE));
            }
            let reconciled = Value::Object(merged.clone());
            if let Err(error) = db.save_task(&config, &reconciled, true).await {
                tracing::warn!("[QCE] 保存孤儿任务状态失败: {error}");
            }
        }

        if let Some(task_id) = merged.get("taskId").and_then(Value::as_str) {
            let task_id = task_id.to_string();
            tasks.insert(task_id, Value::Object(merged));
        }
    }
    if orphan_count > 0 {
        tracing::info!("[QCE] 已将 {orphan_count} 个孤儿任务标记为 failed（issue #144）");
    }
    tasks
}

/// 解析前端静态目录：`QCE_STATIC_DIR` 环境变量 → 可执行文件旁的
/// `static/qce-v4-tool` → 当前目录下的 `static/qce-v4-tool`。
fn resolve_static_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("QCE_STATIC_DIR") {
        let path = PathBuf::from(dir);
        if path.is_dir() {
            return path;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidate = parent.join("static").join("qce-v4-tool");
            if candidate.is_dir() {
                return candidate;
            }
        }
    }
    PathBuf::from("static").join("qce-v4-tool")
}
