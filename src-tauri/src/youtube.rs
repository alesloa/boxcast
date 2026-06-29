//! YouTube Data API v3 search.

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeItem {
    pub video_id: String,
    pub title: String,
    pub channel_title: String,
    pub thumbnail: String,
    pub published_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YoutubeResults {
    pub items: Vec<YoutubeItem>,
    pub next_page_token: Option<String>,
}

// --- Raw API shapes -------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YtResponse {
    #[serde(default)]
    items: Vec<YtItem>,
    #[serde(default)]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct YtItem {
    #[serde(default)]
    id: YtId,
    #[serde(default)]
    snippet: YtSnippet,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YtId {
    #[serde(default)]
    video_id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YtSnippet {
    #[serde(default)]
    title: String,
    #[serde(default)]
    channel_title: String,
    #[serde(default)]
    published_at: String,
    #[serde(default)]
    thumbnails: YtThumbs,
}

#[derive(Debug, Default, Deserialize)]
struct YtThumbs {
    #[serde(default)]
    medium: Option<YtThumb>,
}

#[derive(Debug, Default, Deserialize)]
struct YtThumb {
    #[serde(default)]
    url: String,
}

#[derive(Debug, Deserialize)]
struct YtErrorEnvelope {
    error: YtErrorBody,
}

#[derive(Debug, Deserialize)]
struct YtErrorBody {
    #[serde(default)]
    message: String,
}

/// Run a YouTube search. Errors (including quota / key problems surfaced by
/// Google) are returned as `Err(String)` so the UI can display them.
pub async fn search(
    client: &reqwest::Client,
    key: &str,
    q: &str,
    page_token: Option<&str>,
) -> Result<YoutubeResults, String> {
    let mut query: Vec<(&str, String)> = vec![
        ("part", "snippet".to_string()),
        ("type", "video".to_string()),
        ("maxResults", "25".to_string()),
        ("q", q.to_string()),
        ("key", key.to_string()),
    ];
    if let Some(pt) = page_token {
        if !pt.is_empty() {
            query.push(("pageToken", pt.to_string()));
        }
    }

    let resp = client
        .get("https://www.googleapis.com/youtube/v3/search")
        .query(&query)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let message = serde_json::from_str::<YtErrorEnvelope>(&body)
            .map(|e| e.error.message)
            .ok()
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| format!("youtube error: {status}"));
        return Err(message);
    }

    let parsed: YtResponse = resp.json().await.map_err(|e| e.to_string())?;

    let items = parsed
        .items
        .into_iter()
        .filter_map(|item| {
            let video_id = item.id.video_id?;
            Some(YoutubeItem {
                video_id,
                title: item.snippet.title,
                channel_title: item.snippet.channel_title,
                thumbnail: item.snippet.thumbnails.medium.map(|t| t.url).unwrap_or_default(),
                published_at: item.snippet.published_at,
            })
        })
        .collect();

    Ok(YoutubeResults {
        items,
        next_page_token: parsed.next_page_token,
    })
}

// --- Playlist items -------------------------------------------------------

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YtPlResponse {
    #[serde(default)]
    items: Vec<YtPlItem>,
    #[serde(default)]
    next_page_token: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct YtPlItem {
    #[serde(default)]
    snippet: YtPlSnippet,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YtPlSnippet {
    #[serde(default)]
    title: String,
    #[serde(default)]
    channel_title: String,
    #[serde(default)]
    video_owner_channel_title: Option<String>,
    #[serde(default)]
    published_at: String,
    #[serde(default)]
    thumbnails: YtThumbs,
    #[serde(default)]
    resource_id: YtResourceId,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct YtResourceId {
    #[serde(default)]
    video_id: Option<String>,
}

/// Fetch the items of a public playlist, in order.
pub async fn playlist(
    client: &reqwest::Client,
    key: &str,
    playlist_id: &str,
    page_token: Option<&str>,
) -> Result<YoutubeResults, String> {
    let mut query: Vec<(&str, String)> = vec![
        ("part", "snippet".to_string()),
        ("maxResults", "50".to_string()),
        ("playlistId", playlist_id.to_string()),
        ("key", key.to_string()),
    ];
    if let Some(pt) = page_token {
        if !pt.is_empty() {
            query.push(("pageToken", pt.to_string()));
        }
    }

    let resp = client
        .get("https://www.googleapis.com/youtube/v3/playlistItems")
        .query(&query)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let message = serde_json::from_str::<YtErrorEnvelope>(&body)
            .map(|e| e.error.message)
            .ok()
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| format!("youtube error: {status}"));
        return Err(message);
    }

    let parsed: YtPlResponse = resp.json().await.map_err(|e| e.to_string())?;

    let items = parsed
        .items
        .into_iter()
        .filter_map(|item| {
            let s = item.snippet;
            let video_id = s.resource_id.video_id?;
            // Deleted / private entries carry a videoId but can't be played.
            if s.title == "Deleted video" || s.title == "Private video" {
                return None;
            }
            Some(YoutubeItem {
                video_id,
                title: s.title,
                channel_title: s.video_owner_channel_title.unwrap_or(s.channel_title),
                thumbnail: s.thumbnails.medium.map(|t| t.url).unwrap_or_default(),
                published_at: s.published_at,
            })
        })
        .collect();

    Ok(YoutubeResults {
        items,
        next_page_token: parsed.next_page_token,
    })
}

/// Fetch EVERY item of a public playlist by following pagination. The YouTube
/// API caps `playlistItems` at 50 per page, so a 74-video playlist needs two
/// requests; this loops until the playlist is exhausted, bounded by a sane page
/// cap so a pathological playlist can't spin forever.
pub async fn playlist_all(
    client: &reqwest::Client,
    key: &str,
    playlist_id: &str,
) -> Result<YoutubeResults, String> {
    const MAX_PAGES: usize = 40; // up to 40 * 50 = 2000 items
    let mut all: Vec<YoutubeItem> = Vec::new();
    let mut token: Option<String> = None;
    for _ in 0..MAX_PAGES {
        let page = playlist(client, key, playlist_id, token.as_deref()).await?;
        all.extend(page.items);
        match page.next_page_token {
            Some(t) if !t.is_empty() => token = Some(t),
            _ => break,
        }
    }
    Ok(YoutubeResults {
        items: all,
        next_page_token: None,
    })
}

// --- Playlist info (title / thumbnail) ------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistInfo {
    pub playlist_id: String,
    pub title: String,
    pub channel_title: String,
    pub thumbnail: String,
}

