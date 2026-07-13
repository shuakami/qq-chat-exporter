use qce_exporter::html_exporter::{HtmlExporter, HtmlFormatOptions};
use qce_exporter::json_exporter::{JsonExporter, JsonFormatOptions};
use qce_exporter::modern_html_exporter::{
    ChunkedHtmlExportOptions, HtmlExportOptions, ModernHtmlExporter,
};
use qce_exporter::reply_preview_renderer::{
    render_reply_preview_element, render_reply_preview_elements, ReplyPreviewRenderContext,
};
use qce_exporter::reply_render::{
    choose_reply_jump_target, format_reply_timestamp, pick_reply_render_hints, ReplyRenderInput,
};
use qce_exporter::text_exporter::{TextExporter, TextFormatOptions};
use qce_exporter::types::{
    ChatInfo, CleanMessage, ExportOptions, MessageContent, MessageElement, MessageResource, Sender,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("qce-rust-test-{name}-{nonce}"));
        fs::create_dir_all(&path).expect("create test directory");
        Self { path }
    }

    fn join(&self, path: impl AsRef<Path>) -> PathBuf {
        self.path.join(path)
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn chat_info() -> ChatInfo {
    ChatInfo {
        name: "测试群聊".to_owned(),
        chat_type: "group".to_owned(),
        avatar: None,
        participant_count: Some(2),
        self_uid: Some("self".to_owned()),
        self_uin: Some("10000".to_owned()),
        self_name: Some("自己".to_owned()),
        peer_uid: None,
        peer_uin: None,
    }
}

fn sender(uid: &str, name: &str) -> Sender {
    Sender {
        uid: uid.to_owned(),
        uin: Some(uid.to_owned()),
        name: name.to_owned(),
        nickname: Some(name.to_owned()),
        group_card: None,
        remark: None,
        title: None,
        avatar_base64: None,
    }
}

fn message(id: &str, timestamp: i64, elements: Vec<MessageElement>) -> CleanMessage {
    CleanMessage {
        id: id.to_owned(),
        seq: id.to_owned(),
        timestamp,
        time: "2024-06-15 12:34:00".to_owned(),
        sender: sender("10001", "Alice"),
        message_type: "normal".to_owned(),
        content: MessageContent {
            text: elements
                .iter()
                .filter(|element| element.element_type == "text")
                .filter_map(|element| element.data.get("text").and_then(Value::as_str))
                .collect::<String>(),
            html: None,
            elements,
            resources: Vec::new(),
            mentions: Vec::new(),
        },
        recalled: false,
        system: false,
        raw_message: None,
    }
}

fn text_element(text: &str) -> MessageElement {
    MessageElement {
        element_type: "text".to_owned(),
        data: json!({ "text": text }),
    }
}

fn export_options(output_path: PathBuf) -> ExportOptions {
    ExportOptions {
        output_path,
        ..ExportOptions::default()
    }
}

#[tokio::test]
async fn text_json_and_html_exporters_cover_the_shared_fixture() {
    let temp = TestDir::new("formats");
    let messages = vec![
        message("m2", 1_718_454_900_000, vec![text_element("第二条")]),
        message("m1", 1_718_454_840_000, vec![text_element("第一条")]),
    ];
    let mut chat = chat_info();
    chat.peer_uid = Some("u_peer".to_owned());
    chat.peer_uin = Some("1687657986".to_owned());

    let text_path = temp.join("chat.txt");
    let text_exporter = TextExporter::new(
        export_options(text_path.clone()),
        TextFormatOptions::default(),
    );
    let text_result = text_exporter
        .export(messages.clone(), &chat)
        .await
        .expect("text export");
    let text = fs::read_to_string(text_path).expect("read text export");
    assert_eq!(text_result.message_count, 2);
    assert!(text.contains("测试群聊"));
    assert!(
        text.find("第一条").expect("first message") < text.find("第二条").expect("second message")
    );

    let json_path = temp.join("chat.json");
    let json_exporter = JsonExporter::new(
        export_options(json_path.clone()),
        JsonFormatOptions::default(),
    );
    let json_result = json_exporter
        .export(messages.clone(), &chat)
        .await
        .expect("json export");
    let json: Value = serde_json::from_slice(&fs::read(json_path).expect("read json export"))
        .expect("parse json");
    assert_eq!(json_result.message_count, 2);
    assert_eq!(json["chatInfo"]["name"], "测试群聊");
    assert_eq!(json["chatInfo"]["peerUid"], "u_peer");
    assert_eq!(json["chatInfo"]["peerUin"], "1687657986");
    assert_eq!(json["messages"].as_array().expect("messages").len(), 2);
    assert_eq!(json["messages"][0]["id"], "m1");

    let html_path = temp.join("chat.html");
    let html_exporter = HtmlExporter::new(
        export_options(html_path.clone()),
        HtmlFormatOptions::default(),
    );
    let html_result = html_exporter
        .export(messages, &chat)
        .await
        .expect("html export");
    let html = fs::read_to_string(html_path).expect("read html export");
    assert_eq!(html_result.message_count, 2);
    assert!(html.contains("<!DOCTYPE html>"));
    assert!(html.contains("第一条"));
    assert!(html.contains("第二条"));
}

#[tokio::test]
async fn modern_html_renders_structured_system_rows_and_flat_json_cards() {
    let temp = TestDir::new("structured-system");
    let mut system_message = message(
        "system",
        1_718_454_840_000,
        vec![MessageElement {
            element_type: "system".to_owned(),
            data: json!({
                "text": "速冻饺子戳了戳笨蛋Darf v2",
                "items": [
                    { "type": "qq", "text": "速冻饺子" },
                    {
                        "type": "img",
                        "src": "https://example.com/nudge.png",
                        "url": "https://example.com/nudge"
                    },
                    { "type": "text", "text": "戳了戳" },
                    { "type": "qq", "text": "笨蛋Darf v2" }
                ]
            }),
        }],
    );
    system_message.system = true;
    system_message.recalled = true;
    let (system_html, _) = render_modern_html(&temp, "system", system_message, |_| {}).await;
    assert!(system_html.contains("system-message-container recalled-message"));
    assert!(system_html.contains("class=\"system-message-image\""));
    assert!(system_html.contains("速冻饺子"));
    assert!(system_html.contains("笨蛋Darf v2"));
    assert!(!system_html.contains(".system-message-container.recalled-message"));

    let json_message = message(
        "json",
        1_718_454_840_000,
        vec![MessageElement {
            element_type: "json".to_owned(),
            data: json!({
                "title": "[QQ小程序]《RPG模拟器》",
                "description": "《RPG模拟器》",
                "url": "https://example.com/card"
            }),
        }],
    );
    let (json_html, _) = render_modern_html(&temp, "json-card", json_message, |_| {}).await;
    assert!(json_html.contains("class=\"json-card\""));
    assert!(json_html.contains("href=\"https://example.com/card\""));
    assert!(json_html.contains(".json-card {\n            padding: 2px 0;"));
    assert!(!json_html.contains(".message.self .json-card"));

    let reply_message = message(
        "reply",
        1_718_454_840_000,
        vec![MessageElement {
            element_type: "reply".to_owned(),
            data: json!({
                "referencedMessageId": "msg-original",
                "senderName": "速冻饺子",
                "content": "原消息"
            }),
        }],
    );
    let original_message = message(
        "original",
        1_718_454_800_000,
        vec![MessageElement {
            element_type: "text".to_owned(),
            data: json!({ "text": "原消息" }),
        }],
    );
    let (reply_html, _) = render_modern_messages(
        &temp,
        "reply",
        vec![original_message, reply_message],
        |_| {},
    )
    .await;
    assert!(reply_html.contains("data-reply-to=\"msg-original\""));
    assert!(!reply_html.contains("data-reply-to=\"msg-msg-original\""));
    assert!(reply_html.contains("class=\"reply-content-icon\""));
}

#[tokio::test]
async fn modern_html_handles_group_updates_faces_mentions_and_video_files() {
    let temp = TestDir::new("message-edge-cases");
    let mut system_message = message(
        "group-update",
        1_718_454_840_000,
        vec![MessageElement {
            element_type: "system".to_owned(),
            data: json!({
                "text": "群聊更新",
                "items": [],
                "originalData": {
                    "groupElement": {
                        "type": 1,
                        "memberNick": "速冻饺子",
                        "memberAdd": { "showType": 1 }
                    }
                }
            }),
        }],
    );
    system_message.system = true;
    let (system_html, _) = render_modern_html(&temp, "group-update", system_message, |_| {}).await;
    assert!(system_html.contains("你加入了群聊"));
    assert!(!system_html.contains(">群聊更新<"));

    let mut title_message = message(
        "title",
        1_718_454_840_000,
        vec![MessageElement {
            element_type: "system".to_owned(),
            data: json!({
                "text": "恭喜我是绝活飞刀乌咪获得群主授予的真•小匕崽子头衔",
                "items": [
                    { "type": "nor", "text": "恭喜", "url": "" },
                    { "type": "url", "text": "我是绝活飞刀乌咪", "url": "5" },
                    {
                        "type": "url",
                        "text": "真•小匕崽子",
                        "url": "https://qun.qq.com/title"
                    }
                ]
            }),
        }],
    );
    title_message.system = true;
    let (title_html, _) = render_modern_html(&temp, "title", title_message, |_| {}).await;
    assert!(title_html.contains("恭喜我是绝活飞刀乌咪"));
    assert!(!title_html.contains("href=\"5\""));
    assert!(title_html.contains("href=\"https://qun.qq.com/title\""));

    let content_message = message(
        "content",
        1_718_454_840_000,
        vec![
            MessageElement {
                element_type: "reply".to_owned(),
                data: json!({
                    "referencedMessageId": "original",
                    "senderName": "已经不需要再QB了",
                    "content": "有人躲猫猫吗"
                }),
            },
            MessageElement {
                element_type: "at".to_owned(),
                data: json!({ "uid": "all", "name": "全体成员", "atType": 1 }),
            },
            text_element(" "),
            MessageElement {
                element_type: "face".to_owned(),
                data: json!({
                    "id": "359",
                    "name": "/包剪锤",
                    "faceType": 3,
                    "resultId": "2"
                }),
            },
            MessageElement {
                element_type: "file".to_owned(),
                data: json!({
                    "filename": "2025-07-02 15-52-50.mp4",
                    "localPath": "files/hash_clip.mp4",
                    "size": 12_452_384
                }),
            },
            MessageElement {
                element_type: "file".to_owned(),
                data: json!({
                    "filename": "document.pdf",
                    "localPath": "files/document.pdf"
                }),
            },
        ],
    );
    let (content_html, _) = render_modern_html(&temp, "content", content_message, |_| {}).await;
    assert!(content_html.contains("class=\"at-mention\">@全体成员</span>"));
    assert!(!content_html.contains("<span class=\"text-content\"> </span>"));
    assert!(content_html.contains("https://koishi.js.org/QFace/assets/qq_emoji/359/png/359.png"));
    assert!(content_html.contains("class=\"face-emoji native-game-face\""));
    assert!(content_html.contains("class=\"native-rps-result native-rps-result-2\""));
    assert!(content_html.contains("aria-label=\"包剪锤：剪刀\""));
    assert!(content_html.contains("class=\"video-bubble\""));
    assert!(content_html.contains("data-src=\"./resources/files/hash_clip.mp4\""));
    assert!(content_html.contains(
        "href=\"./resources/files/document.pdf\" class=\"message-file file-bubble\" target=\"_blank\" rel=\"noopener noreferrer\""
    ));
    assert!(!content_html.contains("download=\"document.pdf\""));
}

#[tokio::test]
async fn modern_html_repairs_historical_reply_ids_for_single_and_chunked_exports() {
    let temp = TestDir::new("historical-reply-targets");
    let image_target = message(
        "7550661840517106706",
        1_758_025_456_000,
        vec![MessageElement {
            element_type: "image".to_owned(),
            data: json!({ "md5": "2fba99613c5656a48d0cb2801b20af1d" }),
        }],
    );
    let text_target = message(
        "7550661067109350011",
        1_758_025_276_000,
        vec![MessageElement {
            element_type: "text".to_owned(),
            data: json!({ "text": "终于不用每次切后台关vpn了" }),
        }],
    );
    let image_reply = message(
        "7550673423851295946",
        1_758_028_153_000,
        vec![MessageElement {
            element_type: "reply".to_owned(),
            data: json!({
                "messageId": "7550673423851295947",
                "referencedMessageId": "7550673423851295947",
                "senderUin": "10001",
                "senderName": "笨蛋Darf v2",
                "content": "[图片]",
                "timestamp": 1_758_025_456
            }),
        }],
    );
    let text_reply = message(
        "7550673536078933491",
        1_758_028_179_000,
        vec![MessageElement {
            element_type: "reply".to_owned(),
            data: json!({
                "messageId": "7550673536078933492",
                "referencedMessageId": "7550673536078933492",
                "senderUin": "10001",
                "senderName": "笨蛋Darf v2",
                "content": "终于不用每次切后台关vpn了",
                "timestamp": 1_758_025_276
            }),
        }],
    );
    let messages = vec![image_target, text_target, image_reply, text_reply];

    let (single_html, _) =
        render_modern_messages(&temp, "single-repaired", messages.clone(), |_| {}).await;
    assert!(single_html.contains("data-reply-to=\"msg-7550661840517106706\""));
    assert!(single_html.contains("data-reply-to=\"msg-7550661067109350011\""));
    assert!(!single_html.contains("data-reply-to=\"msg-7550673423851295947\""));
    assert!(!single_html.contains("data-reply-to=\"msg-7550673536078933492\""));

    let chunked_dir = temp.join("chunked-repaired");
    fs::create_dir_all(&chunked_dir).expect("create chunked output directory");
    let mut exporter = ModernHtmlExporter::new(HtmlExportOptions {
        output_path: chunked_dir.join("index.html"),
        ..HtmlExportOptions::default()
    });
    exporter
        .export_chunked(
            &messages,
            &chat_info(),
            &ChunkedHtmlExportOptions::default(),
        )
        .await
        .expect("chunked export");
    let chunk = fs::read_dir(chunked_dir.join("data/chunks"))
        .expect("read chunks directory")
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| path.extension().and_then(|ext| ext.to_str()) == Some("js"))
        .and_then(|path| fs::read_to_string(path).ok())
        .expect("read chunk");
    assert!(chunk.contains("msg-7550661840517106706"));
    assert!(chunk.contains("msg-7550661067109350011"));
    assert!(!chunk.contains("msg-7550673423851295947"));
    assert!(!chunk.contains("msg-7550673536078933492"));
}

