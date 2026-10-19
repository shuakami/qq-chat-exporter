//! 使用真实定时执行器与资源处理器验证下载、缓存和导出产物。

use super::*;
use axum::{routing::post, Json, Router};
use qce_server::resource::{MediaDownloader, ResourceHandlerConfig};
use qce_server::storage::DatabaseManager;
use serde_json::json;
use tokio::task::JoinHandle;

/// 记录实际下载请求，并在指定位置写入可检查的测试资源。
#[derive(Default)]
struct RecordingDownloader {
    calls: tokio::sync::Mutex<Vec<(String, String)>>,
}

#[async_trait]
impl MediaDownloader for RecordingDownloader {
    async fn download_media(
        &self,
        _msg_id: &str,
        _chat_type: i64,
        peer_uid: &str,
        element_id: &str,
        dest_path: &str,
        _timeout_ms: u64,
    ) -> Result<String, String> {
        // 以会话和元素标识归属请求，便于检查并发任务是否互相污染。
        self.calls
            .lock()
            .await
            .push((peer_uid.to_string(), element_id.to_string()));
        // 写入非空文件，让真实资源健康检查和复制流程参与测试。
        tokio::fs::write(dest_path, b"test-media")
            .await
            .map_err(|error| error.to_string())?;
        Ok(dest_path.to_string())
    }
}

/// 每个测试独占数据库、资源目录与模拟 bridge，避免依赖 QQ 登录或用户缓存。
struct Fixture {
    root: PathBuf,
    executor: ApiScheduledExportExecutor,
    downloader: Arc<RecordingDownloader>,
    server: JoinHandle<()>,
}

