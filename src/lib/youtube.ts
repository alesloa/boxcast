// Parse whatever the user types into the YouTube box: a video link, a playlist
// link, a bare id, or plain search text.
export type YouTubeInput =
  | { kind: "playlist"; id: string }
  | { kind: "video"; id: string }
  | { kind: "search"; q: string };

const VIDEO_RE = /(?:youtu\.be\/|\/embed\/|\/shorts\/|[?&]v=)([A-Za-z0-9_-]{11})/;
const LIST_RE = /[?&]list=([A-Za-z0-9_-]+)/;
// Only these playlist kinds are fetchable via the API. RD/UL mixes are
// generated on the fly and WL/LM are private, so we ignore those and fall
// back to the single video.
const FETCHABLE_LIST = /^(PL|UU|OL|FL|LL)/;

export function parseYouTubeInput(raw: string): YouTubeInput {
  const text = raw.trim();
  if (!text) return { kind: "search", q: text };

  if (/youtube\.com|youtu\.be/i.test(text)) {
    const list = text.match(LIST_RE)?.[1];
    if (list && FETCHABLE_LIST.test(list)) return { kind: "playlist", id: list };
    const vid = text.match(VIDEO_RE)?.[1];
    if (vid) return { kind: "video", id: vid };
  }

  // Bare ids pasted without a full URL.
  if (FETCHABLE_LIST.test(text) && text.length >= 13) return { kind: "playlist", id: text };
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return { kind: "video", id: text };

  return { kind: "search", q: text };
}
