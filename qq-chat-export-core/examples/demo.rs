use chrono::TimeZone;
use qce_exporter::excel_exporter::{ExcelExporter, ExcelFormatOptions};
use qce_exporter::html_exporter::{HtmlExporter, HtmlFormatOptions};
use qce_exporter::json_exporter::{JsonExporter, JsonFormatOptions};
use qce_exporter::modern_html_exporter::{
    ChunkedHtmlExportOptions, HtmlExportOptions, ModernHtmlExporter,
};
use qce_exporter::text_exporter::{TextExporter, TextFormatOptions};
use qce_exporter::types::{
    ChatInfo, CleanMessage, ExportOptions, MessageContent, MessageElement, Sender,
};
use serde_json::json;
use std::path::PathBuf;

fn sender(uid: &str, uin: &str, name: &str, title: Option<&str>) -> Sender {
    Sender {
        uid: uid.to_owned(),
        uin: Some(uin.to_owned()),
        name: name.to_owned(),
        nickname: Some(name.to_owned()),
        group_card: None,
        remark: None,
        title: title.map(str::to_owned),
        avatar_base64: None,
    }
}

fn msg(
    id: u64,
    ts: i64,
    s: Sender,
    text: &str,
    elements: Vec<MessageElement>,
    system: bool,
) -> CleanMessage {
    let dt = chrono::Local.timestamp_millis_opt(ts).unwrap();
    CleanMessage {
        id: id.to_string(),
        seq: id.to_string(),
        timestamp: ts,
        time: dt.format("%Y-%m-%d %H:%M:%S").to_string(),
        sender: s,
        message_type: if system { "system".to_owned() } else { "normal".to_owned() },
        content: MessageContent {
            text: text.to_owned(),
            html: None,
            elements,
            resources: vec![],
            mentions: vec![],
        },
        recalled: false,
        system,
        raw_message: None,
    }
}

fn text_el(t: &str) -> MessageElement {
    MessageElement { element_type: "text".to_owned(), data: json!({ "text": t }) }
}

