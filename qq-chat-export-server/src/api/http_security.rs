use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::path::Path;
use std::time::Duration;

use bytes::{Bytes, BytesMut};
use futures_util::StreamExt;
use reqwest::header::LOCATION;
use reqwest::{redirect::Policy, Response, Url};
use tokio::io::AsyncWriteExt;

const MAX_REDIRECTS: usize = 3;
const DEFAULT_MEMORY_LIMIT: u64 = 32 * 1024 * 1024;

#[must_use]
fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
        || ip.is_multicast()
        || octets[0] == 0
        || octets[0] >= 240
        || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
        || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19)))
}

#[must_use]
fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();
    if let Some(mapped) = ip.to_ipv4_mapped() {
        return is_public_ipv4(mapped);
    }
    !(ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || (segments[0] & 0xfe00) == 0xfc00
        || (segments[0] & 0xffc0) == 0xfe80
        || (segments[0] == 0x2001 && segments[1] == 0x0db8))
}

#[must_use]
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_public_ipv4(ip),
        IpAddr::V6(ip) => is_public_ipv6(ip),
    }
}

fn validate_url(url: &Url) -> Option<(&str, u16)> {
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    let host = url.host_str()?;
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") {
        return None;
    }
    Some((host, url.port_or_known_default()?))
}

async fn resolved_public_address(url: &Url) -> Option<(String, SocketAddr)> {
    let (host, port) = validate_url(url)?;
    let addresses: Vec<SocketAddr> = tokio::net::lookup_host((host, port)).await.ok()?.collect();
    if addresses.is_empty() || addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return None;
    }
    Some((host.to_string(), addresses[0]))
}

async fn send_once(url: &Url) -> Option<Response> {
    let (host, address) = resolved_public_address(url).await?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .redirect(Policy::none())
        .no_proxy()
        .resolve(&host, address)
        .build()
        .ok()?;
    client.get(url.clone()).send().await.ok()
}

async fn safe_response(url: &str) -> Option<Response> {
    let mut current = Url::parse(url).ok()?;
    for redirect_count in 0..=MAX_REDIRECTS {
        let response = send_once(&current).await?;
        if response.status().is_redirection() {
            if redirect_count == MAX_REDIRECTS {
                return None;
            }
            let location = response.headers().get(LOCATION)?.to_str().ok()?;
            current = current.join(location).ok()?;
            continue;
        }
        return response.status().is_success().then_some(response);
    }
    None
}

async fn response_bytes(response: Response, max_bytes: u64) -> Option<Bytes> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes)
    {
        return None;
    }
    let mut stream = response.bytes_stream();
    let mut data = BytesMut::new();
    let mut total = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.ok()?;
        total = total.checked_add(u64::try_from(chunk.len()).ok()?)?;
        if total > max_bytes {
            return None;
        }
        data.extend_from_slice(&chunk);
    }
    Some(data.freeze())
}

pub async fn http_get_bytes(url: &str) -> Option<Bytes> {
    response_bytes(safe_response(url).await?, DEFAULT_MEMORY_LIMIT).await
}

pub async fn http_download_to_file(url: &str, destination: &Path, max_bytes: u64) -> bool {
    let Some(response) = safe_response(url).await else {
        return false;
    };
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes)
    {
        return false;
    }
    let temporary = destination.with_extension(format!(
        "{}.part-{}",
        destination
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("download"),
        uuid::Uuid::new_v4().simple()
    ));
    let Ok(mut file) = tokio::fs::File::create(&temporary).await else {
        return false;
    };
    let mut stream = response.bytes_stream();
    let mut total = 0u64;
    while let Some(chunk) = stream.next().await {
        let Ok(chunk) = chunk else {
            let _ = tokio::fs::remove_file(&temporary).await;
            return false;
        };
        let Some(next_total) = total.checked_add(u64::try_from(chunk.len()).unwrap_or(u64::MAX))
        else {
            let _ = tokio::fs::remove_file(&temporary).await;
            return false;
        };
        if next_total > max_bytes || file.write_all(&chunk).await.is_err() {
            let _ = tokio::fs::remove_file(&temporary).await;
            return false;
        }
        total = next_total;
    }
    if file.flush().await.is_err() || tokio::fs::rename(&temporary, destination).await.is_err() {
        let _ = tokio::fs::remove_file(&temporary).await;
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::{is_public_ip, validate_url};
    use reqwest::Url;
    use std::net::IpAddr;

    #[test]
    fn rejects_private_reserved_and_local_addresses() {
        for address in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.1.1",
            "100.64.0.1",
            "0.0.0.0",
            "::1",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(
                !is_public_ip(address.parse::<IpAddr>().expect("IP")),
                "{address}"
            );
        }
        for address in ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"] {
            assert!(
                is_public_ip(address.parse::<IpAddr>().expect("IP")),
                "{address}"
            );
        }
    }

    #[test]
    fn rejects_non_http_credentials_and_localhost_urls() {
        for invalid in [
            "file:///etc/passwd",
            "http://localhost/test",
            "http://sub.localhost/test",
            "http://user:pass@example.com/test",
        ] {
            let url = Url::parse(invalid).expect("URL");
            assert!(validate_url(&url).is_none(), "{invalid}");
        }
        let valid = Url::parse("https://example.com/image.png").expect("URL");
        assert!(validate_url(&valid).is_some());
    }
}
