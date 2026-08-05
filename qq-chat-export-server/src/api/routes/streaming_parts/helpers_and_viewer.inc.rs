async fn configure_skip_types(state: &SharedState, options: &Value) {
    let mut types: Vec<String> = options
        .get("skipDownloadResourceTypes")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_ascii_lowercase)
                .filter(|value| matches!(value.as_str(), "image" | "video" | "audio" | "file"))
                .collect()
        })
        .unwrap_or_default();
    if options.get("skipFileDownload").and_then(Value::as_bool) == Some(true)
        && !types.iter().any(|value| value == "file")
    {
        types.push("file".to_string());
    }
    if types.is_empty() {
        state.resource_handler.set_skip_download_types(None).await;
    } else {
        state
            .resource_handler
            .set_skip_download_types(Some(&types))
            .await;
    }
}

fn add_summary(target: &mut ResourceBatchSummary, source: ResourceBatchSummary) {
    target.attempted += source.attempted;
    target.already_available += source.already_available;
    target.downloaded += source.downloaded;
    target.failed += source.failed;
    target.skipped += source.skipped;
    for sample in source.failed_samples {
        if target.failed_samples.len() >= 5 {
            break;
        }
        target.failed_samples.push(sample);
    }
}

fn collect_local_paths(value: &Value, output: &mut HashSet<String>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_local_paths(item, output);
            }
        }
        Value::Object(object) => {
            if let Some(path) = object.get("localPath").and_then(Value::as_str) {
                if !path.is_empty() {
                    output.insert(path.to_string());
                }
            }
            for item in object.values() {
                collect_local_paths(item, output);
            }
        }
        _ => {}
    }
}

fn replace_local_paths(value: &mut Value, replacements: &HashMap<String, String>) {
    match value {
        Value::Array(items) => {
            for item in items {
                replace_local_paths(item, replacements);
            }
        }
        Value::Object(object) => {
            if let Some(path) = object.get_mut("localPath") {
                if let Some(replacement) = path
                    .as_str()
                    .and_then(|source| replacements.get(source))
                    .cloned()
                {
                    *path = Value::String(replacement);
                }
            }
            for item in object.values_mut() {
                replace_local_paths(item, replacements);
            }
        }
        _ => {}
    }
}

fn zip_directory(source: &Path, destination: &Path) -> Result<(), String> {
    let file =
        std::fs::File::create(destination).map_err(|error| format!("创建 ZIP 失败: {error}"))?;
    let mut archive = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for entry in walkdir::WalkDir::new(source)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
    {
        let relative = entry
            .path()
            .strip_prefix(source)
            .map_err(|error| format!("计算 ZIP 路径失败: {error}"))?;
        archive
            .start_file(relative.to_string_lossy().replace('\\', "/"), options)
            .map_err(|error| format!("写入 ZIP 条目失败: {error}"))?;
        let mut input = std::fs::File::open(entry.path())
            .map_err(|error| format!("读取 ZIP 条目失败: {error}"))?;
        std::io::copy(&mut input, &mut archive)
            .map_err(|error| format!("复制 ZIP 条目失败: {error}"))?;
    }
    archive
        .finish()
        .map_err(|error| format!("完成 ZIP 失败: {error}"))?;
    Ok(())
}

async fn path_size(path: &Path) -> u64 {
    match tokio::fs::metadata(path).await {
        Ok(metadata) if metadata.is_file() => metadata.len(),
        Ok(metadata) if metadata.is_dir() => {
            let path = path.to_path_buf();
            tokio::task::spawn_blocking(move || {
                walkdir::WalkDir::new(path)
                    .into_iter()
                    .filter_map(Result::ok)
                    .filter(|entry| entry.file_type().is_file())
                    .filter_map(|entry| entry.metadata().ok())
                    .map(|metadata| metadata.len())
                    .sum()
            })
            .await
            .unwrap_or(0)
        }
        _ => 0,
    }
}

fn resource_summary_message(summary: &ResourceBatchSummary) -> String {
    if summary.attempted == 0 {
        return "导出完成（磁盘流式模式）".to_string();
    }
    let available = summary.already_available + summary.downloaded;
    format!(
        "导出完成（磁盘流式模式） · 资源 {available}/{}，失败 {}，跳过 {}",
        summary.attempted, summary.failed, summary.skipped,
    )
}

fn readable_stem(session_name: &str, peer_identity: &str, task_id: &str) -> String {
    let session = sanitize_component(session_name);
    let peer = sanitize_component(peer_identity);
    let suffix = task_id.rsplit('_').next().unwrap_or("task");
    format!("{}_{}_{}", session, peer, suffix)
}

fn sanitize_component(value: &str) -> String {
    let result: String = value
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .take(64)
        .collect();
    let trimmed = result.trim_matches([' ', '.', '_']);
    if trimmed.is_empty() {
        "chat".to_string()
    } else {
        trimmed.to_string()
    }
}

fn download_url(path: &Path, custom_output_dir: &str) -> String {
    if custom_output_dir.is_empty() {
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        format!("/downloads/{name}")
    } else {
        let path_string = path.to_string_lossy().into_owned();
        let encoded =
            percent_encoding::utf8_percent_encode(&path_string, percent_encoding::NON_ALPHANUMERIC);
        format!("/api/download-file?path={encoded}")
    }
}

fn raw_message_time(message: &Value) -> i64 {
    normalize_ms(loose_i64(message.get("msgTime")).unwrap_or(0))
}

fn normalize_ms(value: i64) -> i64 {
    if value > 1_000_000_000 && value < 10_000_000_000 {
        value * 1_000
    } else {
        value
    }
}

fn loose_i64(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(value)) => value.as_i64(),
        Some(Value::String(value)) => value.parse().ok(),
        _ => None,
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn viewer_html() -> &'static str {
    r#"<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QCE 磁盘流式聊天记录</title>