fn resource_message(resource_type: &str, filename: &str, source: &Path) -> CleanMessage {
    message(
        "m_resource",
        1_718_454_840_000,
        vec![MessageElement {
            element_type: resource_type.to_owned(),
            data: json!({
                "filename": filename,
                "localPath": source.to_string_lossy(),
                "url": ""
            }),
        }],
    )
}

async fn render_modern_html(
    temp: &TestDir,
    name: &str,
    message: CleanMessage,
    options: impl FnOnce(&mut HtmlExportOptions),
) -> (String, PathBuf) {
    render_modern_messages(temp, name, vec![message], options).await
}

async fn render_modern_messages(
    temp: &TestDir,
    name: &str,
    messages: Vec<CleanMessage>,
    options: impl FnOnce(&mut HtmlExportOptions),
) -> (String, PathBuf) {
    let output_dir = temp.join(name);
    fs::create_dir_all(&output_dir).expect("create output directory");
    let output_path = output_dir.join("chat.html");
    let mut html_options = HtmlExportOptions {
        output_path,
        ..HtmlExportOptions::default()
    };
    options(&mut html_options);
    let mut exporter = ModernHtmlExporter::new(html_options);
    exporter
        .export(&messages, &chat_info())
        .await
        .expect("modern html export");
    (
        fs::read_to_string(output_dir.join("chat.html")).expect("read modern html"),
        output_dir,
    )
}

