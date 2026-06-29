//! Internet radio via the radio-browser.info network.
//!
//! radio-browser is a pool of mirrors discovered at runtime; we pick one at
//! random per process and fall back to a known host if discovery fails. Every
//! request must carry an identifying User-Agent.

use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::catalog::FacetCount;

const RADIO_UA: &str = "BoxCast/1.0";
const FALLBACK_SERVER: &str = "de1.api.radio-browser.info";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadioSearchParams {
    pub q: Option<String>,
    pub tag: Option<String>,
    pub country: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Station {
    pub id: String,
    pub name: String,
    pub favicon: Option<String>,
    pub url: String,
    pub codec: Option<String>,
    pub bitrate: Option<u64>,
    pub country: Option<String>,
    pub country_code: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadioCountry {
    pub code: String,
    pub name: String,
    pub count: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadioFacets {
    pub tags: Vec<FacetCount>,
    pub countries: Vec<RadioCountry>,
    /// Total stations in the whole radio-browser directory (the library size
    /// shown next to "Radio" in the sources list), independent of any filter.
    pub total: u32,
}

// ---------------------------------------------------------------------------
// Raw shapes
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct ServerEntry {
    name: String,
}

#[derive(Debug, Deserialize)]
struct RawStation {
    #[serde(default)]
    stationuuid: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    favicon: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    url_resolved: Option<String>,
    #[serde(default)]
    codec: Option<String>,
    #[serde(default)]
    bitrate: Option<u64>,
    #[serde(default)]
    country: Option<String>,
    #[serde(default)]
    countrycode: Option<String>,
    #[serde(default)]
    tags: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawTag {
    #[serde(default)]
    name: String,
    #[serde(default)]
    stationcount: u32,
}

#[derive(Debug, Deserialize)]
struct RawStats {
    #[serde(default)]
    stations: u32,
}

#[derive(Debug, Deserialize)]
struct RawCountry {
    #[serde(default)]
    name: String,
    #[serde(default)]
    iso_3166_1: String,
    #[serde(default)]
    stationcount: u32,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn clean_opt(s: Option<String>) -> Option<String> {
    s.filter(|v| !v.is_empty())
}

/// Resolve a radio-browser mirror, picking one at random; fall back to a known
/// host if discovery fails.
async fn resolve_server(client: &reqwest::Client) -> String {
    let fetched = client
        .get("https://all.api.radio-browser.info/json/servers")
        .header(reqwest::header::USER_AGENT, RADIO_UA)
        .send()
        .await
        .and_then(|r| r.error_for_status());

    if let Ok(resp) = fetched {
        if let Ok(servers) = resp.json::<Vec<ServerEntry>>().await {
            if !servers.is_empty() {
                let idx = rand::thread_rng().gen_range(0..servers.len());
                return servers[idx].name.clone();
            }
        }
    }
    FALLBACK_SERVER.to_string()
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

pub async fn search(
    client: &reqwest::Client,
    params: RadioSearchParams,
) -> anyhow::Result<Vec<Station>> {
    let server = resolve_server(client).await;
    let endpoint = format!("https://{server}/json/stations/search");

    let mut query: Vec<(&str, String)> = Vec::new();
    if let Some(q) = clean_opt(params.q) {
        query.push(("name", q));
    }
    if let Some(tag) = clean_opt(params.tag) {
        query.push(("tag", tag));
    }
    if let Some(country) = clean_opt(params.country) {
        query.push(("country", country));
    }
    query.push(("limit", params.limit.unwrap_or(100).to_string()));
    query.push(("offset", params.offset.unwrap_or(0).to_string()));
    query.push(("hidebroken", "true".to_string()));
    query.push(("order", "clickcount".to_string()));
    query.push(("reverse", "true".to_string()));

    let raw: Vec<RawStation> = client
        .get(&endpoint)
        .header(reqwest::header::USER_AGENT, RADIO_UA)
        .query(&query)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let stations = raw
        .into_iter()
        .map(|s| {
            // Prefer the resolved URL; fall back to the raw url.
            let url = clean_opt(s.url_resolved)
                .or_else(|| clean_opt(s.url))
                .unwrap_or_default();
            let tags = s
                .tags
                .unwrap_or_default()
                .split(',')
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
                .collect();
            Station {
                id: s.stationuuid,
                name: s.name,
                favicon: clean_opt(s.favicon),
                url,
                codec: clean_opt(s.codec),
                bitrate: s.bitrate.filter(|b| *b > 0),
                country: clean_opt(s.country),
                country_code: clean_opt(s.countrycode),
                tags,
            }
        })
        .collect();

    Ok(stations)
}

pub async fn facets(client: &reqwest::Client) -> anyhow::Result<RadioFacets> {
    let server = resolve_server(client).await;

    let tags_url = format!("https://{server}/json/tags");
    let countries_url = format!("https://{server}/json/countries");

    let raw_tags: Vec<RawTag> = client
        .get(&tags_url)
        .header(reqwest::header::USER_AGENT, RADIO_UA)
        .query(&[("hidebroken", "true")])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let raw_countries: Vec<RawCountry> = client
        .get(&countries_url)
        .header(reqwest::header::USER_AGENT, RADIO_UA)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let mut tags: Vec<FacetCount> = raw_tags
        .into_iter()
        .filter(|t| !t.name.is_empty())
        .map(|t| FacetCount {
            name: t.name,
            count: t.stationcount,
        })
        .collect();
    tags.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    tags.truncate(80);

    let mut countries: Vec<RadioCountry> = raw_countries
        .into_iter()
        .filter(|c| !c.iso_3166_1.is_empty())
        .map(|c| RadioCountry {
            code: c.iso_3166_1,
            name: c.name,
            count: c.stationcount,
        })
        .collect();
    countries.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.code.cmp(&b.code)));

    // Grand total from the stats endpoint; if it's unavailable, fall back to the
    // sum of per-country counts (~2% low, but never zero).
    let stats_url = format!("https://{server}/json/stats");
    let total = match client
        .get(&stats_url)
        .header(reqwest::header::USER_AGENT, RADIO_UA)
        .send()
        .await
        .and_then(|r| r.error_for_status())
    {
        Ok(resp) => resp.json::<RawStats>().await.map(|s| s.stations).unwrap_or(0),
        Err(_) => 0,
    };
    let total = if total == 0 {
        countries.iter().map(|c| c.count).sum()
    } else {
        total
    };

    Ok(RadioFacets { tags, countries, total })
}
