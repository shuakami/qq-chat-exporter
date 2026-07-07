use axum::extract::{Extension, State};
use axum::response::Response;
use axum::Json;
use serde_json::{json, Value};

use crate::api::response::{self, ApiError, ErrorType, RequestId};
use crate::api::state::SharedState;
use crate::paths::PathManager;
use crate::version::{APP_COPYRIGHT, APP_NAME, VERSION};

/// `GET /` — API 信息。
pub async fn root(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
) -> Response {
    let port = state.port;
    response::success(
        json!({
            "name": "QQ聊天记录导出工具API",
            "version": VERSION,
            "description": "提供完整的QQ聊天记录导出功能API",
            "endpoints": {
                "基础信息": [
                    "GET / - API信息",
                    "GET /health - 健康检查"
                ],
                "群组管理": [
                    "GET /api/groups?page=1&limit=999&forceRefresh=false - 获取所有群组（支持分页）",
                    "GET /api/groups/:groupCode?forceRefresh=false - 获取群组详情",
                    "GET /api/groups/:groupCode/members?forceRefresh=false - 获取群成员",
                    "GET /api/groups/:groupCode/essence - 获取群精华消息列表",
                    "POST /api/groups/:groupCode/essence/export - 导出群精华消息"
                ],
                "好友管理": [
                    "GET /api/friends?page=1&limit=999 - 获取所有好友（支持分页）",
                    "GET /api/friends/:uid?no_cache=false - 获取好友详情",
                    "GET /api/recent-contacts?limit=100&includeAll=false - 获取最近联系人中不属于好友/群聊的会话（QQ Bot、服务号等）"
                ],
                "消息处理": [
                    "POST /api/messages/fetch - 批量获取消息",
                    "POST /api/messages/export - 导出消息（支持过滤纯图片消息）"
                ],
                "任务管理": [
                    "GET /api/tasks - 获取所有导出任务",
                    "GET /api/tasks/:taskId - 获取指定任务状态",
                    "DELETE /api/tasks/:taskId - 删除任务",
                    "DELETE /api/tasks/:taskId/original-files - 删除ZIP导出的原始文件"
                ],
                "用户信息": [
                    "GET /api/users/:uid - 获取用户信息"
                ],
                "系统信息": [
                    "GET /api/system/info - 系统信息",
                    "GET /api/system/status - 系统状态"
                ],
                "前端应用": [
                    "GET /qce-v4-tool - Web界面入口"
                ],
                "表情包管理": [
                    "GET /api/sticker-packs?types=favorite_emoji,market_pack,system_pack - 获取表情包（可选类型筛选）",
                    "POST /api/sticker-packs/export - 导出指定表情包",
                    "POST /api/sticker-packs/export-all - 导出所有表情包",
                    "GET /api/sticker-packs/export-records?limit=50 - 获取导出记录"
                ],
                "群相册管理": [
                    "GET /api/groups/:groupCode/albums - 获取群相册列表",
                    "GET /api/groups/:groupCode/albums/:albumId/media - 获取相册媒体列表",
                    "POST /api/groups/:groupCode/albums/export - 导出群相册",
                    "GET /api/group-albums/export-records?limit=50 - 获取群相册导出记录"
                ],
                "群文件管理": [
                    "GET /api/groups/:groupCode/files - 获取群文件列表",
                    "GET /api/groups/:groupCode/files/count - 获取群文件数量",
                    "POST /api/groups/:groupCode/files/download - 获取单个文件下载链接",
                    "POST /api/groups/:groupCode/files/export - 导出群文件列表",
                    "POST /api/groups/:groupCode/files/export-with-download - 导出群文件（含下载）",
                    "GET /api/group-files/export-records?limit=50 - 获取群文件导出记录"
                ]
            },
            "websocket": format!("ws://localhost:{port}"),
            "frontend": {
                "url": format!("http://localhost:{port}/qce-v4-tool"),
                "mode": "production",
                "status": "running"
            },
            "documentation": "详见项目根目录API.md"
        }),
        &request_id,
    )
}