#[tokio::test]
async fn modern_html_embeds_resources_and_respects_fallbacks() {
    let temp = TestDir::new("data-uri");
    let png_path = temp.join("screenshot.png");
    fs::write(
        &png_path,
        hex_bytes(
            "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4\
             890000000d49444154789c63600000000200015e2bb1f80000000049454e44ae426082",
        ),
    )
    .expect("write png");

    let (inline_html, inline_dir) = render_modern_html(
        &temp,
        "inline",
        resource_message("image", "screenshot.png", &png_path),
        |options| options.embed_resources_as_data_uri = true,
    )
    .await;
    assert!(inline_html.contains("src=\"data:image/png;base64,"));
    assert!(!inline_html.contains("./resources/images/screenshot.png"));
    assert!(!inline_dir.join("resources").exists());

    let (external_html, external_dir) = render_modern_html(
        &temp,
        "external",
        resource_message("image", "screenshot.png", &png_path),
        |_| {},
    )
    .await;
    assert!(external_html.contains("src=\"./resources/images/screenshot.png\""));
    assert_eq!(
        fs::read(external_dir.join("resources/images/screenshot.png")).expect("copied png"),
        fs::read(&png_path).expect("source png")
    );

    let (oversize_html, _) = render_modern_html(
        &temp,
        "oversize",
        resource_message("image", "screenshot.png", &png_path),
        |options| {
            options.embed_resources_as_data_uri = true;
            options.max_embed_file_size_bytes = 10;
        },
    )
    .await;
    assert!(!oversize_html.contains("data:image/png;base64,"));
    assert!(oversize_html.contains("./resources/images/screenshot.png"));

    let audio_path = temp.join("voice.silk");
    fs::write(&audio_path, b"SILK_FAKE_BYTES_FOR_TEST_PURPOSES").expect("write audio");
    let (audio_html, _) = render_modern_html(
        &temp,
        "audio",
        resource_message("audio", "voice.silk", &audio_path),
        |options| options.embed_resources_as_data_uri = true,
    )
    .await;
    assert!(audio_html.contains("class=\"voice-bubble\" data-src=\"data:audio/silk;base64,"));
}

