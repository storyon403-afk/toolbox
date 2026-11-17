use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Platform {
    Youtube,
    Douyin,
    Bilibili,
}
#[derive(Clone, Serialize)]
pub struct SharedLink {
    pub platform: Platform,
    pub url: UrlString,
}
/// Kept out of Debug output: share links may carry tracking identifiers.
#[derive(Clone, Serialize)]
#[serde(transparent)]
pub struct UrlString(String);
impl UrlString {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

pub fn parse_share(text: &str) -> Result<SharedLink> {
    if text.len() > 16_384 || text.contains('\0') {
        return Err(Error::Invalid("share text is too long or contains NUL"));
    }
    // Locate links even when a platform's share copy does not put a space before the URL.
    let mut starts: Vec<usize> = text
        .match_indices("https://")
        .chain(text.match_indices("http://"))
        .map(|(i, _)| i)
        .collect();
    starts.sort_unstable();
    if starts.len() > 1 {
        return Err(Error::AmbiguousSource);
    }
    let start = *starts.first().ok_or(Error::UnsupportedSource)?;
    let candidate = text[start..]
        .split(|c: char| c.is_whitespace() || "<>\"'，。；！？【】（）「」《》".contains(c))
        .next()
        .unwrap_or("")
        .trim_end_matches(['.', ',', ';', ')', ']', '}']);
    let mut url = Url::parse(candidate).map_err(|_| Error::UnsupportedSource)?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err(Error::UnsupportedSource);
    }
    let platform = match url.host_str().unwrap_or("") {
        "youtube.com" | "www.youtube.com" | "m.youtube.com" | "youtu.be" => Platform::Youtube,
        "douyin.com" | "www.douyin.com" | "v.douyin.com" => Platform::Douyin,
        "bilibili.com" | "www.bilibili.com" | "m.bilibili.com" | "b23.tv" => Platform::Bilibili,
        _ => return Err(Error::UnsupportedSource),
    };
    url.set_scheme("https")
        .map_err(|_| Error::UnsupportedSource)?;
    url.set_fragment(None);
    // Keep video/part selectors, but do not retain share tracking tokens in local manifests.
    let query: Vec<_> = url
        .query_pairs()
        .filter(|(k, _)| matches!(k.as_ref(), "v" | "p" | "modal_id"))
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    url.set_query(None);
    if !query.is_empty() {
        url.query_pairs_mut().extend_pairs(query);
    }
    Ok(SharedLink {
        platform,
        url: UrlString(url.to_string()),
    })
}