/// `GET /health` — 健康检查。
pub async fn health(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
) -> Response {
    let online = match state.napcat.self_info().await {
        Ok(info) => info.get("online").and_then(Value::as_bool).unwrap_or(false),
        Err(_) => false,
    };
    response::success(
        json!({
            "status": "healthy",
            "online": online,
            "timestamp": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            "uptime": state.uptime_secs(),
        }),
        &request_id,
    )
}

/// `GET /api/system/info` — 系统信息。
pub async fn system_info(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
) -> Response {
    let self_info = state.napcat.self_info().await.unwrap_or(Value::Null);
    let uin = self_info.get("uin").and_then(Value::as_str).unwrap_or("");
    let avatar_url = self_info
        .get("avatarUrl")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            if uin.is_empty() {
                None
            } else {
                Some(format!("https://q1.qlogo.cn/g?b=qq&nk={uin}&s=640"))
            }
        });

    response::success(
        json!({
            "name": APP_NAME,
            "copyright": APP_COPYRIGHT,
            "version": VERSION,
            // issue #340：前端用这个字段区分插件 / 独立两种后端
            "mode": "plugin",
            "napcat": {
                "version": "unknown",
                "online": self_info.get("online").and_then(Value::as_bool).unwrap_or(false),
                "workingEnv": "shell",
                "workingEnvLabel": "Shell (独立无头模式)",
                "selfInfo": {
                    "uid": self_info.get("uid").and_then(Value::as_str).unwrap_or(""),
                    "uin": uin,
                    "nick": self_info.get("nick").and_then(Value::as_str).unwrap_or(""),
                    "avatarUrl": avatar_url,
                    "longNick": self_info.get("longNick").and_then(Value::as_str).unwrap_or(""),
                    "sex": self_info.get("sex").cloned().unwrap_or(Value::Null),
                    "age": self_info.get("age").cloned().unwrap_or(Value::Null),
                    "qqLevel": self_info.get("qqLevel").cloned().unwrap_or(Value::Null),
                    "vipFlag": self_info.get("vipFlag").and_then(Value::as_bool).unwrap_or(false),
                    "svipFlag": self_info.get("svipFlag").and_then(Value::as_bool).unwrap_or(false),
                    "vipLevel": self_info.get("vipLevel").and_then(Value::as_i64).unwrap_or(0)
                }
            },
            "runtime": {
                "nodeVersion": format!("rust-{}", env!("CARGO_PKG_VERSION")),
                "platform": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
                "uptime": state.uptime_secs(),
                "memory": memory_usage(),
            }
        }),
        &request_id,
    )
}

/// `GET /api/system/status` — 系统状态。
pub async fn system_status(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
) -> Response {
    let online = match state.napcat.self_info().await {
        Ok(info) => info.get("online").and_then(Value::as_bool).unwrap_or(false),
        Err(_) => false,
    };
    response::success(
        json!({
            "online": online,
            "websocketConnections": state.ws_connection_count(),
            "memoryUsage": memory_usage(),
            "uptime": state.uptime_secs(),
        }),
        &request_id,
    )
}

/// 进程内存占用（对齐 TS `process.memoryUsage()` 的字段形态）。
fn memory_usage() -> Value {
    let mut system = sysinfo::System::new();
    let pid = sysinfo::Pid::from_u32(std::process::id());
    system.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::Some(&[pid]),
        true,
        sysinfo::ProcessRefreshKind::new().with_memory(),
    );
    let (rss, virtual_mem) = system
        .process(pid)
        .map_or((0, 0), |process| (process.memory(), process.virtual_memory()));
    json!({
        "rss": rss,
        "heapTotal": rss,
        "heapUsed": rss,
        "external": 0,
        "arrayBuffers": 0,
        "virtual": virtual_mem,
    })
}

/// `GET /api/config` — 读取用户配置。
pub async fn get_config(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
) -> Response {
    let config_path = state.path_manager.default_base_dir().join("user-config.json");
    let config: Value = tokio::fs::read_to_string(&config_path)
        .await
        .ok()
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or_else(|| json!({}));

    response::success(
        json!({
            "customOutputDir": config.get("customOutputDir").cloned().unwrap_or(Value::Null),
            "customScheduledExportDir": config.get("customScheduledExportDir").cloned().unwrap_or(Value::Null),
            "currentExportsDir": state.path_manager.exports_dir(),
            "currentScheduledExportsDir": state.path_manager.scheduled_exports_dir(),
        }),
        &request_id,
    )
}