#[tokio::test]
async fn modern_html_renders_nested_forwards_and_print_options() {
    let temp = TestDir::new("modern-options");
    let nested = message(
        "m_forward",
        1_718_454_840_000,
        vec![MessageElement {
            element_type: "forward".to_owned(),
            data: json!({
                "title": "聊天记录",
                "messageCount": 6,
                "messages": [
                    {
                        "sender": { "name": "中层用户" },
                        "content": {
                            "text": "[转发消息: 2条]",
                            "elements": [{
                                "type": "forward",
                                "data": {
                                    "title": "聊天记录",
                                    "messageCount": 2,
                                    "messages": [
                                        {
                                            "sender": { "name": "深层用户甲" },
                                            "content": {
                                                "text": "最里层消息一",
                                                "elements": [{ "type": "text", "data": { "text": "最里层消息一" } }]
                                            }
                                        },
                                        {
                                            "sender": { "name": "深层用户乙" },
                                            "content": {
                                                "text": "最里层消息二",
                                                "elements": [{ "type": "text", "data": { "text": "最里层消息二" } }]
                                            }
                                        }
                                    ]
                                }
                            }]
                        }
                    },
                    {
                        "sender": { "name": "用户二" },
                        "content": {
                            "text": "[图片:forward.jpg]",
                            "elements": [{
                                "type": "image",
                                "data": {
                                    "filename": "forward.jpg",
                                    "localPath": "images/forward.jpg"
                                }
                            }]
                        }
                    },
                    {
                        "sender": { "name": "用户三" },
                        "content": { "text": "消息三", "elements": [] }
                    },
                    {
                        "sender": { "name": "用户四" },
                        "content": { "text": "消息四", "elements": [] }
                    },
                    {
                        "sender": { "name": "用户五" },
                        "content": { "text": "消息五", "elements": [] }
                    },
                    {
                        "sender": { "name": "用户六" },
                        "content": { "text": "消息六", "elements": [] }
                    }
                ]
            }),
        }],
    );
    let (html, _) = render_modern_html(&temp, "nested", nested, |options| {
        options.show_search_bar = false;
        options.enable_virtual_scroll = false;
    })
    .await;

    assert!(html.contains("深层用户甲"));
    assert!(html.contains("最里层消息二"));
    assert!(html.contains("forward-card-nested"));
    assert!(html.contains("forward-card-line forward-card-extra"));
    assert!(html.contains("data-count=\"6\""));
    assert!(html.contains("展开全部 6 条"));
    assert!(html.contains("forward-card-toggle-label"));
    assert!(html.contains("class=\"forward-card-toggle-icon\""));
    assert!(html.contains("aria-expanded=\"false\""));
    assert!(html.contains("function toggleForwardCard(target)"));
    assert!(html.contains("button.setAttribute('aria-expanded', expanded ? 'true' : 'false')"));
    assert!(html.contains("<span>转发消息</span>"));
    assert!(!html.contains("forward-card-icon"));
    assert!(!html.contains("转发消息 ·"));
    assert!(!html.contains("[转发消息: 2条]"));
    assert!(!html.contains("[图片:forward.jpg]"));
    assert!(html.contains("class=\"image-content\""));
    assert!(html.contains("src=\"./resources/images/forward.jpg\""));
    assert!(html.contains("<div class=\"toolbar\" style=\"display:none\">"));
    assert!(html.contains("window.__QCE_ENABLE_VIRTUAL_SCROLL = false"));
}