#[derive(Debug, Default, Deserialize)]
struct YtPlInfoResponse {
    #[serde(default)]
    items: Vec<YtPlInfoItem>,
}

#[derive(Debug, Default, Deserialize)]
struct YtPlInfoItem {
    #[serde(default)]
    id: String,
    #[serde(default)]
    snippet: YtSnippet,
}

/// Fetch a playlist's own title / channel / cover image (for saving it).
pub async fn playlist_info(
    client: &reqwest::Client,
    key: &str,
    playlist_id: &str,
) -> Result<PlaylistInfo, String> {
    let query: Vec<(&str, String)> = vec![
        ("part", "snippet".to_string()),
        ("id", playlist_id.to_string()),
        ("key", key.to_string()),
    ];

    let resp = client
        .get("https://www.googleapis.com/youtube/v3/playlists")
        .query(&query)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let message = serde_json::from_str::<YtErrorEnvelope>(&body)
            .map(|e| e.error.message)
            .ok()
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| format!("youtube error: {status}"));
        return Err(message);
    }

    let parsed: YtPlInfoResponse = resp.json().await.map_err(|e| e.to_string())?;
    let item = parsed
        .items
        .into_iter()
        .next()
        .ok_or_else(|| "playlist not found".to_string())?;

    Ok(PlaylistInfo {
        playlist_id: item.id,
        title: item.snippet.title,
        channel_title: item.snippet.channel_title,
        thumbnail: item.snippet.thumbnails.medium.map(|t| t.url).unwrap_or_default(),
    })
}

// --- Single video ---------------------------------------------------------

#[derive(Debug, Default, Deserialize)]
struct YtVidResponse {
    #[serde(default)]
    items: Vec<YtVidItem>,
}

#[derive(Debug, Default, Deserialize)]
struct YtVidItem {
    #[serde(default)]
    id: String,
    #[serde(default)]
    snippet: YtSnippet,
}

/// Fetch one video's metadata by id (for pasted video links).
pub async fn video(
    client: &reqwest::Client,
    key: &str,
    video_id: &str,
) -> Result<YoutubeResults, String> {
    let query: Vec<(&str, String)> = vec![
        ("part", "snippet".to_string()),
        ("id", video_id.to_string()),
        ("key", key.to_string()),
    ];

    let resp = client
        .get("https://www.googleapis.com/youtube/v3/videos")
        .query(&query)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let message = serde_json::from_str::<YtErrorEnvelope>(&body)
            .map(|e| e.error.message)
            .ok()
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| format!("youtube error: {status}"));
        return Err(message);
    }

    let parsed: YtVidResponse = resp.json().await.map_err(|e| e.to_string())?;

    let items = parsed
        .items
        .into_iter()
        .map(|item| YoutubeItem {
            video_id: item.id,
            title: item.snippet.title,
            channel_title: item.snippet.channel_title,
            thumbnail: item.snippet.thumbnails.medium.map(|t| t.url).unwrap_or_default(),
            published_at: item.snippet.published_at,
        })
        .collect();

    Ok(YoutubeResults {
        items,
        next_page_token: None,
    })
}
