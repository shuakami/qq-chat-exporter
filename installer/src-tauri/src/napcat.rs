//! NapCat WebUI automation.
//!
//! The installer pre-writes `config/webui.json` with a known token, so once
//! NapCat is up we authenticate against its loopback WebUI REST API and drive
//! the quick-login / QR flow without the user ever seeing a console.
//!
//! NapCat may auto-increment the port when the configured one is already in
//! use, so the first API call probes ports 6099-6120 to find the live instance.

use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::state::AppState;
use crate::util::NAPCAT_WEBUI_PORT;

fn base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .user_agent("qce-installer")
        .build()
        .expect("reqwest client")
}

/// Pull the WebUI token stored during install.
fn token(state: &State<'_, AppState>) -> Result<String, String> {
    state
        .0
        .lock()
        .map_err(|_| "state poisoned".to_string())?
        .webui_token
        .clone()
        .ok_or_else(|| "尚未初始化 WebUI 令牌（请先完成安装）".to_string())
}

fn log(state: &State<'_, AppState>, msg: &str) {
    if let Some(dir) = state.0.lock().ok().and_then(|s| s.install_dir()) {
        crate::util::installer_log(&dir, msg);
    }
}

fn cached_credential(state: &State<'_, AppState>) -> Option<(String, u16)> {
    let inner = state.0.lock().ok()?;
    let cred = inner.credential.clone()?;
    let port = inner.webui_port?;
    Some((cred, port))
}

fn store_credential(state: &State<'_, AppState>, cred: &str, port: u16) {
    if let Ok(mut s) = state.0.lock() {
        s.credential = Some(cred.to_string());
        s.webui_port = Some(port);
    }
}

/// Drop the cached credential/port so the next call re-probes ports and
/// re-authenticates. Needed whenever NapCat restarts: the old port may be
/// gone (connection error) or the old credential rejected (Unauthorized).
fn invalidate_credential(state: &State<'_, AppState>) {
    if let Ok(mut s) = state.0.lock() {
        s.credential = None;
        s.webui_port = None;
    }
}

