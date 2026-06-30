//! HLS / media proxy.
//!
//! A tiny axum router that fetches upstream media on behalf of the webview,
//! rewriting HLS manifests so every child URL (variant playlists, segments,
//! keys) is routed back through this proxy. This sidesteps CORS and lets us
//! inject the upstream `Referer` / `User-Agent` the source requires.

use std::net::{Ipv4Addr, Ipv6Addr};

use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Deserialize;
use tower_http::cors::CorsLayer;
use url::{Host, Url};

/// Default desktop Chrome User-Agent used when the caller does not pin one.
pub const DEFAULT_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) \
     Chrome/120.0.0.0 Safari/537.36";

static URI_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"URI="([^"]+)""#).unwrap());

/// Build the proxy router bound to a shared reqwest client.
pub fn router(client: reqwest::Client) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/proxy", get(proxy_handler))
        .route("/yt-player", get(yt_player))
        .layer(CorsLayer::permissive())
        .with_state(client)
}

async fn health() -> &'static str {
    "ok"
}

/// Serves a tiny HTML host page for the YouTube IFrame player over this
/// loopback HTTP origin.
///
/// The macOS production webview runs on the `tauri://localhost` scheme, which
/// YouTube's IFrame API rejects as an invalid embedding origin (error 153),
/// so every video fails to play in the bundled app even though it works in the
/// dev server (which is served over `http://localhost`). Embedding the player
/// inside this `http://127.0.0.1:<port>` page gives it a valid HTTP origin;
/// the app drives it (load / play / pause / volume / mute) over `postMessage`
/// and receives ready / state / error events back the same way.
async fn yt_player() -> Response {
    let mut out = Response::new(Body::from(YT_PLAYER_HTML));
    out.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    out.headers_mut()
        .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    out
}

const YT_PLAYER_HTML: &str = r##"<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}#p{width:100%;height:100%}</style>
</head>
<body>
<div id="p"></div>
<script>
(function(){
  var player=null, ready=false, pLoad=null, pVol=null, pMute=null, timer=null;
  function send(t,d){ try{ parent.postMessage({__mcyt:1,type:t,data:d}, '*'); }catch(e){} }
  function startTimer(){
    if(timer) return;
    timer=setInterval(function(){
      try{ send('time',{cur:player.getCurrentTime(),dur:player.getDuration()}); }catch(_){}
    },500);
  }
  function stopTimer(){ if(timer){clearInterval(timer);timer=null;} }
  window.onYouTubeIframeAPIReady=function(){
    player=new YT.Player('p',{
      width:'100%',height:'100%',
      playerVars:{autoplay:0,playsinline:1,rel:0,modestbranding:1,cc_load_policy:0,iv_load_policy:3},
      events:{
        onReady:function(){
          ready=true;
          if(pVol!=null){player.setVolume(pVol);pVol=null;}
          if(pMute!=null){pMute?player.mute():player.unMute();pMute=null;}
          if(pLoad){player.loadVideoById(pLoad);pLoad=null;}
          send('ready');
        },
        onStateChange:function(e){ send('state',e.data); if(e.data===1){startTimer();}else{stopTimer();} },
        // Captions stay OFF by default — even when a video forces them on. The
        // captions module fires onApiChange when it loads (per video); we clear
        // the active track each time. The CC button is left intact, so the user
        // can still turn captions on manually whenever they want.
        onApiChange:function(){
          try{player.setOption('captions','track',{});}catch(_){}
          try{player.setOption('cc','track',{});}catch(_){}
        },
        onError:function(e){ send('error',e.data); }
      }
    });
  };
  window.addEventListener('message',function(e){
    var m=e.data; if(!m||m.__mccmd!==1) return;
    try{
      if(m.cmd==='load'){ if(ready&&player){player.loadVideoById(m.id);} else {pLoad=m.id;} }
      else if(m.cmd==='play'){ if(ready&&player)player.playVideo(); }
      else if(m.cmd==='pause'){ if(ready&&player)player.pauseVideo(); }
      else if(m.cmd==='volume'){ if(ready&&player){player.setVolume(m.value);} else {pVol=m.value;} }
      else if(m.cmd==='mute'){ if(ready&&player){m.value?player.mute():player.unMute();} else {pMute=m.value;} }
    }catch(_){}
  });
  var s=document.createElement('script'); s.src='https://www.youtube.com/iframe_api'; document.head.appendChild(s);
})();
</script>
</body>
</html>
"##;

