const MARKET_FACE_BASE_URL: &str = "https://gxh.vip.qq.com/club/item/parcel/item";

#[must_use]
pub fn urls(emoji_id: &str) -> Option<(String, String)> {
    if emoji_id.len() < 2
        || !emoji_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return None;
    }
    let prefix: String = emoji_id.chars().take(2).collect();
    let base = format!("{MARKET_FACE_BASE_URL}/{prefix}/{emoji_id}/raw300");
    Some((format!("{base}.gif"), format!("{base}.png")))
}

#[must_use]
pub fn alternate_url(url: &str) -> Option<String> {
    let (path, query) = url
        .split_once('?')
        .map_or((url, None), |(path, query)| (path, Some(query)));
    let alternate = if let Some(base) = path.strip_suffix("/raw300.gif") {
        format!("{base}/raw300.png")
    } else if let Some(base) = path.strip_suffix("/raw300.png") {
        format!("{base}/raw300.gif")
    } else {
        return None;
    };
    Some(query.map_or(alternate.clone(), |query| format!("{alternate}?{query}")))
}

#[cfg(test)]
mod tests {
    use super::{alternate_url, urls};

    #[test]
    fn builds_gif_and_png_market_face_urls() {
        let (primary, fallback) = urls("abcdef").expect("valid emoji id");
        assert_eq!(
            primary,
            "https://gxh.vip.qq.com/club/item/parcel/item/ab/abcdef/raw300.gif"
        );
        assert_eq!(
            fallback,
            "https://gxh.vip.qq.com/club/item/parcel/item/ab/abcdef/raw300.png"
        );
        assert!(urls("a").is_none());
        assert!(urls("ab/cd").is_none());
        assert!(urls("ab'cd").is_none());
    }

    #[test]
    fn swaps_market_face_extensions_without_losing_query() {
        assert_eq!(
            alternate_url("https://example.com/raw300.gif?token=1").as_deref(),
            Some("https://example.com/raw300.png?token=1")
        );
        assert_eq!(
            alternate_url("https://example.com/raw300.png").as_deref(),
            Some("https://example.com/raw300.gif")
        );
        assert!(alternate_url("https://example.com/image.gif").is_none());
    }
}
