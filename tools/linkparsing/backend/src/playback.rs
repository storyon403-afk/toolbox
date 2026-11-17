//! Private full-length playback copy for the macOS player. Never used for export.
use crate::{
    Error, Result,
    media::{FORMAT_ALLOWLIST, MediaAsset},
    process::MediaTools,
};
use serde::Deserialize;
use std::{ffi::OsString, path::PathBuf};
use tokio_util::sync::CancellationToken;

#[derive(Deserialize)]
struct Probe {
    streams: Vec<Stream>,
}
#[derive(Deserialize)]
struct Stream {
    codec_type: String,
    codec_name: Option<String>,
    pix_fmt: Option<String>,
}

pub async fn prepare(
    asset: &MediaAsset,
    tools: &MediaTools,
    cancel: &CancellationToken,
    progress: impl Fn(&str),
) -> Result<(PathBuf, bool)> {
    asset.check_integrity(cancel).await?;
    let parent = asset
        .path()
        .parent()
        .ok_or(Error::Invalid("missing source directory"))?;
    let mut args: Vec<OsString> = [
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-format_whitelist",
        FORMAT_ALLOWLIST,
        "-show_entries",
        "stream=codec_type,codec_name,pix_fmt",
        "-of",
        "json",
    ]
    .map(Into::into)
    .to_vec();
    args.push(asset.path().into());
    let probe: Probe = serde_json::from_slice(
        &tools
            .runner
            .run(&tools.ffprobe, &args, parent, cancel)
            .await?,
    )?;
    let compatible_container =
        ["mp4", "m4v", "mov", "m4a", "mp3", "wav"].contains(&asset.extension());
    let compatible = compatible_container
        && probe.streams.iter().all(|s| match s.codec_type.as_str() {
            "video" => {
                s.codec_name.as_deref() == Some("h264") && s.pix_fmt.as_deref() == Some("yuv420p")
            }
            "audio" => matches!(s.codec_name.as_deref(), Some("aac" | "mp3" | "pcm_s16le")),
            _ => true,
        });
    if compatible {
        return Ok((asset.path().into(), false));
    }
    let output = parent.join("playback.mp4");
    if output.is_file() {
        return Ok((output, true));
    }
    progress("preparing_playback");
    let temp = tempfile::Builder::new()
        .prefix("playback-")
        .tempdir_in(parent)?;
    let partial = temp.path().join("playback.mp4");
    let mut args: Vec<OsString> = [
        "-nostdin",
        "-v",
        "error",
        "-threads",
        "2",
        "-protocol_whitelist",
        "file",
        "-format_whitelist",
        FORMAT_ALLOWLIST,
        "-i",
    ]
    .map(Into::into)
    .to_vec();
    args.push(asset.path().into());
    args.extend(
        [
            "-map",
            "0:v:0?",
            "-map",
            "0:a:0?",
            "-sn",
            "-dn",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-vf",
            "pad=ceil(iw/2)*2:ceil(ih/2)*2",
            "-threads",
            "2",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
        ]
        .map(Into::into),
    );
    args.push(partial.as_os_str().to_owned());
    tools
        .runner
        .run(&tools.ffmpeg, &args, temp.path(), cancel)
        .await?;
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    std::fs::rename(partial, &output)?;
    Ok((output, true))
}
