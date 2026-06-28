//! Lossless MP3 editing: cut frames out of an MP3 without decoding or re-encoding.
//! All edits land on frame boundaries (~26 ms), so audio quality is byte-for-byte
//! preserved except for the bit-reservoir pointer zeroed at each cut seam.

/// MPEG version of a frame (Layer III only; the app rejects other layers).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MpegVersion {
    V1,   // MPEG-1  → 1152 samples/frame
    V2,   // MPEG-2  → 576 samples/frame
    V25,  // MPEG-2.5
}

#[derive(Debug, Clone, Copy)]
pub struct FrameHeader {
    pub version: MpegVersion,
    pub sample_rate: u32,
    pub samples: u32,   // samples per frame (1152 or 576)
    pub frame_len: usize, // total frame size in bytes (header + side info + main data)
    pub side_info: usize, // side-info size in bytes (after the 4-byte header)
    pub mono: bool,
}

// Layer III bitrate tables (kbps), indexed by the 4-bit bitrate index.
const BR_V1_L3: [u32; 16] = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BR_V2_L3: [u32; 16] = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
// Sample-rate tables, indexed by the 2-bit sample-rate index. Rows: V1, V2, V2.5.
const SR_V1: [u32; 3] = [44100, 48000, 32000];
const SR_V2: [u32; 3] = [22050, 24000, 16000];
const SR_V25: [u32; 3] = [11025, 12000, 8000];

impl FrameHeader {
    /// Parse a 4-byte Layer-III header. Returns None if it isn't a valid LIII frame.
    pub fn parse(b: &[u8]) -> Option<FrameHeader> {
        if b.len() < 4 || b[0] != 0xFF || (b[1] & 0xE0) != 0xE0 {
            return None; // no frame sync
        }
        let version = match (b[1] >> 3) & 0x03 {
            0 => MpegVersion::V25,
            2 => MpegVersion::V2,
            3 => MpegVersion::V1,
            _ => return None, // 1 = reserved
        };
        if (b[1] >> 1) & 0x03 != 0x01 {
            return None; // not Layer III
        }
        let br_index = ((b[2] >> 4) & 0x0F) as usize;
        let sr_index = ((b[2] >> 2) & 0x03) as usize;
        let padding = ((b[2] >> 1) & 0x01) as usize;
        if br_index == 0 || br_index == 15 || sr_index == 3 {
            return None; // free-format / bad / reserved — unsupported
        }
        let mono = ((b[3] >> 6) & 0x03) == 0x03;
        let (bitrate, sample_rate, samples) = match version {
            MpegVersion::V1 => (BR_V1_L3[br_index] * 1000, SR_V1[sr_index], 1152),
            MpegVersion::V2 => (BR_V2_L3[br_index] * 1000, SR_V2[sr_index], 576),
            MpegVersion::V25 => (BR_V2_L3[br_index] * 1000, SR_V25[sr_index], 576),
        };
        // Layer III frame length. MPEG-1: 144*br/sr; MPEG-2/2.5: 72*br/sr. (+padding bytes)
        let coef = if version == MpegVersion::V1 { 144 } else { 72 };
        let frame_len = (coef * bitrate as usize / sample_rate as usize) + padding;
        let side_info = match (version, mono) {
            (MpegVersion::V1, true) => 17,
            (MpegVersion::V1, false) => 32,
            (_, true) => 9,
            (_, false) => 17,
        };
        Some(FrameHeader { version, sample_rate, samples, frame_len, side_info, mono })
    }
}

/// One parsed audio frame's position and decode-relevant fields.
#[derive(Debug, Clone, Copy)]
pub struct Frame {
    pub offset: usize,        // byte offset of the frame in the buffer
    pub len: usize,           // frame byte length
    pub samples: u32,         // samples in this frame
    pub sample_rate: u32,
    pub side_info: usize,
    pub version: MpegVersion,
    pub main_data_begin: u16, // bit-reservoir back-pointer (0 = self-contained)
}

impl Frame {
    pub fn duration(&self) -> f64 {
        self.samples as f64 / self.sample_rate as f64
    }
}

