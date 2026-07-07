//! NapCat WebUI automation.
//!
//! The installer pre-writes `config/webui.json` with a known token, so once
//! NapCat is up we authenticate against its loopback WebUI REST API and drive
//! the quick-login / QR flow without the user ever seeing a console.
//!
//! Endpoint shapes follow NapCat's current WebUI API. Responses are parsed
//! defensively (tolerant of field-name variants across NapCat versions).

use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::state::AppState;
use crate::util::NAPCAT_WEBUI_PORT;

fn base() -> String {
    format!("http://127.0.0.1:{NAPCAT_WEBUI_PORT}")
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
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

fn cached_credential(state: &State<'_, AppState>) -> Option<String> {
    state.0.lock().ok().and_then(|s| s.credential.clone())
}

fn store_credential(state: &State<'_, AppState>, cred: &str) {
    if let Ok(mut s) = state.0.lock() {
        s.credential = Some(cred.to_string());
    }
}

/// Authenticate and return a bearer credential, caching it in state.
async fn ensure_login(state: &State<'_, AppState>) -> Result<String, String> {
    if let Some(c) = cached_credential(state) {
        return Ok(c);
    }
    let tok = token(state)?;
    let resp = client()
        .post(format!("{}/api/auth/login", base()))
        .json(&serde_json::json!({ "token": tok, "hash": tok }))
        .send()
        .await
        .map_err(|e| format!("连接 NapCat WebUI 失败：{e}"))?;
    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    let cred = body
        .pointer("/data/Credential")
        .or_else(|| body.pointer("/data/credential"))
        .and_then(Value::as_str)
        .or_else(|| body.get("data").and_then(Value::as_str))
        .ok_or_else(|| "WebUI 登录失败：未返回凭证".to_string())?
        .to_string();
    store_credential(state, &cred);
    Ok(cred)
}

async fn get_json(state: &State<'_, AppState>, path: &str) -> Result<Value, String> {
    let cred = ensure_login(state).await?;
    let resp = client()
        .get(format!("{}{}", base(), path))
        .bearer_auth(&cred)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.json().await.map_err(|e| e.to_string())
}

async fn post_json(state: &State<'_, AppState>, path: &str, body: Value) -> Result<Value, String> {
    let cred = ensure_login(state).await?;
    let resp = client()
        .post(format!("{}{}", base(), path))
        .bearer_auth(&cred)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.json().await.map_err(|e| e.to_string())
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
    let body = get_json(&state, "/api/QQLogin/CheckLoginStatus").await?;
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
    let body = post_json(
        &state,
        "/api/QQLogin/SetQuickLogin",
        serde_json::json!({ "uin": uin }),
    )
    .await?;
    let code = body.get("code").and_then(Value::as_i64).unwrap_or(-1);
    if code == 0 {
        Ok(LoginResult { ok: true, error: None })
    } else {
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
    let body = get_json(&state, "/api/QQLogin/CheckLoginStatus").await?;
    let data = body.get("data").unwrap_or(&body);
    let qr = str_field(data, &["qrcodeurl", "qrcodeUrl", "qrcode", "url"])
        .ok_or_else(|| "NapCat 尚未生成登录二维码".to_string())?;
    render_qr_png(qr)
}

/// Poll whether login has completed (QR scanned or quick login done).
#[tauri::command]
pub async fn napcat_login_status(state: State<'_, AppState>) -> Result<bool, String> {
    let body = get_json(&state, "/api/QQLogin/CheckLoginStatus").await?;
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
