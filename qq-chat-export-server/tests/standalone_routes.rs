//! Exercise the real handlers with isolated storage and a counting fake bridge.
//! Re-executing this test gives PathManager/SecurityManager private configuration
//! without changing process-wide environment variables in parallel Cargo tests.

use std::collections::{HashMap, HashSet};
use std::path::{Path as FsPath, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Instant;

use axum::body::to_bytes;
use axum::extract::{Extension, Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::routing::post;
use axum::{Json, Router};
use qce_server::api::response::RequestId;
use qce_server::api::routes::{albums, files, group_files, groups, resources, scheduled, stickers};
use qce_server::api::state::{AppState, RunMode, SharedState, MAX_ACTIVE_EXPORT_TASKS};
use qce_server::napcat::NapCatBridgeClient;
use qce_server::paths::PathManager;
use qce_server::progress::ProgressTracker;
use qce_server::resource::{ResourceHandler, ResourceHandlerConfig};
use qce_server::scheduler::manager::{ExecutionOutcome, ScheduledExportExecutor};
use qce_server::scheduler::ScheduledExportManager;
use qce_server::security::SecurityManager;
use qce_server::storage::DatabaseManager;
use serde_json::{json, Value};
use tokio::sync::{broadcast, Mutex, Semaphore};

const FIXTURE_ENV: &str = "QCE_STANDALONE_TEST_ROOT";

struct TestRoot(PathBuf);
impl Drop for TestRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[derive(Default)]
struct RecordingExecutor(AtomicUsize);
#[async_trait::async_trait]
impl ScheduledExportExecutor for RecordingExecutor {
    async fn execute(
        &self,
        _task: &Value,
        _start_time_sec: i64,
        _end_time_sec: i64,
    ) -> Result<ExecutionOutcome, String> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(ExecutionOutcome::default())
    }
}

async fn state(
    root: &FsPath,
    endpoint: &str,
    mode: RunMode,
    executor: Arc<RecordingExecutor>,
) -> SharedState {
    let db = Arc::new(DatabaseManager::new(&root.join("fixture.db")));
    db.initialize().await.unwrap();
    let napcat = NapCatBridgeClient::new(endpoint, 1_000).unwrap();
    let path_manager = Arc::new(PathManager::new());
    path_manager
        .set_custom_output_dir(Some(root.join("exports").to_str().unwrap()))
        .unwrap();
    path_manager
        .set_custom_scheduled_export_dir(Some(root.join("plans").to_str().unwrap()))
        .unwrap();
    let resource_handler = Arc::new(
        ResourceHandler::new(
            Arc::new(napcat.clone()),
            None,
            Arc::clone(&db),
            ResourceHandlerConfig {
                storage_root: root.join("resources"),
                ..ResourceHandlerConfig::default()
            },
        )
        .await,
    );
    let scheduled_export_manager = Arc::new(
        ScheduledExportManager::new(Arc::clone(&db), executor)
            .with_execution_enabled(mode == RunMode::Plugin),
    );
    let (ws_tx, _) = broadcast::channel(16);
    Arc::new(AppState {
        napcat,
        run_mode: mode,
        progress_tracker: Arc::new(ProgressTracker::new(Arc::clone(&db))),
        db,
        resource_handler,
        scheduled_export_manager,
        security_manager: Arc::new(SecurityManager::new().unwrap()),
        path_manager,
        ws_tx,
        export_tasks: Mutex::new(HashMap::new()),
        export_semaphore: Arc::new(Semaphore::new(MAX_ACTIVE_EXPORT_TASKS)),
        cancelled_task_ids: Mutex::new(HashSet::new()),
        running_export_cancel_flags: Mutex::new(HashMap::new()),
        resource_file_cache: Mutex::new(HashMap::new()),
        message_cache: Mutex::new(HashMap::new()),
        started_at: Instant::now(),
        static_dir: root.to_owned(),
        port: 0,
    })
}

fn request_id() -> Extension<RequestId> {
    Extension(RequestId("standalone-fixture".to_owned()))
}
fn group() -> Path<String> {
    Path("123456".to_owned())
}
fn query() -> Query<HashMap<String, String>> {
    Query(HashMap::new())
}
async fn response_body(response: Response, status: StatusCode) -> Value {
    assert_eq!(response.status(), status);
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}
async fn assert_standalone(response: Response) {
    let body = response_body(response, StatusCode::SERVICE_UNAVAILABLE).await;
    assert_eq!(body["error"]["context"]["code"], "STANDALONE_MODE");
    assert!(body["error"]["message"]
        .as_str()
        .unwrap()
        .contains("完整模式"));
}

async fn check_standalone(state: SharedState, calls: &StdMutex<Vec<String>>) {
    assert_standalone(groups::group_essence(State(state.clone()), request_id(), group()).await)
        .await;
    assert_standalone(
        groups::export_group_essence(
            State(state.clone()),
            request_id(),
            group(),
            Json(json!({"format":"json"})),
        )
        .await,
    )
    .await;
    assert_standalone(
        groups::export_group_avatars(State(state.clone()), request_id(), group()).await,
    )
    .await;
    assert_standalone(albums::list_group_albums(State(state.clone()), request_id(), group()).await)
        .await;
    assert_standalone(
        albums::list_album_media(
            State(state.clone()),
            request_id(),
            Path(("123456".to_owned(), "album".to_owned())),
        )
        .await,
    )
    .await;
    assert_standalone(
        albums::export_group_album(
            State(state.clone()),
            request_id(),
            group(),
            Json(json!({"albumIds":["album"]})),
        )
        .await,
    )
    .await;
    assert_standalone(
        files::list_group_files(State(state.clone()), request_id(), group(), query()).await,
    )
    .await;
    assert_standalone(files::group_file_count(State(state.clone()), request_id(), group()).await)
        .await;
    assert_standalone(
        files::download_group_file(
            State(state.clone()),
            request_id(),
            group(),
            Json(json!({"fileId":"file"})),
        )
        .await,
    )
    .await;
    assert_standalone(
        files::export_group_files_metadata(
            State(state.clone()),
            request_id(),
            group(),
            Json(json!({"groupName":"fixture"})),
        )
        .await,
    )
    .await;
    assert_standalone(
        files::export_group_files_with_download(
            State(state.clone()),
            request_id(),
            group(),
            Json(json!({"groupName":"fixture"})),
        )
        .await,
    )
    .await;
    assert_standalone(
        scheduled::trigger_all_scheduled_exports(State(state.clone()), request_id(), None).await,
    )
    .await;
    assert_standalone(
        scheduled::trigger_scheduled_exports(
            State(state.clone()),
            request_id(),
            Json(json!({"ids":["saved"]})),
        )
        .await,
    )
    .await;
    assert_standalone(
        scheduled::trigger_scheduled_export(
            State(state.clone()),
            request_id(),
            Path("saved".to_owned()),
        )
        .await,
    )
    .await;
    for requested_types in [
        "favorite_emoji",
        "market_pack",
        "favorite_emoji,market_pack",
    ] {
        assert_standalone(
            stickers::list_sticker_packs(
                State(state.clone()),
                request_id(),
                Query(HashMap::from([(
                    "types".to_owned(),
                    requested_types.to_owned(),
                )])),
            )
            .await,
        )
        .await;
    }
    for pack_id in ["favorite_emojis", "market_fixture"] {
        assert_standalone(
            stickers::export_sticker_pack(
                State(state.clone()),
                request_id(),
                Json(json!({"packId":pack_id})),
            )
            .await,
        )
        .await;
    }
    assert_standalone(stickers::export_all_sticker_packs(State(state.clone()), request_id()).await)
        .await;
    assert!(
        calls.lock().unwrap().is_empty(),
        "standalone handlers must not contact any bridge"
    );
    assert!(state.export_tasks.lock().await.is_empty());
    assert!(
        !state.path_manager.exports_dir().exists(),
        "rejected live exports must not create output folders"
    );

    let body = response_body(
        stickers::list_sticker_packs(State(state.clone()), request_id(), query()).await,
        StatusCode::OK,
    )
    .await;
    let packs = body["data"]["packs"].as_array().unwrap();
    assert!(
        !packs.is_empty(),
        "embedded system stickers must remain available offline"
    );
    assert!(packs.iter().all(|pack| pack["packType"] == "system_pack"));
    assert_eq!(
        body["data"]["unavailableTypes"],
        json!(["favorite_emoji", "market_pack"])
    );
    for (requested_types, unavailable_types) in [
        ("system_pack", json!([])),
        ("system_pack,market_pack", json!(["market_pack"])),
    ] {
        let body = response_body(
            stickers::list_sticker_packs(
                State(state.clone()),
                request_id(),
                Query(HashMap::from([(
                    "types".to_owned(),
                    requested_types.to_owned(),
                )])),
            )
            .await,
            StatusCode::OK,
        )
        .await;
        assert_eq!(body["data"]["packs"], json!(packs));
        assert_eq!(body["data"]["unavailableTypes"], unavailable_types);
    }
    let body = response_body(
        stickers::export_sticker_pack(
            State(state.clone()),
            request_id(),
            Json(json!({"packId":"system_missing"})),
        )
        .await,
        StatusCode::NOT_FOUND,
    )
    .await;
    assert_eq!(body["error"]["context"]["code"], "PACK_NOT_FOUND");
    assert!(calls.lock().unwrap().is_empty());
    assert!(!state.path_manager.exports_dir().exists());

    // Embedded system packs have no external sources, so this export performs no downloads.
    assert!(packs.iter().all(|pack| pack["stickers"]
        .as_array()
        .unwrap()
        .iter()
        .all(|sticker| sticker["path"] == "")));
    let body = response_body(
        stickers::export_sticker_pack(
            State(state.clone()),
            request_id(),
            Json(json!({
                "packId":packs[0]["packId"],
                "packType":"market_pack",
                "path":"/does-not-exist/untrusted-sticker",
            })),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(body["data"]["packCount"], 1);
    let records = response_body(
        stickers::sticker_export_records(State(state.clone()), request_id(), query()).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(
        records["data"]["records"][0]["id"],
        body["data"]["exportId"]
    );
    assert!(calls.lock().unwrap().is_empty());

    // Legacy filenames exercise optional UID/name enrichment, not just an empty directory.
    let export_names = [
        "group_123456_20260922_120000.json",
        "friend_u_fixture_20260922_120000.json",
    ];
    std::fs::create_dir_all(state.path_manager.exports_dir()).unwrap();
    for name in export_names {
        std::fs::write(state.path_manager.exports_dir().join(name), b"{}").unwrap();
    }
    let body = response_body(
        resources::list_export_files(State(state.clone()), request_id()).await,
        StatusCode::OK,
    )
    .await;
    let listed = body["data"]["files"].as_array().unwrap();
    for name in export_names {
        assert!(
            listed.iter().any(|file| file["fileName"] == name),
            "missing offline export: {name}"
        );
    }
    assert!(
        calls.lock().unwrap().is_empty(),
        "offline metadata must not query NapCat"
    );

    // Browsing saved records and editing plans remain available offline.
    let records = json!([{"id":"saved-export", "messageCount":42}]);
    let base = state.path_manager.default_base_dir();
    std::fs::create_dir_all(&base).unwrap();
    for name in ["group-album-records.json", "group-files-records.json"] {
        std::fs::write(base.join(name), serde_json::to_vec(&records).unwrap()).unwrap();
    }
    let body = response_body(
        albums::album_export_records(State(state.clone()), request_id(), query()).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(body["data"]["records"], records);
    let body = response_body(
        group_files::group_files_export_records(State(state.clone()), request_id(), query()).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(body["data"]["records"], records);
    let body = response_body(
        scheduled::list_scheduled_exports(State(state.clone()), request_id()).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(body["data"]["totalCount"], 1);
    let body = response_body(
        scheduled::update_scheduled_export(
            State(state.clone()),
            request_id(),
            Path("saved".to_owned()),
            Json(json!({"name":"edited offline", "enabled":true})),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(body["data"]["name"], "edited offline");
    let body = response_body(
        scheduled::scheduled_export_history(
            State(state.clone()),
            request_id(),
            Path("saved".to_owned()),
            query(),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(body["data"]["history"][0]["id"], "old-history");
    assert!(calls.lock().unwrap().is_empty());
}

async fn check_plugin(
    state: SharedState,
    calls: &StdMutex<Vec<String>>,
    executor: &RecordingExecutor,
) {
    response_body(
        groups::group_essence(State(state.clone()), request_id(), group()).await,
        StatusCode::OK,
    )
    .await;
    let body = response_body(
        albums::list_group_albums(State(state.clone()), request_id(), group()).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(body["data"]["totalCount"], 1);
    let body = response_body(
        files::group_file_count(State(state.clone()), request_id(), group()).await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(body["data"]["fileCount"], 3);
    let body = response_body(
        stickers::list_sticker_packs(
            State(state.clone()),
            request_id(),
            Query(HashMap::from([(
                "types".to_owned(),
                "favorite_emoji".to_owned(),
            )])),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(body["data"]["packs"][0]["packType"], "favorite_emoji");
    assert_eq!(body["data"]["unavailableTypes"], json!([]));
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            "WebApi.getGroupEssenceMsgAll",
            "WebApi.getAlbumListByNTQQ",
            "GroupApi.getGroupFileCount",
            "MsgService.fetchFavEmojiList",
        ]
    );
    let body = response_body(
        scheduled::trigger_scheduled_export(
            State(state.clone()),
            request_id(),
            Path("saved".to_owned()),
        )
        .await,
        StatusCode::OK,
    )
    .await;
    assert_eq!(body["data"]["status"], "success");
    assert_eq!(executor.0.load(Ordering::SeqCst), 1);
}

async fn run_fixture(root: PathBuf) {
    let calls = Arc::new(StdMutex::new(Vec::<String>::new()));
    let recorded = calls.clone();
    let bridge = Router::new().route("/rpc", post(move |Json(request): Json<Value>| {
        let recorded = recorded.clone();
        async move {
            let method = request["method"].as_str().unwrap().to_owned();
            recorded.lock().unwrap().push(method.clone());
            let result = match method.as_str() {
                "WebApi.getGroupEssenceMsgAll" => json!([]),
                "WebApi.getAlbumListByNTQQ" => json!({"response":{"result":0,"album_list":[{"album_id":"a","name":"fixture"}]}}),
                "GroupApi.getGroupFileCount" => json!({"groupFileCounts":[3]}),
                "MsgService.fetchFavEmojiList" => json!({"emojiInfoList":[{"eId":"fixture","desc":"test emoji"}]}),
                _ => panic!("unexpected fake bridge call: {method}"),
            };
            Json(json!({"ok":true,"result":result}))
        }
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let bridge_task = tokio::spawn(async move {
        axum::serve(listener, bridge).await.unwrap();
    });
    for mode in [RunMode::Standalone, RunMode::Plugin] {
        let mode_root = root.join(mode.as_str());
        std::fs::create_dir_all(&mode_root).unwrap();
        let executor = Arc::new(RecordingExecutor::default());
        let state = state(&mode_root, &endpoint, mode, executor.clone()).await;
        state
            .db
            .save_scheduled_export(&json!({
                "id":"saved", "name":"fixture", "enabled":false,
                "scheduleType":"daily", "timeRangeType":"yesterday",
            }))
            .await
            .unwrap();
        state
            .db
            .save_execution_history(&json!({
                "id":"old-history", "scheduledExportId":"saved", "status":"success",
            }))
            .await
            .unwrap();
        state.scheduled_export_manager.initialize().await;
        if mode == RunMode::Standalone {
            check_standalone(state.clone(), &calls).await;
            assert_eq!(executor.0.load(Ordering::SeqCst), 0);
        } else {
            check_plugin(state.clone(), &calls, &executor).await;
        }
        state.scheduled_export_manager.shutdown().await;
        state.db.close().await.unwrap();
    }
    bridge_task.abort();
    let _ = bridge_task.await;
}

#[test]
fn standalone_runtime_keeps_offline_operations_and_blocks_live_work() {
    if let Some(root) = std::env::var_os(FIXTURE_ENV) {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(run_fixture(PathBuf::from(root)));
        return;
    }
    let root = TestRoot(
        std::env::temp_dir().join(format!("qce-standalone-routes-{}", uuid::Uuid::new_v4())),
    );
    std::fs::create_dir_all(&root.0).unwrap();
    let result = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "standalone_runtime_keeps_offline_operations_and_blocks_live_work",
            "--nocapture",
        ])
        .env(FIXTURE_ENV, &root.0)
        .env("USERPROFILE", &root.0)
        .env("QCE_CONFIG_DIR", root.0.join("config"))
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "isolated fixture failed:\n{}\n{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
}