#[derive(Debug, Deserialize)]
struct ProxyQuery {
    url: Option<String>,
    #[serde(rename = "ref")]
    ref_: Option<String>,
    ua: Option<String>,
}

async fn proxy_handler(
    State(client): State<reqwest::Client>,
    Query(q): Query<ProxyQuery>,
    headers: HeaderMap,
) -> Response {
    // axum has already percent-decoded the query values once — use them as-is.
    let url = match q.url.as_deref() {
        Some(u) if !u.is_empty() => u,
        _ => return (StatusCode::BAD_REQUEST, "missing url").into_response(),
    };

    let parsed = match Url::parse(url) {
        Ok(u) => u,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid url").into_response(),
    };

    if !is_safe_target(&parsed) {
        return (StatusCode::BAD_REQUEST, "blocked target").into_response();
    }

    let ref_opt = q.ref_.as_deref().filter(|s| !s.is_empty());
    let ua_opt = q.ua.as_deref().filter(|s| !s.is_empty());
    let effective_ua = ua_opt.unwrap_or(DEFAULT_UA);

    // No total-request timeout: radio is a single endless body and a 15s cap
    // would cut it off mid-play. Connection setup is bounded by the client's
    // connect_timeout; HLS fragment hangs are bounded by hls.js's own timeouts.
    let mut req = client
        .get(parsed.clone())
        .header(header::USER_AGENT, effective_ua);
    if let Some(r) = ref_opt {
        req = req.header(header::REFERER, r);
    }
    if let Some(range) = headers.get(header::RANGE) {
        if let Ok(rv) = range.to_str() {
            req = req.header(header::RANGE, rv);
        }
    }

    let resp = match req.send().await {
        Ok(r) => r,
        Err(_) => return (StatusCode::BAD_GATEWAY, "upstream error").into_response(),
    };

    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::OK);
    let final_url = resp.url().clone();
    let content_type = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let content_range = header_str(resp.headers(), header::CONTENT_RANGE);
    let accept_ranges = header_str(resp.headers(), header::ACCEPT_RANGES);

    // Upstream failed outright — surface the error status so the player fires a
    // clean error and auto-advances instead of buffering a dead stream forever.
    if !status.is_success() {
        return (status, format!("upstream {}", status.as_u16())).into_response();
    }

    let looks_manifest = {
        let ct = content_type.to_ascii_lowercase();
        ct.contains("mpegurl")
            || ct.contains("m3u8")
            || final_url.path().to_ascii_lowercase().ends_with(".m3u8")
    };

    if looks_manifest {
        let bytes = match resp.bytes().await {
            Ok(b) => b,
            Err(_) => return (StatusCode::BAD_GATEWAY, "read error").into_response(),
        };
        // A `.m3u8` URL can still return an HTML error page (geo-block / 403
        // disguised as 200). Only rewrite when the body is really an HLS
        // manifest; otherwise fail cleanly so the player skips on.
        if !body_is_manifest(&bytes) {
            return (StatusCode::BAD_GATEWAY, "not a manifest").into_response();
        }
        let body = String::from_utf8_lossy(&bytes);
        let rewritten = rewrite_manifest(&body, final_url.as_str(), ref_opt, ua_opt);
        let mut out = Response::new(Body::from(rewritten));
        let h = out.headers_mut();
        h.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/vnd.apple.mpegurl"),
        );
        h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
        return out;
    }

    // Stream everything else (segments, keys, init fragments) straight through
    // without buffering the whole body in memory.
    let mut builder = Response::builder().status(status);
    if let Some(h) = builder.headers_mut() {
        if let Ok(ct) = HeaderValue::from_str(&content_type) {
            if !content_type.is_empty() {
                h.insert(header::CONTENT_TYPE, ct);
            }
        }
        if let Some(cr) = content_range {
            if let Ok(v) = HeaderValue::from_str(&cr) {
                h.insert(header::CONTENT_RANGE, v);
            }
        }
        if let Some(ar) = accept_ranges {
            if let Ok(v) = HeaderValue::from_str(&ar) {
                h.insert(header::ACCEPT_RANGES, v);
            }
        }
        h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    }

    match builder.body(Body::from_stream(resp.bytes_stream())) {
        Ok(r) => r,
        Err(_) => (StatusCode::BAD_GATEWAY, "stream error").into_response(),
    }
}