#[tokio::test]
async fn modern_html_keeps_default_print_options_and_caps_forward_depth() {
    let temp = TestDir::new("modern-defaults");
    let (defaults, _) = render_modern_html(
        &temp,
        "defaults",
        message("m_default", 1_718_454_840_000, vec![text_element("你好")]),
        |_| {},
    )
    .await;
    assert!(defaults.contains("<div class=\"toolbar\">"));
    assert!(!defaults.contains("<div class=\"toolbar\" style=\"display:none\">"));
    assert!(defaults.contains("window.__QCE_ENABLE_VIRTUAL_SCROLL = true"));
    assert!(defaults
        .contains("window.__QCE_ENABLE_VIRTUAL_SCROLL !== false && messageBlocks.length > 100"));

    fn nested_forward(depth: usize) -> Value {
        if depth == 0 {
            return json!({
                "sender": { "name": "leaf" },
                "content": {
                    "text": "leaf message",
                    "elements": [{ "type": "text", "data": { "text": "leaf message" } }]
                }
            });
        }
        json!({
            "sender": { "name": format!("level-{depth}") },
            "content": {
                "text": "[forward: 1 message]",
                "elements": [{
                    "type": "forward",
                    "data": {
                        "title": "chat history",
                        "messageCount": 1,
                        "messages": [nested_forward(depth - 1)]
                    }
                }]
            }
        })
    }

    let deep = message(
        "m_deep",
        1_718_454_840_000,
        vec![MessageElement {
            element_type: "forward".to_owned(),
            data: json!({
                "title": "chat history",
                "messageCount": 1,
                "messages": [nested_forward(6)]
            }),
        }],
    );
    let (deep_html, _) = render_modern_html(&temp, "deep", deep, |_| {}).await;
    assert!(deep_html.contains("level-6"));
    assert!(deep_html.contains("forward-card-nested"));
}