fn build_messages() -> Vec<CleanMessage> {
    let alice = || sender("u_alice", "10001", "Alice", Some("群主"));
    let bob = || sender("u_bob", "10002", "Bob", None);
    let carol = || sender("u_carol", "10003", "Carol", Some("活跃分子"));

    let base = chrono::Local
        .with_ymd_and_hms(2026, 7, 5, 9, 0, 0)
        .unwrap()
        .timestamp_millis();
    let mut out = Vec::new();
    let mut id = 7_000_000_000_000_000_000u64;
    let mut ts = base;
    #[allow(clippy::too_many_arguments)]
    fn push(
        out: &mut Vec<CleanMessage>,
        id: &mut u64,
        ts: &mut i64,
        s: Sender,
        text: &str,
        els: Vec<MessageElement>,
        system: bool,
        step_ms: i64,
    ) {
        *id += 1;
        *ts += step_ms;
        out.push(msg(*id, *ts, s, text, els, system));
    }

    push(&mut out, &mut id, &mut ts, alice(), "大家早上好！", vec![text_el("大家早上好！")], false, 0);
    push(
        &mut out,
        &mut id,
        &mut ts,
        bob(),
        "早～今天讨论 Rust 重构的事",
        vec![text_el("早～今天讨论 Rust 重构的事")],
        false,
        60_000,
    );
    push(
        &mut out,
        &mut id,
        &mut ts,
        carol(),
        "[表情]",
        vec![MessageElement { element_type: "face".to_owned(), data: json!({ "id": "21" }) }],
        false,
        30_000,
    );
    push(
        &mut out,
        &mut id,
        &mut ts,
        alice(),
        "看这张架构图",
        vec![
            text_el("看这张架构图 "),
            MessageElement {
                element_type: "image".to_owned(),
                data: json!({
                    "fileName": "arch.png",
                    "url": "https://raw.githubusercontent.com/shuakami/qq-chat-exporter/master/public/favicon.png",
                    "width": 640,
                    "height": 480
                }),
            },
        ],
        false,
        120_000,
    );
    let reply_target_id = id;
    push(
        &mut out,
        &mut id,
        &mut ts,
        bob(),
        "回复：收到",
        vec![
            MessageElement {
                element_type: "reply".to_owned(),
                data: json!({
                    "replyMsgId": reply_target_id.to_string(),
                    "senderName": "Alice",
                    "text": "看这张架构图",
                    "elements": [{ "type": "text", "data": { "text": "看这张架构图" } }]
                }),
            },
            text_el("收到，图看到了"),
        ],
        false,
        45_000,
    );
    push(
        &mut out,
        &mut id,
        &mut ts,
        carol(),
        "@Alice 排期表发我一下",
        vec![
            MessageElement {
                element_type: "at".to_owned(),
                data: json!({ "uid": "u_alice", "name": "Alice" }),
            },
            text_el(" 排期表发我一下"),
        ],
        false,
        90_000,
    );
    push(
        &mut out,
        &mut id,
        &mut ts,
        alice(),
        "[文件] plan.xlsx",
        vec![MessageElement {
            element_type: "file".to_owned(),
            data: json!({ "fileName": "plan.xlsx", "fileSize": 24576 }),
        }],
        false,
        60_000,
    );
    push(&mut out, &mut id, &mut ts, bob(), "撤回测试前的一条消息", vec![text_el("撤回测试前的一条消息")], false, 30_000);
    push(
        &mut out,
        &mut id,
        &mut ts,
        alice(),
        "Bob 加入了群聊",
        vec![MessageElement {
            element_type: "system".to_owned(),
            data: json!({ "text": "Bob 加入了群聊" }),
        }],
        true,
        30_000,
    );

    // 第二天：批量文本，验证日期分隔与统计
    ts = chrono::Local
        .with_ymd_and_hms(2026, 7, 6, 14, 30, 0)
        .unwrap()
        .timestamp_millis();
    for i in 0..80 {
        let s = match i % 3 {
            0 => alice(),
            1 => bob(),
            _ => carol(),
        };
        let t = format!("第二天的测试消息 #{i}：全文搜索关键词 tokio{}", i % 7);
        push(&mut out, &mut id, &mut ts, s, &t, vec![text_el(&t)], false, 20_000);
    }

    // 第三天：转发 + JSON 卡片 + 表情
    ts = chrono::Local
        .with_ymd_and_hms(2026, 7, 7, 10, 0, 0)
        .unwrap()
        .timestamp_millis();
    push(
        &mut out,
        &mut id,
        &mut ts,
        carol(),
        "[聊天记录]",
        vec![MessageElement {
            element_type: "forward".to_owned(),
            data: json!({
                "title": "群聊的聊天记录",
                "summary": "Alice: 大家早上好！",
                "messages": [
                    { "senderName": "Alice", "text": "大家早上好！", "time": "2026-07-05 09:00:00" },
                    { "senderName": "Bob", "text": "早～", "time": "2026-07-05 09:01:00" }
                ]
            }),
        }],
        false,
        3_600_000,
    );
    push(
        &mut out,
        &mut id,
        &mut ts,
        bob(),
        "[卡片消息]",
        vec![MessageElement {
            element_type: "json".to_owned(),
            data: json!({
                "data": "{\"prompt\":\"[QQ小程序] Rust 官网\",\"meta\":{\"detail_1\":{\"title\":\"Rust\",\"desc\":\"A language empowering everyone\",\"qqdocurl\":\"https://www.rust-lang.org\"}}}"
            }),
        }],
        false,
        60_000,
    );
    push(
        &mut out,
        &mut id,
        &mut ts,
        alice(),
        "收工！",
        vec![
            text_el("收工！"),
            MessageElement { element_type: "face".to_owned(), data: json!({ "id": "76" }) },
        ],
        false,
        120_000,
    );

    out
}