fn header_str(headers: &reqwest::header::HeaderMap, name: header::HeaderName) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

/// SSRF guard: only allow plain http/https to non-internal hosts. The proxy
/// only binds 127.0.0.1 so it isn't externally reachable, but we still refuse
/// to fetch loopback / private / link-local targets on the user's behalf.
fn is_safe_target(url: &Url) -> bool {
    match url.scheme() {
        "http" | "https" => {}
        _ => return false,
    }
    match url.host() {
        Some(Host::Domain(d)) => {
            let d = d.to_ascii_lowercase();
            !(d == "localhost" || d.ends_with(".localhost"))
        }
        Some(Host::Ipv4(ip)) => !is_internal_v4(ip),
        Some(Host::Ipv6(ip)) => !is_internal_v6(ip),
        None => false,
    }
}

fn is_internal_v4(ip: Ipv4Addr) -> bool {
    // 0.0.0.0, loopback 127/8, private 10/8 + 172.16/12 + 192.168/16, link-local 169.254/16.
    ip.is_unspecified() || ip.is_loopback() || ip.is_private() || ip.is_link_local()
}

fn is_internal_v6(ip: Ipv6Addr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() {
        return true;
    }
    let first = ip.segments()[0];
    // fc00::/7 unique-local
    if (first & 0xfe00) == 0xfc00 {
        return true;
    }
    // fe80::/10 link-local
    if (first & 0xffc0) == 0xfe80 {
        return true;
    }
    false
}

/// True when the body really is an HLS manifest (starts with the `#EXTM3U`
/// tag after an optional UTF-8 BOM / leading whitespace). Guards against error
/// pages served with a `.m3u8` URL or an `mpegurl` content-type.
pub fn body_is_manifest(bytes: &[u8]) -> bool {
    let s = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    // Only the first chunk matters; avoid lossy-decoding a whole segment.
    let head = &s[..s.len().min(64)];
    String::from_utf8_lossy(head).trim_start().starts_with("#EXTM3U")
}