/// If the buffer starts with an ID3v2 tag, return the byte offset just past it
/// (where audio frames begin). Otherwise return 0.
pub fn skip_id3v2(buf: &[u8]) -> usize {
    if buf.len() < 10 || &buf[0..3] != b"ID3" {
        return 0;
    }
    // 28-bit syncsafe size in bytes 6..10 (7 bits each).
    let size = ((buf[6] & 0x7F) as usize) << 21
        | ((buf[7] & 0x7F) as usize) << 14
        | ((buf[8] & 0x7F) as usize) << 7
        | (buf[9] & 0x7F) as usize;
    let footer = if buf[5] & 0x10 != 0 { 10 } else { 0 }; // footer-present flag
    10 + size + footer
}

/// Walk Layer-III frames from `start`. Stops at the first non-frame byte (e.g. an
/// ID3v1 trailer or garbage), which is the correct lossless boundary.
pub fn walk_frames(buf: &[u8], start: usize) -> Vec<Frame> {
    let mut frames = Vec::new();
    let mut pos = start;
    while pos + 4 <= buf.len() {
        let h = match FrameHeader::parse(&buf[pos..pos + 4]) {
            Some(h) => h,
            None => break,
        };
        if pos + h.frame_len > buf.len() {
            break; // truncated final frame
        }
        let mdb = read_main_data_begin(&buf[pos..], h.version);
        frames.push(Frame {
            offset: pos,
            len: h.frame_len,
            samples: h.samples,
            sample_rate: h.sample_rate,
            side_info: h.side_info,
            version: h.version,
            main_data_begin: mdb,
        });
        pos += h.frame_len;
    }
    frames
}

/// main_data_begin: 9 bits (MPEG-1) or 8 bits (MPEG-2/2.5) at the start of the side info.
fn read_main_data_begin(frame: &[u8], version: MpegVersion) -> u16 {
    match version {
        MpegVersion::V1 => ((frame[4] as u16) << 1) | ((frame[5] >> 7) as u16),
        _ => frame[4] as u16,
    }
}

/// Zero the bit-reservoir back-pointer in place so this frame decodes self-contained
/// (used on the first kept frame after a cut, to avoid referencing removed data).
fn zero_main_data_begin(frame: &mut [u8], version: MpegVersion) {
    match version {
        MpegVersion::V1 => {
            frame[4] = 0;
            frame[5] &= 0x7F;
        }
        _ => frame[4] = 0,
    }
}

/// Locations of the mutable fields inside a Xing/Info header frame.
#[derive(Debug, Clone, Copy)]
pub struct XingInfo {
    pub has_frames: bool,
    pub has_bytes: bool,
    pub has_toc: bool,
    pub frame_count_offset: usize, // absolute offset within the frame buffer
    pub byte_count_offset: usize,
    pub toc_offset: usize,
}

/// Detect a Xing/Info header in a frame. `hdr`=4, `side`=side-info size.
pub fn parse_xing(frame: &[u8], hdr: usize, side: usize) -> Option<XingInfo> {
    let tag = hdr + side;
    if frame.len() < tag + 8 {
        return None;
    }
    if &frame[tag..tag + 4] != b"Xing" && &frame[tag..tag + 4] != b"Info" {
        return None;
    }
    let flags = frame[tag + 7]; // flags are the last byte of the 4-byte flags field
    let has_frames = flags & 0x01 != 0;
    let has_bytes = flags & 0x02 != 0;
    let has_toc = flags & 0x04 != 0;
    let mut off = tag + 8; // past tag(4) + flags(4)
    let frame_count_offset = off;
    if has_frames { off += 4; }
    let byte_count_offset = off;
    if has_bytes { off += 4; }
    let toc_offset = off;
    Some(XingInfo { has_frames, has_bytes, has_toc, frame_count_offset, byte_count_offset, toc_offset })
}

/// Overwrite the frame/byte counts in a Xing header frame.
pub fn update_xing(frame: &mut [u8], info: &XingInfo, frame_count: u32, byte_count: u32) {
    if info.has_frames {
        frame[info.frame_count_offset..info.frame_count_offset + 4]
            .copy_from_slice(&frame_count.to_be_bytes());
    }
    if info.has_bytes {
        frame[info.byte_count_offset..info.byte_count_offset + 4]
            .copy_from_slice(&byte_count.to_be_bytes());
    }
}