fn chat_info() -> ChatInfo {
    ChatInfo {
        name: "Rust 重构讨论组".to_owned(),
        chat_type: "group".to_owned(),
        avatar: None,
        participant_count: Some(3),
        self_uid: Some("u_alice".to_owned()),
        self_uin: Some("10001".to_owned()),
        self_name: Some("Alice".to_owned()),
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let out_dir = PathBuf::from("demo-output");
    tokio::fs::create_dir_all(&out_dir).await?;
    let messages = build_messages();
    let info = chat_info();
    println!("样例消息数: {}", messages.len());

    // 1. Text
    let opts = ExportOptions { output_path: out_dir.join("chat.txt"), ..Default::default() };
    let r = TextExporter::new(opts, TextFormatOptions::default())
        .export(messages.clone(), &info)
        .await?;
    println!("[TXT]        {} ({} bytes)", r.file_path.display(), r.file_size);

    // 2. JSON（单文件）
    let opts = ExportOptions { output_path: out_dir.join("chat.json"), ..Default::default() };
    let r = JsonExporter::new(opts, JsonFormatOptions::default())
        .export(messages.clone(), &info)
        .await?;
    println!("[JSON]       {} ({} bytes)", r.file_path.display(), r.file_size);

    // 3. JSON（chunked-jsonl）
    let opts = ExportOptions { output_path: out_dir.join("chat_chunked.json"), ..Default::default() };
    let json_opts = JsonFormatOptions {
        export_mode: qce_exporter::json_exporter::JsonExportMode::ChunkedJsonl,
        chunked_jsonl: qce_exporter::json_exporter::ChunkedJsonlExportOptions {
            max_messages_per_chunk: 40,
            ..Default::default()
        },
        ..Default::default()
    };
    let r = JsonExporter::new(opts, json_opts)
        .export(messages.clone(), &info)
        .await?;
    println!("[JSONL]      {} ({} bytes)", r.file_path.display(), r.file_size);

    // 4. HTML（表格式）
    let opts = ExportOptions { output_path: out_dir.join("chat_table.html"), ..Default::default() };
    let r = HtmlExporter::new(opts, HtmlFormatOptions::default())
        .export(messages.clone(), &info)
        .await?;
    println!("[HTML]       {} ({} bytes)", r.file_path.display(), r.file_size);

    // 5. Excel
    let opts = ExportOptions { output_path: out_dir.join("chat.xlsx"), ..Default::default() };
    let r = ExcelExporter::new(opts, ExcelFormatOptions::default())
        .export(messages.clone(), &info)
        .await?;
    println!("[XLSX]       {} ({} bytes)", r.file_path.display(), r.file_size);

    // 6. Modern HTML（单文件）
    let mut modern = ModernHtmlExporter::new(HtmlExportOptions {
        output_path: out_dir.join("chat_modern.html"),
        ..Default::default()
    });
    let copied = modern.export(&messages, &info).await?;
    println!("[MODERN]     {} (copied {} resources)", out_dir.join("chat_modern.html").display(), copied.len());

    // 6.5 Modern HTML（单文件内联 HyperScroll viewer）
    let mut modern = ModernHtmlExporter::new(HtmlExportOptions {
        output_path: out_dir.join("chat_modern_inline.html"),
        ..Default::default()
    });
    let copied = modern.export_single_inline(&messages, &info).await?;
    println!(
        "[MODERN-INL] {} (copied {} resources)",
        out_dir.join("chat_modern_inline.html").display(),
        copied.len()
    );

    // 7. Modern HTML（chunked viewer）
    let mut modern = ModernHtmlExporter::new(HtmlExportOptions {
        output_path: out_dir.join("modern_chunked/index.html"),
        ..Default::default()
    });
    let r = modern
        .export_chunked(
            &messages,
            &info,
            &ChunkedHtmlExportOptions {
                max_messages_per_chunk: Some(100),
                ..Default::default()
            },
        )
        .await?;
    println!(
        "[MODERN-CHK] {} ({} chunks, {} messages)",
        r.index_html_path.display(),
        r.chunk_count,
        r.total_messages
    );

    Ok(())
}