#[tokio::test]
async fn json_exporter_copies_downloaded_resources() {
    let temp = TestDir::new("resource-map");
    let source_file = temp.join("group_doc.pdf");
    let source_image = temp.join("group_pic.png");
    fs::write(&source_file, b"PDF-DATA-FOR-TEST").expect("write file");
    fs::write(&source_image, b"PNG-DATA-FOR-TEST").expect("write image");

    let output_dir = temp.join("out");
    let output_path = output_dir.join("chat.json");
    let resources = vec![
        MessageResource {
            resource_type: "file".to_owned(),
            filename: Some("group_doc.pdf".to_owned()),
            size: Some(17),
            url: None,
            local_path: Some(source_file.to_string_lossy().into_owned()),
            width: None,
            height: None,
            duration: None,
        },
        MessageResource {
            resource_type: "image".to_owned(),
            filename: Some("group_pic.png".to_owned()),
            size: Some(17),
            url: None,
            local_path: Some(source_image.to_string_lossy().into_owned()),
            width: None,
            height: None,
            duration: None,
        },
    ];
    let mut resource_map = HashMap::new();
    resource_map.insert("msg_1".to_owned(), resources);
    let options = ExportOptions {
        output_path,
        resource_map,
        ..ExportOptions::default()
    };
    JsonExporter::new(options, JsonFormatOptions::default())
        .export(Vec::new(), &chat_info())
        .await
        .expect("json export");

    assert_eq!(
        fs::read(output_dir.join("resources/files/group_doc.pdf")).expect("copied file"),
        b"PDF-DATA-FOR-TEST"
    );
    assert_eq!(
        fs::read(output_dir.join("resources/images/group_pic.png")).expect("copied image"),
        b"PNG-DATA-FOR-TEST"
    );
}