/// Rebuild the 100-entry TOC so each byte i maps percent-of-duration → percent-of-bytes
/// (256ths) using the kept frames' real offsets. `stream_len` = total audio byte length.
pub fn rebuild_xing_toc(frame: &mut [u8], info: &XingInfo, frame_byte_offsets: &[usize], stream_len: usize) {
    if !info.has_toc || stream_len == 0 || frame_byte_offsets.is_empty() {
        return;
    }
    for i in 0..100 {
        let target = i * frame_byte_offsets.len() / 100;
        let byte_off = frame_byte_offsets[target.min(frame_byte_offsets.len() - 1)];
        let v = (byte_off * 256 / stream_len).min(255) as u8;
        frame[info.toc_offset + i] = v;
    }
}

/// Cut `(start,end)` second ranges out of an MP3 buffer, losslessly. Returns the new
/// file bytes: [ID3v2 tag][updated Xing frame][kept audio frames][ID3v1 trailer].
pub fn cut_mp3(buf: &[u8], cuts: &[(f64, f64)]) -> Result<Vec<u8>, String> {
    let audio_start = skip_id3v2(buf);
    let frames = walk_frames(buf, audio_start);
    if frames.is_empty() {
        return Err("no MP3 frames found".into());
    }

    // Detect a leading Xing/Info header frame — it is NOT audio and is never cut.
    let first = &frames[0];
    let xing = parse_xing(&buf[first.offset..first.offset + first.len], 4, first.side_info);
    let audio_frames = if xing.is_some() { &frames[1..] } else { &frames[..] };

    // Merge + sort the delete ranges.
    let mut ranges: Vec<(f64, f64)> = cuts.iter().filter(|(a, b)| b > a).cloned().collect();
    ranges.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

    // Walk audio frames, keeping those whose midpoint is outside every delete range.
    let mut kept: Vec<&Frame> = Vec::new();
    let mut t = 0.0f64;
    let mut prev_kept = true;
    let mut seam_zero: Vec<usize> = Vec::new(); // indices into `kept` needing mdb=0
    for f in audio_frames {
        let mid = t + f.duration() / 2.0;
        let cut = ranges.iter().any(|(a, b)| mid >= *a && mid < *b);
        if !cut {
            if !prev_kept {
                seam_zero.push(kept.len()); // first kept frame after a gap
            }
            kept.push(f);
            prev_kept = true;
        } else {
            prev_kept = false;
        }
        t += f.duration();
    }
    if kept.is_empty() {
        return Err("nothing left after cutting".into());
    }

    // Assemble output. Start with the ID3v2 tag (verbatim).
    let mut out: Vec<u8> = Vec::with_capacity(buf.len());
    out.extend_from_slice(&buf[0..audio_start]);

    // The stream portion (for Xing byte/TOC math) begins here.
    let stream_start = out.len();
    let mut xing_frame_range: Option<(usize, XingInfo)> = None;
    if let Some(info) = xing {
        let start = out.len();
        out.extend_from_slice(&buf[first.offset..first.offset + first.len]);
        xing_frame_range = Some((start, info));
    }

    // Kept audio frames, recording each one's output offset for the TOC.
    let mut frame_offsets: Vec<usize> = Vec::new();
    for (i, f) in kept.iter().enumerate() {
        let start = out.len();
        frame_offsets.push(start - stream_start);
        out.extend_from_slice(&buf[f.offset..f.offset + f.len]);
        if seam_zero.contains(&i) {
            let s = start;
            zero_main_data_begin(&mut out[s..s + f.len.min(8)], f.version);
        }
    }

    // Xing "Bytes" + TOC denominator must count only the audio stream (Xing frame +
    // kept audio frames), NOT a trailing ID3v1 tag — so capture the length now.
    let stream_len = out.len() - stream_start;

    // Preserve a trailing ID3v1 tag if present (last 128 bytes starting with "TAG").
    if buf.len() >= 128 && &buf[buf.len() - 128..buf.len() - 125] == b"TAG" {
        out.extend_from_slice(&buf[buf.len() - 128..]);
    }

    // Update the Xing header to match the new stream. The rewrite window is the Xing
    // frame's OWN length (it lives at `start`); on VBR the first kept audio frame can be
    // a different size, so using `kept[0].len` here would mis-size the window (and can
    // panic when a short low-bitrate first frame is smaller than the 100-byte TOC span).
    if let Some((start, info)) = xing_frame_range {
        let frame_len = first.len;
        let mut xing_buf = out[start..start + frame_len].to_vec();
        update_xing(&mut xing_buf, &info, kept.len() as u32, stream_len as u32);
        rebuild_xing_toc(&mut xing_buf, &info, &frame_offsets, stream_len);
        out[start..start + frame_len].copy_from_slice(&xing_buf);
    }

    Ok(out)
}

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mp3Probe {
    pub is_mp3: bool,
    pub duration_sec: f64,
    pub sample_rate: u32,
    pub frame_count: usize,
}

