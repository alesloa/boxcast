//! IPTV catalog: fetch the iptv-org open dataset, normalize it into the shape
//! the frontend consumes, and compute facet counts.

use std::collections::{HashMap, HashSet};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

const BASE: &str = "https://iptv-org.github.io/api/";

// ---------------------------------------------------------------------------
// Output shapes (camelCase on the wire to match the TS contract).
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stream {
    pub url: String,
    pub quality: Option<String>,
    pub referrer: Option<String>,
    pub user_agent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Country {
    pub code: String,
    pub name: String,
    pub flag: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub logo: Option<String>,
    pub categories: Vec<String>,
    pub country: Option<Country>,
    pub languages: Vec<String>,
    pub is_nsfw: bool,
    pub streams: Vec<Stream>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FacetCount {
    pub name: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountryFacet {
    pub code: String,
    pub name: String,
    pub flag: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Facets {
    pub categories: Vec<FacetCount>,
    pub countries: Vec<CountryFacet>,
    pub languages: Vec<FacetCount>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub channels: Vec<Channel>,
    pub facets: Facets,
}

// ---------------------------------------------------------------------------
// Raw shapes (only the documented fields; everything else is ignored).
// ---------------------------------------------------------------------------

/// Treat an explicit JSON `null` as `T::default()` (the upstream dataset
/// occasionally emits `null` where an array/bool is expected).
fn null_default<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    let opt = Option::<T>::deserialize(d)?;
    Ok(opt.unwrap_or_default())
}

#[derive(Debug, Clone, Default, Deserialize)]
#[allow(dead_code)] // some fields are parsed from the dataset but not yet surfaced
pub struct RawChannel {
    pub id: String,
    pub name: String,
    #[serde(default, deserialize_with = "null_default")]
    pub alt_names: Vec<String>,
    #[serde(default)]
    pub network: Option<String>,
    #[serde(default)]
    pub country: Option<String>,
    #[serde(default, deserialize_with = "null_default")]
    pub categories: Vec<String>,
    #[serde(default, deserialize_with = "null_default")]
    pub is_nsfw: bool,
    #[serde(default)]
    pub website: Option<String>,
    #[serde(default)]
    pub closed: Option<String>,
    #[serde(default)]
    pub replaced_by: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[allow(dead_code)] // some fields are parsed from the dataset but not yet surfaced
pub struct RawStream {
    #[serde(default)]
    pub channel: Option<String>,
    #[serde(default)]
    pub feed: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    pub url: String,
    #[serde(default)]
    pub referrer: Option<String>,
    #[serde(default)]
    pub user_agent: Option<String>,
    #[serde(default)]
    pub quality: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RawCategory {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RawCountry {
    pub name: String,
    pub code: String,
    #[serde(default, deserialize_with = "null_default")]
    pub languages: Vec<String>,
    #[serde(default)]
    pub flag: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RawLanguage {
    pub code: String,
    pub name: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[allow(dead_code)] // some fields are parsed from the dataset but not yet surfaced
pub struct RawLogo {
    #[serde(default)]
    pub channel: Option<String>,
    #[serde(default)]
    pub feed: Option<String>,
    #[serde(default, deserialize_with = "null_default")]
    pub tags: Vec<String>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub format: Option<String>,
    pub url: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RawBlock {
    pub channel: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[allow(dead_code)] // some fields are parsed from the dataset but not yet surfaced
pub struct RawFeed {
    #[serde(default)]
    pub channel: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub is_main: Option<bool>,
    #[serde(default, deserialize_with = "null_default")]
    pub languages: Vec<String>,
    #[serde(default)]
    pub format: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct RawData {
    pub channels: Vec<RawChannel>,
    pub streams: Vec<RawStream>,
    pub categories: Vec<RawCategory>,
    pub countries: Vec<RawCountry>,
    pub languages: Vec<RawLanguage>,
    pub logos: Vec<RawLogo>,
    pub blocklist: Vec<RawBlock>,
    pub feeds: Vec<RawFeed>,
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

async fn get_json<T: DeserializeOwned>(client: &reqwest::Client, url: &str) -> anyhow::Result<T> {
    let resp = client
        .get(url)
        .timeout(std::time::Duration::from_secs(45))
        .send()
        .await?
        .error_for_status()?;
    Ok(resp.json::<T>().await?)
}

/// Fetch the eight source arrays concurrently.
pub async fn fetch_raw(client: &reqwest::Client) -> anyhow::Result<RawData> {
    let u_channels = format!("{BASE}channels.json");
    let u_streams = format!("{BASE}streams.json");
    let u_categories = format!("{BASE}categories.json");
    let u_countries = format!("{BASE}countries.json");
    let u_languages = format!("{BASE}languages.json");
    let u_logos = format!("{BASE}logos.json");
    let u_blocklist = format!("{BASE}blocklist.json");
    let u_feeds = format!("{BASE}feeds.json");

    let (channels, streams, categories, countries, languages, logos, blocklist, feeds) = tokio::try_join!(
        get_json::<Vec<RawChannel>>(client, &u_channels),
        get_json::<Vec<RawStream>>(client, &u_streams),
        get_json::<Vec<RawCategory>>(client, &u_categories),
        get_json::<Vec<RawCountry>>(client, &u_countries),
        get_json::<Vec<RawLanguage>>(client, &u_languages),
        get_json::<Vec<RawLogo>>(client, &u_logos),
        get_json::<Vec<RawBlock>>(client, &u_blocklist),
        get_json::<Vec<RawFeed>>(client, &u_feeds),
    )?;

    Ok(RawData {
        channels,
        streams,
        categories,
        countries,
        languages,
        logos,
        blocklist,
        feeds,
    })
}

// ---------------------------------------------------------------------------
// Normalize (pure — unit tested)
// ---------------------------------------------------------------------------

fn pick_logo(logos: Option<&Vec<&RawLogo>>) -> Option<String> {
    let logos = logos?;
    logos
        .iter()
        .max_by_key(|l| {
            let is_png = l
                .format
                .as_deref()
                .map(|f| f.eq_ignore_ascii_case("png"))
                .unwrap_or(false);
            let area = l.width.unwrap_or(0) as u64 * l.height.unwrap_or(0) as u64;
            (is_png as u8, area)
        })
        .map(|l| l.url.clone())
}

/// Map language codes → names, dropping unknown codes and de-duplicating while
/// preserving first-seen order.
fn codes_to_names(codes: &[String], lang_map: &HashMap<String, String>) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for c in codes {
        if let Some(name) = lang_map.get(c) {
            if seen.insert(name.clone()) {
                out.push(name.clone());
            }
        }
    }
    out
}

/// Turn a `name → count` map into a `FacetCount` list sorted by count desc,
/// then name asc for stable ordering.
fn sort_facet_counts(map: HashMap<String, u32>) -> Vec<FacetCount> {
    let mut v: Vec<FacetCount> = map
        .into_iter()
        .map(|(name, count)| FacetCount { name, count })
        .collect();
    v.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    v
}

pub fn normalize(raw: RawData) -> Catalog {
    // Lookup maps.
    let category_map: HashMap<String, String> =
        raw.categories.iter().map(|c| (c.id.clone(), c.name.clone())).collect();

    let language_map: HashMap<String, String> =
        raw.languages.iter().map(|l| (l.code.clone(), l.name.clone())).collect();

    let country_map: HashMap<String, Country> = raw
        .countries
        .iter()
        .map(|c| {
            (
                c.code.clone(),
                Country {
                    code: c.code.clone(),
                    name: c.name.clone(),
                    flag: c.flag.clone().unwrap_or_default(),
                },
            )
        })
        .collect();

    let country_langs: HashMap<String, Vec<String>> =
        raw.countries.iter().map(|c| (c.code.clone(), c.languages.clone())).collect();

    let blocklist: HashSet<String> =
        raw.blocklist.iter().map(|b| b.channel.clone()).collect();

    let mut logos_by_channel: HashMap<String, Vec<&RawLogo>> = HashMap::new();
    for logo in &raw.logos {
        if let Some(ch) = &logo.channel {
            logos_by_channel.entry(ch.clone()).or_default().push(logo);
        }
    }

    // Main-feed languages by channel, with any-feed fallback.
    let mut main_feed_langs: HashMap<String, Vec<String>> = HashMap::new();
    let mut any_feed_langs: HashMap<String, Vec<String>> = HashMap::new();
    for feed in &raw.feeds {
        if let Some(ch) = &feed.channel {
            if feed.is_main == Some(true) {
                main_feed_langs.entry(ch.clone()).or_insert_with(|| feed.languages.clone());
            }
            any_feed_langs.entry(ch.clone()).or_insert_with(|| feed.languages.clone());
        }
    }

    // Streams grouped by channel; drop streams with a null channel.
    let mut streams_by_channel: HashMap<String, Vec<&RawStream>> = HashMap::new();
    for s in &raw.streams {
        if let Some(ch) = &s.channel {
            streams_by_channel.entry(ch.clone()).or_default().push(s);
        }
    }

    let mut channels: Vec<Channel> = Vec::new();

    for ch in &raw.channels {
        if blocklist.contains(&ch.id) {
            continue;
        }
        if ch.closed.is_some() {
            continue;
        }
        let chan_streams = match streams_by_channel.get(&ch.id) {
            Some(v) if !v.is_empty() => v,
            _ => continue,
        };

        let logo = pick_logo(logos_by_channel.get(&ch.id));

        let categories: Vec<String> = ch
            .categories
            .iter()
            .filter_map(|cid| category_map.get(cid).cloned())
            .collect();

        let country = ch.country.as_ref().and_then(|cc| country_map.get(cc).cloned());

        // Languages: main-feed languages, else any-feed, else the channel's
        // country's languages.
        let feed_langs = main_feed_langs
            .get(&ch.id)
            .or_else(|| any_feed_langs.get(&ch.id));
        let lang_codes: Vec<String> = match feed_langs {
            Some(v) if !v.is_empty() => v.clone(),
            _ => ch
                .country
                .as_ref()
                .and_then(|cc| country_langs.get(cc))
                .cloned()
                .unwrap_or_default(),
        };
        let languages = codes_to_names(&lang_codes, &language_map);

        let streams: Vec<Stream> = chan_streams
            .iter()
            .map(|s| Stream {
                url: s.url.clone(),
                quality: s.quality.clone(),
                referrer: s.referrer.clone(),
                user_agent: s.user_agent.clone(),
            })
            .collect();

        channels.push(Channel {
            id: ch.id.clone(),
            name: ch.name.clone(),
            logo,
            categories,
            country,
            languages,
            is_nsfw: ch.is_nsfw,
            streams,
        });
    }

    channels.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    // Facets — counted over the emitted channels only.
    let mut cat_counts: HashMap<String, u32> = HashMap::new();
    let mut lang_counts: HashMap<String, u32> = HashMap::new();
    let mut country_counts: HashMap<String, u32> = HashMap::new();
    for c in &channels {
        for cat in &c.categories {
            *cat_counts.entry(cat.clone()).or_insert(0) += 1;
        }
        for lang in &c.languages {
            *lang_counts.entry(lang.clone()).or_insert(0) += 1;
        }
        if let Some(country) = &c.country {
            *country_counts.entry(country.code.clone()).or_insert(0) += 1;
        }
    }

    let categories = sort_facet_counts(cat_counts);
    let languages = sort_facet_counts(lang_counts);

    let mut countries: Vec<CountryFacet> = country_counts
        .into_iter()
        .filter_map(|(code, count)| {
            country_map.get(&code).map(|c| CountryFacet {
                code: c.code.clone(),
                name: c.name.clone(),
                flag: c.flag.clone(),
                count,
            })
        })
        .collect();
    countries.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.code.cmp(&b.code)));

    Catalog {
        channels,
        facets: Facets {
            categories,
            countries,
            languages,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> RawData {
        RawData {
            channels: vec![
                RawChannel {
                    id: "Alpha.us".into(),
                    name: "Alpha".into(),
                    country: Some("US".into()),
                    categories: vec!["news".into(), "movies".into(), "zzz".into()],
                    ..Default::default()
                },
                RawChannel {
                    id: "Beta.fr".into(),
                    name: "Beta".into(),
                    country: Some("FR".into()),
                    categories: vec!["news".into()],
                    ..Default::default()
                },
                RawChannel {
                    id: "Gamma.xx".into(),
                    name: "Gamma".into(),
                    country: Some("US".into()),
                    ..Default::default()
                },
                RawChannel {
                    id: "Delta.us".into(),
                    name: "Delta".into(),
                    country: Some("US".into()),
                    closed: Some("2020-01-01".into()),
                    ..Default::default()
                },
                RawChannel {
                    id: "Echo.us".into(),
                    name: "Echo".into(),
                    country: Some("US".into()),
                    ..Default::default()
                },
            ],
            streams: vec![
                RawStream {
                    channel: Some("Alpha.us".into()),
                    url: "http://a/1".into(),
                    quality: Some("1080p".into()),
                    ..Default::default()
                },
                RawStream {
                    channel: Some("Alpha.us".into()),
                    url: "http://a/2".into(),
                    quality: Some("720p".into()),
                    ..Default::default()
                },
                RawStream {
                    channel: Some("Beta.fr".into()),
                    url: "http://b/1".into(),
                    ..Default::default()
                },
                RawStream {
                    channel: Some("Gamma.xx".into()),
                    url: "http://g/1".into(),
                    ..Default::default()
                },
                RawStream {
                    channel: Some("Delta.us".into()),
                    url: "http://d/1".into(),
                    ..Default::default()
                },
                // channel: null -> dropped, must not create a channel.
                RawStream {
                    channel: None,
                    url: "http://null/1".into(),
                    ..Default::default()
                },
                // Echo.us deliberately has no stream.
            ],
            categories: vec![
                RawCategory { id: "news".into(), name: "News".into() },
                RawCategory { id: "movies".into(), name: "Movies".into() },
            ],
            countries: vec![
                RawCountry {
                    name: "United States".into(),
                    code: "US".into(),
                    languages: vec!["eng".into()],
                    flag: Some("🇺🇸".into()),
                },
                RawCountry {
                    name: "France".into(),
                    code: "FR".into(),
                    languages: vec!["fra".into()],
                    flag: Some("🇫🇷".into()),
                },
            ],
            languages: vec![
                RawLanguage { code: "eng".into(), name: "English".into() },
                RawLanguage { code: "spa".into(), name: "Spanish".into() },
                RawLanguage { code: "fra".into(), name: "French".into() },
            ],
            logos: vec![
                RawLogo {
                    channel: Some("Alpha.us".into()),
                    format: Some("png".into()),
                    width: Some(100),
                    height: Some(100),
                    url: "http://logo/a.png".into(),
                    ..Default::default()
                },
                RawLogo {
                    channel: Some("Alpha.us".into()),
                    format: Some("gif".into()),
                    width: Some(50),
                    height: Some(50),
                    url: "http://logo/a.gif".into(),
                    ..Default::default()
                },
            ],
            blocklist: vec![RawBlock { channel: "Gamma.xx".into() }],
            feeds: vec![
                // Main feed pins Spanish; a non-main feed offers English to
                // prove the main feed wins.
                RawFeed {
                    channel: Some("Alpha.us".into()),
                    is_main: Some(false),
                    languages: vec!["eng".into()],
                    ..Default::default()
                },
                RawFeed {
                    channel: Some("Alpha.us".into()),
                    is_main: Some(true),
                    languages: vec!["spa".into()],
                    ..Default::default()
                },
                // Beta has no feed at all -> falls back to country languages.
            ],
        }
    }

    fn facet<'a>(list: &'a [FacetCount], name: &str) -> Option<&'a FacetCount> {
        list.iter().find(|f| f.name == name)
    }

    #[test]
    fn joins_streams_categories_country_and_picks_png_logo() {
        let cat = normalize(fixture());
        let alpha = cat.channels.iter().find(|c| c.id == "Alpha.us").unwrap();
        assert_eq!(alpha.streams.len(), 2);
        let urls: Vec<&str> = alpha.streams.iter().map(|s| s.url.as_str()).collect();
        assert!(urls.contains(&"http://a/1") && urls.contains(&"http://a/2"));
        // Unknown category id "zzz" dropped; ids mapped to names in order.
        assert_eq!(alpha.categories, vec!["News".to_string(), "Movies".to_string()]);
        let country = alpha.country.as_ref().unwrap();
        assert_eq!(country.code, "US");
        assert_eq!(country.name, "United States");
        // png preferred over the gif.
        assert_eq!(alpha.logo.as_deref(), Some("http://logo/a.png"));
    }

    #[test]
    fn null_channel_stream_is_dropped() {
        let cat = normalize(fixture());
        let has_null = cat
            .channels
            .iter()
            .any(|c| c.streams.iter().any(|s| s.url == "http://null/1"));
        assert!(!has_null);
    }

    #[test]
    fn blocklisted_channel_excluded() {
        let cat = normalize(fixture());
        assert!(cat.channels.iter().all(|c| c.id != "Gamma.xx"));
    }

    #[test]
    fn closed_channel_excluded() {
        let cat = normalize(fixture());
        assert!(cat.channels.iter().all(|c| c.id != "Delta.us"));
    }

    #[test]
    fn channel_without_streams_excluded() {
        let cat = normalize(fixture());
        assert!(cat.channels.iter().all(|c| c.id != "Echo.us"));
    }

    #[test]
    fn languages_prefer_main_feed_then_fall_back_to_country() {
        let cat = normalize(fixture());
        let alpha = cat.channels.iter().find(|c| c.id == "Alpha.us").unwrap();
        // Main feed pins Spanish (not the country's English).
        assert_eq!(alpha.languages, vec!["Spanish".to_string()]);
        let beta = cat.channels.iter().find(|c| c.id == "Beta.fr").unwrap();
        // No feed -> country FR languages -> French.
        assert_eq!(beta.languages, vec!["French".to_string()]);
    }

    #[test]
    fn facet_counts_are_correct() {
        let cat = normalize(fixture());
        // Only Alpha + Beta survive.
        assert_eq!(cat.channels.len(), 2);
        // Channels are sorted A-Z.
        assert_eq!(cat.channels[0].name, "Alpha");
        assert_eq!(cat.channels[1].name, "Beta");

        assert_eq!(facet(&cat.facets.categories, "News").unwrap().count, 2);
        assert_eq!(facet(&cat.facets.categories, "Movies").unwrap().count, 1);
        // News (2) sorts before Movies (1).
        assert_eq!(cat.facets.categories[0].name, "News");

        assert_eq!(facet(&cat.facets.languages, "Spanish").unwrap().count, 1);
        assert_eq!(facet(&cat.facets.languages, "French").unwrap().count, 1);

        let us = cat.facets.countries.iter().find(|c| c.code == "US").unwrap();
        let fr = cat.facets.countries.iter().find(|c| c.code == "FR").unwrap();
        assert_eq!(us.count, 1);
        assert_eq!(fr.count, 1);
        assert_eq!(us.flag, "🇺🇸");
    }
}