#[test]
fn reply_render_helpers_cover_legacy_fields_and_timestamps() {
    let input = ReplyRenderInput {
        referenced_message_id: Some("7000000001".to_owned()),
        reply_msg_id: Some("7000000002".to_owned()),
        msg_id: Some("7000000003".to_owned()),
        timestamp: Some(json!(1_718_454_840)),
        time: None,
    };
    assert_eq!(
        choose_reply_jump_target(&input),
        Some("7000000001".to_owned())
    );
    assert_eq!(
        format_reply_timestamp(input.timestamp.as_ref()),
        "06-15 12:34"
    );
    assert_eq!(
        pick_reply_render_hints(&input),
        (Some("7000000001".to_owned()), "06-15 12:34".to_owned())
    );

    let empty = ReplyRenderInput {
        referenced_message_id: Some("0".to_owned()),
        reply_msg_id: Some(String::new()),
        msg_id: Some("   ".to_owned()),
        ..ReplyRenderInput::default()
    };
    assert_eq!(choose_reply_jump_target(&empty), None);
    assert_eq!(format_reply_timestamp(Some(&json!("not a date"))), "");

    let legacy = ReplyRenderInput {
        reply_msg_id: Some("7000000002".to_owned()),
        timestamp: Some(json!(1_718_454_840_000_i64)),
        ..ReplyRenderInput::default()
    };
    assert_eq!(
        choose_reply_jump_target(&legacy),
        Some("7000000002".to_owned())
    );
    assert_eq!(
        format_reply_timestamp(legacy.timestamp.as_ref()),
        "06-15 12:34"
    );
    assert_eq!(
        format_reply_timestamp(Some(&json!("1718454840"))),
        "06-15 12:34"
    );
    assert_eq!(
        format_reply_timestamp(Some(&json!("2024-06-15T12:34:00Z"))),
        "06-15 12:34"
    );

    let message_id_only = ReplyRenderInput::from_value(&json!({
        "messageId": "7000000004"
    }));
    assert_eq!(
        choose_reply_jump_target(&message_id_only),
        Some("7000000004".to_owned())
    );

    let time_fallback = ReplyRenderInput {
        msg_id: Some("7000000003".to_owned()),
        time: Some(json!("2024-06-15T12:34:00Z")),
        ..ReplyRenderInput::default()
    };
    assert_eq!(
        pick_reply_render_hints(&time_fallback),
        (Some("7000000003".to_owned()), "06-15 12:34".to_owned())
    );

    let parsed = ReplyRenderInput::from_value(&json!({
        "referencedMessageId": 7_000_000_004_i64,
        "timestamp": 1_718_454_840
    }));
    assert_eq!(
        choose_reply_jump_target(&parsed),
        Some("7000000004".to_owned())
    );
}