/// Probe a file: confirm it parses as MP3 and report its duration + frame count.
pub fn probe(path: &str) -> Result<Mp3Probe, String> {
    let buf = std::fs::read(path).map_err(|e| e.to_string())?;
    let frames = walk_frames(&buf, skip_id3v2(&buf));
    if frames.is_empty() {
        return Ok(Mp3Probe { is_mp3: false, duration_sec: 0.0, sample_rate: 0, frame_count: 0 });
    }
    let duration_sec = frames.iter().map(|f| f.duration()).sum();
    Ok(Mp3Probe {
        is_mp3: true,
        duration_sec,
        sample_rate: frames[0].sample_rate,
        frame_count: frames.len(),
    })
}

/// Cut a file and write the result. `out` may equal `path` (overwrite); the write is
/// always temp-file + atomic rename so a crash mid-write never corrupts the source.
pub fn write_cut(path: &str, cuts: &[(f64, f64)], out: &str) -> Result<(), String> {
    let buf = std::fs::read(path).map_err(|e| e.to_string())?;
    let result = cut_mp3(&buf, cuts)?;
    let tmp = format!("{out}.boxcast.tmp");
    std::fs::write(&tmp, &result).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, out).map_err(|e| e.to_string())?;
    Ok(())
}

// ---- Tauri commands ----

#[tauri::command]
pub fn mp3_probe(path: String) -> Result<Mp3Probe, String> {
    probe(&path)
}

#[tauri::command]
pub fn mp3_cut(path: String, cuts: Vec<(f64, f64)>, out: String) -> Result<(), String> {
    write_cut(&path, &cuts, &out)
}

use tauri::State;
use crate::state::AppState;