impl Fixture {
    async fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("qce-scheduled-resources-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let db = Arc::new(DatabaseManager::new(&root.join("test.db")));
        db.initialize().await.unwrap();
        let app = Router::new().route(
            "/rpc",
            post(|Json(request): Json<Value>| async move {
                // 首批返回可控消息，历史分页返回空页，使执行器正常完成抓取。
                let result = match request["method"].as_str().unwrap() {
                    "MsgService.getAioFirstViewLatestMsgs" => {
                        json!({"msgList": messages(request["params"][0]["peerUid"].as_str().unwrap())})
                    }
                    "MsgService.getMsgsIncludeSelf" => json!({"msgList": []}),
                    "Core.selfInfo" => json!({"uid": "self", "uin": "10001", "nick": "测试账号"}),
                    method => panic!("未预期的 bridge 调用: {method}"),
                };
                Json(json!({"ok": true, "result": result}))
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let napcat = NapCatBridgeClient::new(&format!("http://{address}"), 1_000).unwrap();
        let downloader = Arc::new(RecordingDownloader::default());
        let handler = Arc::new(
            ResourceHandler::new(
                downloader.clone(),
                None,
                db,
                ResourceHandlerConfig {
                    storage_root: root.join("cache"),
                    ..ResourceHandlerConfig::default()
                },
            )
            .await,
        );
        Self {
            executor: ApiScheduledExportExecutor::new(
                napcat,
                handler,
                Arc::new(PathManager::new()),
            ),
            root,
            downloader,
            server,
        }
    }

    fn task(&self, peer: &str, format: &str, options: Value) -> Value {
        json!({
            "name": peer,
            "peer": {"chatType": 1, "peerUid": peer, "peerUin": "10002"},
            "format": format,
            "options": options,
            "outputDir": self.root.join(peer),
        })
    }

    async fn run(&self, task: &Value) -> ExecutionOutcome {
        self.executor
            .execute(task, 1_700_000_000, 1_700_000_100)
            .await
            .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // 无论断言是否成功，都关闭测试服务器并移除本测试创建的目录。
        self.server.abort();
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}

/// 混合消息与纯图片消息共同验证快速导出不会删除多媒体消息。
fn messages(peer: &str) -> Vec<Value> {
    vec![
        json!({
            "msgId": "mixed", "msgTime": "1700000010", "msgSeq": "2",
            "chatType": 1, "peerUid": peer, "senderUid": "self", "sendNickName": "测试账号",
            "elements": [
                {"elementId": "text", "elementType": 1, "textElement": {"content": "保留测试文本"}},
                {"elementId": "image", "elementType": 2, "picElement": {
                    "fileName": format!("{peer}.jpg"), "fileSize": 10,
                    "picWidth": 640, "picHeight": 480,
                    "originImageUrl": "https://example.invalid/test.jpg"
                }},
                {"elementId": "video", "elementType": 5, "videoElement": {
                    "fileName": format!("{peer}.mp4"), "fileSize": 10, "duration": 3
                }},
                {"elementId": "audio", "elementType": 4, "pttElement": {
                    "fileName": format!("{peer}.wav"), "fileSize": 10, "duration": 2
                }},
                {"elementId": "file", "elementType": 3, "fileElement": {
                    "fileName": format!("{peer}.txt"), "fileSize": 10
                }}
            ]
        }),
        json!({
            "msgId": "image-only", "msgTime": "1700000020", "msgSeq": "3",
            "chatType": 1, "peerUid": peer, "senderUid": "self", "sendNickName": "测试账号",
            "elements": [{"elementId": "image-only", "elementType": 2, "picElement": {
                "fileName": format!("{peer}-only.jpg"), "fileSize": 10,
                "picWidth": 320, "picHeight": 240
            }}]
        }),
    ]
}

/// 返回实际文件，空目录不算新下载或文件复制。
fn files_under(root: &std::path::Path) -> Vec<PathBuf> {
    walkdir::WalkDir::new(root)
        .into_iter()
        .map(Result::unwrap)
        .filter(|entry| entry.file_type().is_file())
        .map(walkdir::DirEntry::into_path)
        .collect()
}

#[tokio::test]
async fn quick_export_skips_downloads_and_preserves_messages() {
    let fixture = Fixture::new().await;
    let task = fixture.task("quick", "JSON", json!({"filterPureImageMessages": true}));
    let outcome = fixture.run(&task).await;
    assert_eq!(outcome.message_count, 2);
    // 直接检查真实下载边界，旧执行器会发起五次下载并使此断言失败。
    assert_eq!(fixture.downloader.calls.lock().await.len(), 0);
    assert_eq!(files_under(&fixture.root.join("cache")).len(), 0);
    let output = tokio::fs::read_to_string(outcome.file_path.unwrap())
        .await
        .unwrap();
    let data: Value = serde_json::from_str(&output).unwrap();
    assert_eq!(data["messages"].as_array().unwrap().len(), 2);
    assert!(output.contains("保留测试文本"));
    assert!(output.contains("quick-only.jpg"));
    assert!(output.contains("640"));
    assert!(output.contains("480"));
    assert!(output.contains("https://example.invalid/test.jpg"));
    assert_eq!(files_under(&fixture.root.join("quick")).len(), 1);
    assert!(outcome.resource_summary.is_none());
    // 结构化断言确认元数据与纯图片消息均来自最终产物，而非中间调试文件。
    let exported: Vec<CleanMessage> = serde_json::from_value(data["messages"].clone()).unwrap();
    // 解析器原本会在纯文本末尾追加多媒体占位说明，保留该既有格式。
    assert_eq!(
        exported[0].content.text,
        "保留测试文本[图片:quick.jpg][视频:quick.mp4][语音:2秒][文件:quick.txt]"
    );
    let image = &exported[0].content.elements[1];
    assert_eq!(image.data["width"], 640);
    assert_eq!(image.data["height"], 480);
    assert_eq!(image.data["size"], 10);
    assert!(image.data.get("localPath").is_none());
    assert_eq!(exported[1].id, "image-only");
    assert_eq!(exported[1].content.elements[0].element_type, "image");
}

#[tokio::test]
async fn scheduled_formats_keep_messages_with_and_without_downloads() {
    let fixture = Fixture::new().await;
    for format in ["JSON", "HTML", "TXT"] {
        for quick in [true, false] {
            // 每次使用不同文件名，防止缓存命中掩盖关闭快速导出后的下载行为。
            let peer = format!("{format}-{quick}");
            let before = fixture.downloader.calls.lock().await.len();
            let task = fixture.task(&peer, format, json!({"filterPureImageMessages": quick}));
            let outcome = fixture.run(&task).await;
            let after = fixture.downloader.calls.lock().await.len();
            assert_eq!(after - before, if quick { 0 } else { 5 }, "{peer}");
            assert_eq!(outcome.message_count, 2, "{peer}");
            let output = tokio::fs::read_to_string(outcome.file_path.unwrap())
                .await
                .unwrap();
            assert!(output.contains("保留测试文本"), "{peer}");
            assert!(output.contains(&format!("{peer}-only.jpg")), "{peer}");
            if quick {
                // 三种格式都只生成导出文件；HTML 创建的空资源目录不算资源文件。
                assert_eq!(files_under(&fixture.root.join(&peer)).len(), 1, "{peer}");
            } else {
                assert_eq!(outcome.resource_summary.as_ref().unwrap()["downloaded"], 5);
                assert_eq!(outcome.resource_summary.as_ref().unwrap()["failed"], 0);
            }
        }
    }
}

#[tokio::test]
async fn scheduled_download_type_filters_keep_the_other_types_enabled() {
    let fixture = Fixture::new().await;
    for skipped in ["image", "video", "audio", "file"] {
        let peer = format!("skip-{skipped}");
        let task = fixture.task(
            &peer,
            "JSON",
            json!({"skipDownloadResourceTypes": [skipped]}),
        );
        let outcome = fixture.run(&task).await;
        let calls = fixture.downloader.calls.lock().await;
        let actual: HashSet<&str> = calls
            .iter()
            .filter(|(owner, _)| owner == &peer)
            .map(|(_, element)| element.as_str())
            .collect();
        let expected: HashSet<&str> = ["image", "image-only", "video", "audio", "file"]
            .into_iter()
            .filter(|element| {
                if skipped == "image" {
                    !element.starts_with("image")
                } else {
                    *element != skipped
                }
            })
            .collect();
        assert_eq!(actual, expected, "{skipped}");
        let summary = outcome.resource_summary.unwrap();
        assert_eq!(summary["skipped"], if skipped == "image" { 2 } else { 1 });
        assert_eq!(summary["failed"], 0);
        assert_eq!(outcome.message_count, 2);
    }
}

/// 同时检查文件名和内容，区分缓存保留与新增或覆盖文件。
fn snapshot(root: &std::path::Path) -> Vec<(PathBuf, Vec<u8>)> {
    let mut files: Vec<_> = files_under(root)
        .into_iter()
        .map(|path| {
            let bytes = std::fs::read(&path).unwrap();
            (path, bytes)
        })
        .collect();
    files.sort();
    files
}

#[tokio::test]
async fn cached_resources_are_reused_normally_and_untouched_by_quick_export() {
    let fixture = Fixture::new().await;
    let mut task = fixture.task("cached", "JSON", json!({}));
    let first = fixture.run(&task).await;
    assert_eq!(first.resource_summary.unwrap()["downloaded"], 5);
    let cache = snapshot(&fixture.root.join("cache"));
    assert_eq!(cache.len(), 5);
    // 普通 JSON 会复制下载索引中的五个资源到导出目录。
    assert_eq!(files_under(&fixture.root.join("cached/resources")).len(), 5);
    let second = fixture.run(&task).await;
    let summary = second.resource_summary.unwrap();
    assert_eq!(summary["failed"], 0);
    // 健康检查可能缓存首次缺文件的结果，摘要不能单独证明发生了新下载。
    // 以下载器调用次数和磁盘快照核验：复用缓存后两者都必须保持不变。
    assert_eq!(fixture.downloader.calls.lock().await.len(), 5);
    assert_eq!(snapshot(&fixture.root.join("cache")), cache);

    // 快速任务使用独立输出目录，已有缓存不能被当成这次的新下载或复制。
    task["options"] = json!({"filterPureImageMessages": true});
    task["outputDir"] = json!(fixture.root.join("quick-cached"));
    let quick = fixture.run(&task).await;
    assert!(quick.resource_summary.is_none());
    assert_eq!(fixture.downloader.calls.lock().await.len(), 5);
    assert_eq!(snapshot(&fixture.root.join("cache")), cache);
    assert_eq!(files_under(&fixture.root.join("quick-cached")).len(), 1);
}

#[tokio::test]
async fn concurrent_scheduled_exports_keep_independent_resource_options() {
    let fixture = Fixture::new().await;
    let images = fixture.task(
        "images",
        "JSON",
        json!({"skipDownloadResourceTypes": ["video", "audio", "file"]}),
    );
    let others = fixture.task(
        "others",
        "JSON",
        json!({"skipDownloadResourceTypes": ["image"]}),
    );
    let quick = fixture.task(
        "parallel-quick",
        "JSON",
        json!({"filterPureImageMessages": true}),
    );
    // 三个任务共享同一资源处理器，并发进入真实 execute 调用。
    let (images, others, quick) = tokio::join!(
        fixture.run(&images),
        fixture.run(&others),
        fixture.run(&quick)
    );
    assert_eq!(images.resource_summary.unwrap()["downloaded"], 2);
    assert_eq!(others.resource_summary.unwrap()["downloaded"], 3);
    assert!(quick.resource_summary.is_none());
    let calls = fixture.downloader.calls.lock().await;
    let actual: HashSet<_> = calls
        .iter()
        .map(|(peer, element)| (peer.as_str(), element.as_str()))
        .collect();
    assert_eq!(
        actual,
        HashSet::from([
            ("images", "image"),
            ("images", "image-only"),
            ("others", "video"),
            ("others", "audio"),
            ("others", "file"),
        ])
    );
    drop(calls);
    // 后续未设置开关的任务仍应下载全部类型，证明没有遗留跳过配置。
    let normal = fixture.task("after-parallel", "JSON", json!({}));
    assert_eq!(
        fixture.run(&normal).await.resource_summary.unwrap()["downloaded"],
        5
    );
}

#[tokio::test]
async fn quick_export_does_not_wait_for_or_reset_another_resource_session() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    let fixture = Fixture::new().await;
    let handler = &fixture.executor.resource_handler;
    // 模拟另一个导出持有锁且已设置跳过图片与进度回调。
    let _session = handler.acquire_export_session().await;
    handler
        .set_skip_download_types(Some(&["image".to_string()]))
        .await;
    let progress_calls = Arc::new(AtomicUsize::new(0));
    let captured = Arc::clone(&progress_calls);
    handler
        .set_progress_callback(Some(Arc::new(move |_| {
            captured.fetch_add(1, Ordering::SeqCst);
        })))
        .await;
    let task = fixture.task(
        "while-locked",
        "JSON",
        json!({"filterPureImageMessages": true}),
    );
    tokio::time::timeout(Duration::from_secs(5), fixture.run(&task))
        .await
        .expect("快速导出不应等待下载会话锁");
    assert_eq!(fixture.downloader.calls.lock().await.len(), 0);
    // 仍在原会话锁内继续处理，图片必须被跳过，且原回调必须仍然生效。
    handler.process_message_resources(&messages("owner")).await;
    let summary = handler.last_batch_summary().await;
    assert_eq!(summary.skipped, 2);
    assert_eq!(summary.downloaded, 3);
    assert!(progress_calls.load(Ordering::SeqCst) > 0);
}