/// Rewrite an HLS manifest so every URI (segments, keys, child playlists) is
/// re-pointed at `/proxy?url=<absolute>`, carrying `ref`/`ua` forward.
///
/// Pure function — unit tested below.
pub fn rewrite_manifest(text: &str, base_url: &str, ref_: Option<&str>, ua: Option<&str>) -> String {
    let base = Url::parse(base_url).ok();

    let wrap = |raw: &str| -> String {
        let abs = match &base {
            Some(b) => b
                .join(raw)
                .map(|u| u.to_string())
                .unwrap_or_else(|_| raw.to_string()),
            None => raw.to_string(),
        };
        let mut out = format!("/proxy?url={}", urlencoding::encode(&abs));
        if let Some(r) = ref_ {
            out.push_str("&ref=");
            out.push_str(&urlencoding::encode(r));
        }
        if let Some(u) = ua {
            out.push_str("&ua=");
            out.push_str(&urlencoding::encode(u));
        }
        out
    };

    text.split('\n')
        .map(|raw_line| {
            // Emulate splitting on /\r?\n/ by dropping a trailing CR.
            let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
            let l = line.trim();
            if l.is_empty() {
                line.to_string()
            } else if l.starts_with('#') {
                URI_RE
                    .replace_all(line, |caps: &regex::Captures| {
                        format!("URI=\"{}\"", wrap(&caps[1]))
                    })
                    .into_owned()
            } else {
                wrap(l)
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: &str = "https://h.example/live/x.m3u8";

    #[test]
    fn relative_segment_is_wrapped() {
        let out = rewrite_manifest("seg1.ts", BASE, None, None);
        assert_eq!(out, "/proxy?url=https%3A%2F%2Fh.example%2Flive%2Fseg1.ts");
    }

    #[test]
    fn relative_variant_playlist_is_wrapped() {
        let out = rewrite_manifest("chunk.m3u8", BASE, None, None);
        assert_eq!(out, "/proxy?url=https%3A%2F%2Fh.example%2Flive%2Fchunk.m3u8");
    }

    #[test]
    fn ext_x_key_uri_is_rewritten() {
        let line = "#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\",IV=0x1";
        let out = rewrite_manifest(line, BASE, None, None);
        assert_eq!(
            out,
            "#EXT-X-KEY:METHOD=AES-128,URI=\"/proxy?url=https%3A%2F%2Fh.example%2Flive%2Fkey.bin\",IV=0x1"
        );
    }

    #[test]
    fn absolute_child_url_is_wrapped() {
        let out = rewrite_manifest("https://cdn.example/seg.ts?a=1", BASE, None, None);
        assert_eq!(out, "/proxy?url=https%3A%2F%2Fcdn.example%2Fseg.ts%3Fa%3D1");
    }

    #[test]
    fn plain_comment_lines_unchanged() {
        assert_eq!(rewrite_manifest("#EXTM3U", BASE, None, None), "#EXTM3U");
        assert_eq!(
            rewrite_manifest("#EXT-X-VERSION:3", BASE, None, None),
            "#EXT-X-VERSION:3"
        );
    }

    #[test]
    fn blank_lines_preserved() {
        let input = "#EXTM3U\n\nseg1.ts\n";
        let out = rewrite_manifest(input, BASE, None, None);
        assert_eq!(
            out,
            "#EXTM3U\n\n/proxy?url=https%3A%2F%2Fh.example%2Flive%2Fseg1.ts\n"
        );
    }

    #[test]
    fn ref_and_ua_are_appended_encoded() {
        let out = rewrite_manifest("seg1.ts", BASE, Some("https://h.example/"), Some("MyUA/1.0"));
        assert_eq!(
            out,
            "/proxy?url=https%3A%2F%2Fh.example%2Flive%2Fseg1.ts&ref=https%3A%2F%2Fh.example%2F&ua=MyUA%2F1.0"
        );
    }

    #[test]
    fn body_is_manifest_accepts_real_manifests_only() {
        assert!(body_is_manifest(b"#EXTM3U\n#EXT-X-VERSION:3\n"));
        // Leading whitespace + UTF-8 BOM tolerated.
        assert!(body_is_manifest(b"\xEF\xBB\xBF#EXTM3U\n"));
        assert!(body_is_manifest(b"  \n#EXTM3U"));
        // A geo-block HTML error page served at a `.m3u8` URL must be rejected.
        assert!(!body_is_manifest(
            b"<!DOCTYPE HTML><HTML><HEAD><TITLE>ERROR: 403</TITLE>"
        ));
        assert!(!body_is_manifest(b""));
        assert!(!body_is_manifest(b"not a playlist"));
    }

    #[test]
    fn ssrf_guard_blocks_internal_and_bad_schemes() {
        assert!(!is_safe_target(&Url::parse("http://localhost/x").unwrap()));
        assert!(!is_safe_target(&Url::parse("http://127.0.0.1/x").unwrap()));
        assert!(!is_safe_target(&Url::parse("http://10.0.0.5/x").unwrap()));
        assert!(!is_safe_target(&Url::parse("http://192.168.1.1/x").unwrap()));
        assert!(!is_safe_target(&Url::parse("http://169.254.1.1/x").unwrap()));
        assert!(!is_safe_target(&Url::parse("http://[::1]/x").unwrap()));
        assert!(!is_safe_target(&Url::parse("file:///etc/passwd").unwrap()));
        assert!(is_safe_target(&Url::parse("https://cdn.example.com/x.m3u8").unwrap()));
    }
}