<style>
:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:#f5f5f7;color:#1d1d1f}.shell{max-width:960px;margin:auto;min-height:100vh;background:#fff}.top{position:sticky;top:0;z-index:2;background:rgba(255,255,255,.92);backdrop-filter:blur(18px);border-bottom:1px solid #ddd;padding:14px 18px}.title{font-size:17px;font-weight:650}.meta{font-size:12px;color:#777;margin-top:3px}.controls{display:flex;gap:8px;margin-top:10px;align-items:center}.controls button,.controls input{border:1px solid #d2d2d7;border-radius:9px;background:#fff;padding:7px 10px;color:inherit}.controls button:disabled{opacity:.35}.controls input{min-width:0;flex:1}.messages{padding:18px}.message{display:flex;gap:11px;margin:0 0 18px}.avatar{width:34px;height:34px;border-radius:50%;background:#e5e5ea;display:flex;align-items:center;justify-content:center;flex:none;font-size:13px}.body{min-width:0;max-width:82%}.sender{font-size:12px;color:#777;margin:0 0 4px}.bubble{background:#f2f2f7;border-radius:14px;padding:9px 12px;line-height:1.55;overflow-wrap:anywhere}.message.self{justify-content:flex-end}.message.self .avatar{order:2}.message.self .body{order:1}.message.self .bubble{background:#d9fdd3}.resource{display:block;max-width:min(520px,100%);margin-top:8px;border-radius:10px}.file{display:inline-block;margin-top:8px}.empty{text-align:center;color:#888;padding:60px 0}.status{text-align:center;color:#777;padding:12px;font-size:12px}@media(prefers-color-scheme:dark){body{background:#111;color:#f5f5f7}.shell{background:#1c1c1e}.top{background:rgba(28,28,30,.92);border-color:#38383a}.bubble{background:#2c2c2e}.message.self .bubble{background:#234a2a}.controls button,.controls input{background:#2c2c2e;border-color:#48484a}}
</style>
</head>
<body><div class="shell"><header class="top"><div class="title" id="title">聊天记录</div><div class="meta" id="meta">读取清单…</div><div class="controls"><button id="prev">上一批</button><input id="jump" type="number" min="1" value="1" aria-label="分块编号"><button id="go">跳转</button><button id="next">下一批</button></div></header><main class="messages" id="messages"></main><div class="status" id="status"></div></div>
<script>window.__QCE_DISK_CHUNK__=(i,d)=>{window.__qceChunk={i,d};window.dispatchEvent(new Event('qcechunk'))}</script>
<script src="data/manifest.js"></script>
<script>
(()=>{const m=window.__QCE_DISK_MANIFEST__,box=document.getElementById('messages'),status=document.getElementById('status'),jump=document.getElementById('jump');let current=1,token=0;const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const self=x=>{const c=m.chat||{};return (c.selfUid&&x.sender?.uid===c.selfUid)||(c.selfUin&&x.sender?.uin===c.selfUin)};const resource=r=>{const src=esc(r.localPath||r.url||'');if(!src)return'';if(r.type==='image')return `<img class="resource" loading="lazy" src="${src}" alt="${esc(r.filename||'图片')}">`;if(r.type==='video')return `<video class="resource" controls src="${src}"></video>`;if(r.type==='audio')return `<audio class="resource" controls src="${src}"></audio>`;return `<a class="file" href="${src}">${esc(r.filename||'文件')}</a>`};const render=x=>{const name=x.sender?.name||x.sender?.nickname||x.sender?.uin||'未知';const body=x.content?.html||esc(x.content?.text||'').replace(/\n/g,'<br>');const rs=(x.content?.resources||[]).map(resource).join('');return `<article class="message ${self(x)?'self':''}" id="msg-${esc(x.id)}"><div class="avatar">${esc(name.slice(0,1))}</div><div class="body"><div class="sender">${esc(name)} · ${esc(x.time||new Date(x.timestamp||0).toLocaleString())}${x.recalled?' · 已撤回':''}</div><div class="bubble">${body||'<span style="color:#888">[非文本消息]</span>'}${rs}</div></div></article>`};const update=()=>{document.getElementById('title').textContent=m.chat?.name||'聊天记录';document.getElementById('meta').textContent=`共 ${Number(m.messageCount||0).toLocaleString()} 条 · ${m.chunkCount||0} 个磁盘分块 · 当前 ${current}/${m.chunkCount||0}`;document.getElementById('prev').disabled=current<=1;document.getElementById('next').disabled=current>=m.chunkCount;jump.max=m.chunkCount;jump.value=current};const load=n=>{if(!m||n<1||n>m.chunkCount)return;current=n;update();box.innerHTML='<div class="empty">正在读取当前分块…</div>';status.textContent='浏览器一次只加载一个分块，避免超大记录占满内存';const t=++token;const s=document.createElement('script');s.src=m.chunks[n-1].file;s.onload=()=>{if(t!==token)return;const d=window.__qceChunk?.d||[];box.innerHTML=d.length?d.map(render).join(''):'<div class="empty">这一批没有可显示消息</div>';window.scrollTo({top:0});s.remove()};s.onerror=()=>{box.innerHTML='<div class="empty">分块读取失败，请确认 ZIP 已完整解压</div>';s.remove()};document.body.appendChild(s)};document.getElementById('prev').onclick=()=>load(current-1);document.getElementById('next').onclick=()=>load(current+1);document.getElementById('go').onclick=()=>load(Math.max(1,Math.min(m.chunkCount,Number(jump.value)||1)));if(!m){box.innerHTML='<div class="empty">清单读取失败，请完整解压后打开 index.html</div>';return}load(1)})();
</script></body></html>"#
}