/// Send a track's file to the OS Trash (reversible) and delete its library row.
#[tauri::command]
pub fn track_trash(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let path = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        crate::library::track_path(&conn, id).map_err(|e| e.to_string())?
    };
    trash::delete(&path).map_err(|e| e.to_string())?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::library::track_delete(&conn, id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mpeg1_l3_128k_44100_stereo() {
        // FF FB 90 00 = MPEG1, Layer III, no CRC, 128kbps, 44100Hz, stereo, no padding.
        let h = FrameHeader::parse(&[0xFF, 0xFB, 0x90, 0x00]).unwrap();
        assert_eq!(h.version, MpegVersion::V1);
        assert_eq!(h.sample_rate, 44100);
        assert_eq!(h.samples, 1152);
        assert_eq!(h.side_info, 32);
        assert_eq!(h.mono, false);
        // 144 * 128000 / 44100 = 417 (no padding)
        assert_eq!(h.frame_len, 417);
    }

    #[test]
    fn rejects_non_frame_and_non_layer3() {
        assert!(FrameHeader::parse(&[0x00, 0x00, 0x00, 0x00]).is_none());
        // FF F5 .. = Layer II (layer bits 10) → rejected
        assert!(FrameHeader::parse(&[0xFF, 0xF5, 0x90, 0x00]).is_none());
    }

    /// Build one MPEG1 LIII 128k/44100 stereo frame (417 bytes). `mdb` sets the
    /// 9-bit main_data_begin in the side info so we can test seam zeroing.
    fn synth_frame(mdb: u16) -> Vec<u8> {
        let mut f = vec![0u8; 417];
        f[0] = 0xFF; f[1] = 0xFB; f[2] = 0x90; f[3] = 0x00;
        // main_data_begin = top 9 bits of the side info (bytes 4 and 5).
        f[4] = (mdb >> 1) as u8;
        f[5] = ((mdb & 1) << 7) as u8;
        f
    }

    fn synth_stream(n: usize) -> Vec<u8> {
        let mut v = Vec::new();
        for _ in 0..n { v.extend_from_slice(&synth_frame(0)); }
        v
    }

    #[test]
    fn skips_id3v2_then_walks_all_frames() {
        let mut buf = Vec::new();
        // ID3v2 tag: "ID3", ver(2), flags(1), syncsafe size = 20 → 10-byte header + 20 body.
        buf.extend_from_slice(b"ID3\x03\x00\x00\x00\x00\x00\x14");
        buf.extend_from_slice(&[0u8; 20]);
        let audio_start = buf.len();
        buf.extend_from_slice(&synth_stream(5));

        assert_eq!(skip_id3v2(&buf), audio_start);
        let frames = walk_frames(&buf, audio_start);
        assert_eq!(frames.len(), 5);
        assert_eq!(frames[0].offset, audio_start);
        assert_eq!(frames[1].offset, audio_start + 417);
        // total duration = 5 * 1152 / 44100
        let dur: f64 = frames.iter().map(|f| f.duration()).sum();
        assert!((dur - 5.0 * 1152.0 / 44100.0).abs() < 1e-9);
    }

    #[test]
    fn zeroes_main_data_begin() {
        let mut f = synth_frame(511); // max 9-bit reservoir pointer
        assert_eq!(read_main_data_begin(&f, MpegVersion::V1), 511);
        zero_main_data_begin(&mut f, MpegVersion::V1);
        assert_eq!(read_main_data_begin(&f, MpegVersion::V1), 0);
    }

    /// Build a Xing header frame: a normal 417-byte frame whose body holds
    /// "Xing", flags=0b0011 (frames+bytes), frame_count, byte_count.
    fn synth_xing(frame_count: u32, byte_count: u32) -> Vec<u8> {
        let mut f = synth_frame(0);
        let tag = 4 + 32; // header(4) + MPEG1 stereo side info(32)
        f[tag..tag + 4].copy_from_slice(b"Xing");
        f[tag + 4..tag + 8].copy_from_slice(&[0, 0, 0, 0b0011]);
        f[tag + 8..tag + 12].copy_from_slice(&frame_count.to_be_bytes());
        f[tag + 12..tag + 16].copy_from_slice(&byte_count.to_be_bytes());
        f
    }

    #[test]
    fn detects_and_updates_xing() {
        let frame = synth_xing(999, 123456);
        let info = parse_xing(&frame, 4, 32).unwrap();
        assert_eq!(info.frame_count_offset, 36 + 8);
        assert_eq!(info.byte_count_offset, 36 + 12);

        let mut frame2 = frame.clone();
        update_xing(&mut frame2, &info, 42, 777);
        let fc = u32::from_be_bytes(frame2[info.frame_count_offset..info.frame_count_offset + 4].try_into().unwrap());
        let bc = u32::from_be_bytes(frame2[info.byte_count_offset..info.byte_count_offset + 4].try_into().unwrap());
        assert_eq!(fc, 42);
        assert_eq!(bc, 777);
    }

    #[test]
    fn cut_removes_frame_range_and_preserves_id3() {
        // ID3v2(10+4) + 10 plain frames. Each frame ≈ 0.0261 s. Cut frames 2,3,4
        // (≈ 0.052s..0.131s).
        let mut buf = Vec::new();
        buf.extend_from_slice(b"ID3\x03\x00\x00\x00\x00\x00\x04");
        buf.extend_from_slice(&[0xAB; 4]); // recognizable tag body
        buf.extend_from_slice(&synth_stream(10));

        let one = 1152.0 / 44100.0;
        let out = cut_mp3(&buf, &[(2.0 * one, 5.0 * one)]).unwrap();

        // ID3 tag preserved byte-for-byte at the front.
        assert_eq!(&out[0..14], &buf[0..14]);
        // 10 frames − 3 cut = 7 frames remain.
        let frames = walk_frames(&out, skip_id3v2(&out));
        assert_eq!(frames.len(), 7);
        // First kept frame after the cut (originally frame #5) has mdb zeroed — here all
        // synth frames already have mdb 0, so just assert it stays a clean stream.
        assert!(frames.iter().all(|f| f.main_data_begin == 0));
    }

    #[test]
    fn cut_updates_xing_frame_count() {
        let mut buf = synth_xing(8, 0); // claims 8 audio frames
        buf.extend_from_slice(&synth_stream(8)); // 1 Xing frame + 8 audio frames
        let one = 1152.0 / 44100.0;
        // drop 2 audio frames (the cut maps onto audio frames after the Xing frame)
        let out = cut_mp3(&buf, &[(1.0 * one, 3.0 * one)]).unwrap();
        let info = parse_xing(&out, 4, 32).unwrap();
        let fc = u32::from_be_bytes(out[info.frame_count_offset..info.frame_count_offset + 4].try_into().unwrap());
        assert_eq!(fc, 6); // 8 − 2, not counting the Xing frame
    }

    /// A 32 kbps MPEG1 LIII 44100 stereo frame = 104 bytes (144*32000/44100). Header FF FB 10 00.
    fn synth_frame_32k() -> Vec<u8> {
        let mut f = vec![0u8; 104];
        f[0] = 0xFF; f[1] = 0xFB; f[2] = 0x10; f[3] = 0x00;
        f
    }

    /// A Xing header frame (417 bytes, 128k) WITH the TOC flag set (flags = 0b0111).
    fn synth_xing_toc(frame_count: u32, byte_count: u32) -> Vec<u8> {
        let mut f = synth_frame(0);
        let tag = 4 + 32;
        f[tag..tag + 4].copy_from_slice(b"Xing");
        f[tag + 4..tag + 8].copy_from_slice(&[0, 0, 0, 0b0111]); // frames + bytes + TOC
        f[tag + 8..tag + 12].copy_from_slice(&frame_count.to_be_bytes());
        f[tag + 12..tag + 16].copy_from_slice(&byte_count.to_be_bytes());
        f
    }

    #[test]
    fn cut_vbr_with_toc_and_short_first_frame_does_not_panic() {
        // Xing(TOC) frame + 6 short 32k audio frames. Cutting the first audio frame leaves
        // a 104-byte first kept frame — smaller than the 100-entry TOC span. Under the old
        // window sizing (kept[0].len) rebuild_xing_toc indexed out of bounds and panicked.
        let mut buf = synth_xing_toc(6, 0);
        for _ in 0..6 { buf.extend_from_slice(&synth_frame_32k()); }
        let one = 1152.0 / 44100.0; // each 32k frame is still 1152 samples @ 44100
        let out = cut_mp3(&buf, &[(0.0, 1.0 * one)]).unwrap(); // drop the first audio frame
        // Xing frame preserved + valid, and the result re-parses cleanly.
        let info = parse_xing(&out, 4, 32).unwrap();
        let fc = u32::from_be_bytes(out[info.frame_count_offset..info.frame_count_offset + 4].try_into().unwrap());
        assert_eq!(fc, 5); // 6 audio frames − 1 cut
        let frames = walk_frames(&out, skip_id3v2(&out));
        assert_eq!(frames.len(), 6); // 1 Xing frame + 5 kept audio frames
    }

    #[test]
    fn probe_reports_frames_and_duration() {
        let mut buf = Vec::new();
        buf.extend_from_slice(&synth_stream(20));
        let dir = std::env::temp_dir();
        let p = dir.join("boxcast_probe_test.mp3");
        std::fs::write(&p, &buf).unwrap();
        let info = probe(p.to_str().unwrap()).unwrap();
        assert!(info.is_mp3);
        assert_eq!(info.frame_count, 20);
        assert!((info.duration_sec - 20.0 * 1152.0 / 44100.0).abs() < 1e-6);
        std::fs::remove_file(&p).ok();
    }
}