/// NapCat's WebUI expects `sha256(token + ".napcat")` as the login hash
/// (see AuthHelper.generatePasswordHash in napcat-webui-backend).
fn password_hash(token: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hasher.update(b".napcat");
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Token as currently stored on disk (`config/webui.json`).
fn token_from_config(state: &State<'_, AppState>) -> Option<String> {
    let dir = state.0.lock().ok()?.install_dir()?;
    let raw = std::fs::read(dir.join("config").join("webui.json")).ok()?;
    let json: Value = serde_json::from_slice(&raw).ok()?;
    json.get("token").and_then(Value::as_str).map(str::to_string)
}

async fn try_login_on(port: u16, tok: &str) -> Result<String, String> {
    let resp = client()
        .post(format!("{}/api/auth/login", base_url(port)))
        .json(&serde_json::json!({ "hash": password_hash(tok) }))
        .send()
        .await
        .map_err(|e| format!("连接 NapCat WebUI 失败：{e}"))?;
    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    body.pointer("/data/Credential")
        .or_else(|| body.pointer("/data/credential"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            let msg = body
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("未返回凭证");
            format!("WebUI 登录失败：{msg}")
        })
}

/// Probe ports starting from NAPCAT_WEBUI_PORT to find the live NapCat
/// instance, authenticate, and cache the credential + actual port.
async fn ensure_login(state: &State<'_, AppState>) -> Result<(String, u16), String> {
    if let Some((c, p)) = cached_credential(state) {
        return Ok((c, p));
    }

    let tok = token(state)?;
    let disk_tok = token_from_config(state);

    let tokens: Vec<&str> = if let Some(ref dt) = disk_tok {
        if *dt != tok { vec![&tok, dt] } else { vec![&tok] }
    } else {
        vec![&tok]
    };

    // Probe the configured port first, then a range above it.
    let mut last_err = String::from("NapCat WebUI 未响应");
    for port in NAPCAT_WEBUI_PORT..NAPCAT_WEBUI_PORT + 20 {
        for t in &tokens {
            match try_login_on(port, t).await {
                Ok(cred) => {
                    // Sync in-memory token if disk token won.
                    if *t != tok {
                        if let Ok(mut s) = state.0.lock() {
                            s.webui_token = Some(t.to_string());
                        }
                    }
                    store_credential(state, &cred, port);
                    log(state, &format!("WebUI login ok on port {port}"));
                    return Ok((cred, port));
                }
                Err(e) => {
                    // Connection refused → port not serving, skip remaining tokens.
                    if e.contains("connect") || e.contains("Connect") {
                        break;
                    }
                    last_err = e;
                }
            }
        }
    }
    log(state, &format!("WebUI login failed on all ports: {last_err}"));
    Err(last_err)
}

async fn send_once(
    state: &State<'_, AppState>,
    path: &str,
    body: Option<&Value>,
) -> Result<Value, String> {
    let (cred, port) = ensure_login(state).await?;
    let url = format!("{}{}", base_url(port), path);
    let req = match body {
        Some(b) => client().post(&url).bearer_auth(&cred).json(b),
        None => client().get(&url).bearer_auth(&cred),
    };
    let resp = req.send().await.map_err(|e| e.to_string())?;
    resp.json().await.map_err(|e| e.to_string())
}

/// Single entry point for WebUI API calls. NapCat restarts whenever a login
/// attempt fails or QQ relaunches, which kills the port we cached and voids
/// the credential — so on a connection error or an `Unauthorized` reply we
/// invalidate the cache and retry once against a freshly probed instance.
async fn request(
    state: &State<'_, AppState>,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let mut retried = false;
    loop {
        match send_once(state, path, body.as_ref()).await {
            Ok(v) => {
                let unauthorized = v
                    .get("message")
                    .and_then(Value::as_str)
                    .map(|m| m.eq_ignore_ascii_case("unauthorized"))
                    .unwrap_or(false);
                if unauthorized && !retried {
                    log(state, &format!("{path}: credential rejected, re-authenticating"));
                    invalidate_credential(state);
                    retried = true;
                    continue;
                }
                return Ok(v);
            }
            Err(e) if !retried => {
                log(state, &format!("{path}: request failed ({e}), re-probing NapCat"));
                invalidate_credential(state);
                retried = true;
            }
            Err(e) => {
                log(state, &format!("{path}: request failed after retry ({e})"));
                return Err(e);
            }
        }
    }
}

async fn get_json(state: &State<'_, AppState>, path: &str) -> Result<Value, String> {
    request(state, path, None).await
}

async fn post_json(state: &State<'_, AppState>, path: &str, body: Value) -> Result<Value, String> {
    request(state, path, Some(body)).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickLoginAccount {
    pub uin: String,
    pub nick_name: String,
    pub face_url: String,
    pub is_quick_login: bool,
}

#[derive(Serialize)]
pub struct LoginResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn str_field<'a>(obj: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| obj.get(*k).and_then(Value::as_str))
}

#[tauri::command]
pub async fn napcat_quick_login_list(
    state: State<'_, AppState>,
) -> Result<Vec<QuickLoginAccount>, String> {
    // Newer NapCat exposes GetQuickLoginListNew; fall back to the old name.
    let body = match get_json(&state, "/api/QQLogin/GetQuickLoginListNew").await {
        Ok(v) if v.get("data").map(|d| !d.is_null()).unwrap_or(false) => v,
        _ => get_json(&state, "/api/QQLogin/GetQuickLoginList").await?,
    };
    // Auth/API failure must surface as an error so the UI keeps retrying
    // instead of rendering an empty account list.
    if body.get("code").and_then(Value::as_i64).unwrap_or(-1) != 0 {
        let msg = body
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("获取快速登录列表失败")
            .to_string();
        log(&state, &format!("quick_login_list failed: {msg}"));
        return Err(msg);
    }
    let arr = body
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut out = Vec::new();
    for item in arr {
        // Old API returns bare uin strings; new API returns objects.
        if let Some(uin) = item.as_str() {
            out.push(QuickLoginAccount {
                uin: uin.to_string(),
                nick_name: uin.to_string(),
                face_url: String::new(),
                is_quick_login: true,
            });
            continue;
        }
        let uin = str_field(&item, &["uin", "qq", "account"]).unwrap_or("").to_string();
        if uin.is_empty() {
            continue;
        }
        out.push(QuickLoginAccount {
            nick_name: str_field(&item, &["nickName", "nick", "nickname"])
                .unwrap_or(&uin)
                .to_string(),
            face_url: str_field(&item, &["faceUrl", "avatarUrl", "avatar"])
                .unwrap_or("")
                .to_string(),
            is_quick_login: item
                .get("isQuickLogin")
                .and_then(Value::as_bool)
                .unwrap_or(true),
            uin,
        });
    }
    Ok(out)
}

/// Whether the requested account is currently logged in (desktop QQ online).
/// Used to decide whether the Shell package must kill QQ first.
#[tauri::command]
pub async fn napcat_is_online(state: State<'_, AppState>, uin: String) -> Result<bool, String> {
    let body = post_json(&state, "/api/QQLogin/CheckLoginStatus", serde_json::json!({})).await?;
    let data = body.get("data").unwrap_or(&body);
    let is_login = data
        .get("isLogin")
        .or_else(|| data.get("online"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let online_uin = str_field(data, &["uin", "qq", "account"]).unwrap_or("");
    Ok(is_login && (online_uin.is_empty() || online_uin == uin))
}

#[tauri::command]
pub async fn napcat_quick_login(
    state: State<'_, AppState>,
    uin: String,
) -> Result<LoginResult, String> {
    log(&state, &format!("quick login requested for {uin}"));
    let body = post_json(
        &state,
        "/api/QQLogin/SetQuickLogin",
        serde_json::json!({ "uin": uin }),
    )
    .await?;
    let code = body.get("code").and_then(Value::as_i64).unwrap_or(-1);
    if code == 0 {
        log(&state, &format!("quick login accepted for {uin}"));
        Ok(LoginResult { ok: true, error: None })
    } else {
        log(
            &state,
            &format!(
                "quick login rejected for {uin}: {}",
                body.get("message").and_then(Value::as_str).unwrap_or("?")
            ),
        );
        Ok(LoginResult {
            ok: false,
            error: Some(
                body.get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("快速登录失败")
                    .to_string(),
            ),
        })
    }
}

/// Fetch the current QR-login URL from NapCat and render it to a PNG data URL.
#[tauri::command]
pub async fn napcat_qrcode(state: State<'_, AppState>) -> Result<String, String> {
    // GetQQLoginQrcode returns { data: { qrcode } }; fall back to the URL
    // included in CheckLoginStatus if the dedicated endpoint has no code yet.
    if let Ok(body) = post_json(&state, "/api/QQLogin/GetQQLoginQrcode", serde_json::json!({})).await {
        let data = body.get("data").unwrap_or(&body);
        if let Some(qr) = str_field(data, &["qrcode", "qrcodeurl", "qrcodeUrl", "url"]) {
            return render_qr_png(qr);
        }
    }
    let body = post_json(&state, "/api/QQLogin/CheckLoginStatus", serde_json::json!({})).await?;
    let data = body.get("data").unwrap_or(&body);
    let qr = str_field(data, &["qrcodeurl", "qrcodeUrl", "qrcode", "url"])
        .ok_or_else(|| "NapCat 尚未生成登录二维码".to_string())?;
    render_qr_png(qr)
}

/// Poll whether login has completed (QR scanned or quick login done).
#[tauri::command]
pub async fn napcat_login_status(state: State<'_, AppState>) -> Result<bool, String> {
    let body = post_json(&state, "/api/QQLogin/CheckLoginStatus", serde_json::json!({})).await?;
    let data = body.get("data").unwrap_or(&body);
    Ok(data
        .get("isLogin")
        .or_else(|| data.get("online"))
        .and_then(Value::as_bool)
        .unwrap_or(false))
}

/// Terminate any running desktop QQ so the Shell package can take over.
#[tauri::command]
pub fn kill_qq() -> Result<(), String> {
    #[cfg(windows)]
    {
        for image in ["QQ.exe", "QQmusic.exe"] {
            let _ = crate::util::hidden_command("taskkill")
                .args(["/IM", image, "/F", "/T"])
                .status();
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("pkill").arg("-f").arg("QQ").status();
        Ok(())
    }
}

fn render_qr_png(content: &str) -> Result<String, String> {
    use image::{ImageEncoder, ImageFormat};
    use qrcode::QrCode;

    let code = QrCode::new(content.as_bytes()).map_err(|e| e.to_string())?;
    let img = code
        .render::<image::Luma<u8>>()
        .min_dimensions(256, 256)
        .build();
    let mut buf: Vec<u8> = Vec::new();
    {
        let encoder = image::codecs::png::PngEncoder::new(&mut buf);
        encoder
            .write_image(
                img.as_raw(),
                img.width(),
                img.height(),
                image::ExtendedColorType::L8,
            )
            .map_err(|e| e.to_string())?;
    }
    let _ = ImageFormat::Png;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    Ok(format!("data:image/png;base64,{b64}"))
}