#[test]
fn reply_preview_renderer_uses_data_uris_and_safe_fallbacks() {
    let lookup = |kind: &str, name: &str| {
        (kind == "images" && name == "abc.jpg").then(|| "data:image/jpeg;base64,Zm9v".to_owned())
    };
    let face_name = |id: &str| match id {
        "0" => "/微笑".to_owned(),
        _ => format!("/表情{id}"),
    };
    let context = ReplyPreviewRenderContext {
        resource_base_href: "resources",
        lookup_data_uri: &lookup,
        get_face_name: &face_name,
    };

    let image = render_reply_preview_element(
        &json!({ "type": "image", "localPath": "images/abc.jpg" }),
        &context,
    );
    assert!(image.contains("src=\"data:image/jpeg;base64,Zm9v\""));
    assert!(!image.contains("resources/"));

    let fallback = render_reply_preview_element(
        &json!({
            "type": "image",
            "originUrl": "https://example.test/a&quot;.jpg"
        }),
        &context,
    );
    assert!(fallback.contains("onerror="));
    assert!(fallback.contains("&amp;quot;"));

    let combined = render_reply_preview_elements(
        &[
            json!({ "type": "face", "faceIndex": 0 }),
            json!({ "type": "file", "fileName": "report.pdf" }),
        ],
        &context,
    );
    assert!(combined.contains("/微笑"));
    assert!(combined.contains("report.pdf"));

    let relative_image = render_reply_preview_element(
        &json!({ "type": "image", "localPath": "images/other.jpg" }),
        &context,
    );
    assert!(relative_image.contains("src=\"resources/images/other.jpg\""));

    let missing_image = render_reply_preview_element(&json!({ "type": "image" }), &context);
    assert_eq!(missing_image, "[图片]");

    let market_face = render_reply_preview_element(
        &json!({
            "type": "marketFace",
            "url": "https://example.test/face.png",
            "faceName": "wave"
        }),
        &context,
    );
    assert!(market_face.contains("reply-content-emoji"));
    assert!(market_face.contains("alt=\"wave\""));
    assert_eq!(
        render_reply_preview_element(
            &json!({ "type": "marketFace", "text": "[sticker]" }),
            &context,
        ),
        "[sticker]"
    );

    let attachments = render_reply_preview_elements(
        &[
            json!({ "type": "video", "fileName": "clip.mp4" }),
            json!({ "type": "audio", "text": "voice" }),
            json!({ "type": "text", "text": "<hello>" }),
            json!({ "type": "unknown", "text": "&fallback" }),
            Value::Null,
        ],
        &context,
    );
    assert!(attachments.contains("clip.mp4"));
    assert!(attachments.contains("voice"));
    assert!(attachments.contains("&lt;hello&gt;"));
    assert!(attachments.contains("&amp;fallback"));
}

#[test]
fn modern_html_styles_titles_as_badges_and_replies_with_hover_metadata() {
    let css = include_str!("../assets/modern_css.css");
    let scripts = include_str!("../assets/modern_single_scripts.html");
    assert!(css.contains(
        ".sender-title {\n            display: inline-flex;\n            align-items: center;"
    ));
    assert!(css.contains(".qce-hide-group-member-titles .sender-title"));
    assert!(css.contains(
        "background: var(--bg-secondary);\n            border: 0;\n            padding: 1px 5px;\n            border-radius: 6px;\n            margin-right: 0;"
    ));
    assert!(css.contains(
        ".reply-content {\n            background: transparent;\n            border: 0;\n            padding: 0;"
    ));
    assert!(
        css.contains(".reply-content-icon {\n            width: 15px;\n            height: 15px;")
    );
    assert!(css.contains(
        ".reply-content-time {\n            display: inline-block;\n            width: 90px;\n            opacity: 0;"
    ));
    assert!(css.contains(
        ".reply-content:hover .reply-content-time,\n        .reply-content:focus-visible .reply-content-time {\n            opacity: 1;"
    ));
    assert!(css.contains("40% { box-shadow: inset 0 0 0 999px rgba(0, 0, 0, 0.14); }"));
    assert!(scripts.contains("window.addEventListener('scrollend'"));
    assert!(scripts.contains("setTimeout(highlightBubble, 450)"));
    assert!(scripts.contains("targetMsg.querySelector('.message-bubble')"));
    assert!(!css.contains("border-top: 1px solid color-mix"));
}

fn hex_bytes(input: &str) -> Vec<u8> {
    let compact: String = input
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect();
    compact
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            u8::from_str_radix(std::str::from_utf8(pair).expect("hex pair"), 16).expect("hex byte")
        })
        .collect()
}