/// `PUT /api/config` — 更新用户配置。
pub async fn put_config(
    State(state): State<SharedState>,
    Extension(RequestId(request_id)): Extension<RequestId>,
    Json(body): Json<Value>,
) -> Response {
    let config_path = state.path_manager.default_base_dir().join("user-config.json");
    if let Some(parent) = config_path.parent() {
        if tokio::fs::create_dir_all(parent).await.is_err() {
            let err = ApiError::new(ErrorType::Config, "更新配置失败", "UPDATE_CONFIG_FAILED");
            return response::error(&err, &request_id);
        }
    }

    let mut config: Value = tokio::fs::read_to_string(&config_path)
        .await
        .ok()
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or_else(|| json!({}));
    let Some(config_obj) = config.as_object_mut() else {
        let err = ApiError::new(ErrorType::Config, "更新配置失败", "UPDATE_CONFIG_FAILED");
        return response::error(&err, &request_id);
    };

    if let Some(custom_output_dir) = body.get("customOutputDir") {
        match custom_output_dir.as_str().map(str::trim) {
            None | Some("") => {
                config_obj.insert("customOutputDir".to_string(), Value::Null);
                if state.path_manager.set_custom_output_dir(None).is_err() {
                    let err = ApiError::validation("路径验证失败", "INVALID_PATH");
                    return response::error(&err, &request_id);
                }
            }
            Some(dir) => {
                let sanitized = PathManager::sanitize_path(dir);
                if state
                    .path_manager
                    .set_custom_output_dir(Some(&sanitized))
                    .is_err()
                {
                    let err = ApiError::validation("禁止访问系统关键目录", "INVALID_PATH");
                    return response::error(&err, &request_id);
                }
                config_obj.insert("customOutputDir".to_string(), Value::String(sanitized));
            }
        }
    }

    if let Some(custom_scheduled_dir) = body.get("customScheduledExportDir") {
        match custom_scheduled_dir.as_str().map(str::trim) {
            None | Some("") => {
                config_obj.insert("customScheduledExportDir".to_string(), Value::Null);
                if state
                    .path_manager
                    .set_custom_scheduled_export_dir(None)
                    .is_err()
                {
                    let err = ApiError::validation("路径验证失败", "INVALID_PATH");
                    return response::error(&err, &request_id);
                }
            }
            Some(dir) => {
                let sanitized = PathManager::sanitize_path(dir);
                if state
                    .path_manager
                    .set_custom_scheduled_export_dir(Some(&sanitized))
                    .is_err()
                {
                    let err = ApiError::validation("禁止访问系统关键目录", "INVALID_PATH");
                    return response::error(&err, &request_id);
                }
                config_obj.insert(
                    "customScheduledExportDir".to_string(),
                    Value::String(sanitized),
                );
            }
        }
    }

    let serialized = serde_json::to_string_pretty(&config).unwrap_or_else(|_| "{}".to_string());
    if tokio::fs::write(&config_path, serialized).await.is_err() {
        let err = ApiError::new(ErrorType::Config, "更新配置失败", "UPDATE_CONFIG_FAILED");
        return response::error(&err, &request_id);
    }
    if state.path_manager.ensure_all_directories_exist().await.is_err() {
        let err = ApiError::new(ErrorType::Config, "更新配置失败", "UPDATE_CONFIG_FAILED");
        return response::error(&err, &request_id);
    }

    response::success(
        json!({
            "message": "配置更新成功",
            "customOutputDir": config.get("customOutputDir").cloned().unwrap_or(Value::Null),
            "customScheduledExportDir": config.get("customScheduledExportDir").cloned().unwrap_or(Value::Null),
            "currentExportsDir": state.path_manager.exports_dir(),
            "currentScheduledExportsDir": state.path_manager.scheduled_exports_dir(),
        }),
        &request_id,
    )
}
