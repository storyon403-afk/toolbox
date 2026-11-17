//! Sampled on-device screen text. No frame is published as a visual export.
use crate::{
    Error, Result,
    domain::{TextFormat, TimeRange},
    media::{FORMAT_ALLOWLIST, MediaAsset},
    process::MediaTools,
    text::{self, TextSegment, Transcript},
};
use serde::{Deserialize, Serialize};
use std::{ffi::OsString, io::Read, path::PathBuf};
use tokio_util::sync::CancellationToken;

pub fn executable() -> PathBuf {
    std::env::var_os("LINKPARSING_OCR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../build/LinkParsing.app/Contents/MacOS/linkparsing-ocr")
        })
}
pub fn ready() -> bool {
    if !cfg!(target_os = "macos") {
        return false;
    }
    let path = executable();
    path.is_absolute() && path.is_file()
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Cache {
    version: u8,
    sha256: String,
    range: TimeRange,
    interval_ms: u64,
    language: String,
    transcript: Transcript,
}
fn workspace(asset: &MediaAsset) -> Result<&std::path::Path> {
    asset
        .path()
        .parent()
        .and_then(std::path::Path::parent)
        .ok_or(Error::Invalid("missing workspace"))
}
fn cache_path(asset: &MediaAsset) -> Result<PathBuf> {
    Ok(workspace(asset)?.join(format!(".linkparsing-ocr-{}.json", asset.sha256())))
}
fn samples(range: TimeRange, duration: u64, interval: u64) -> Result<Vec<u64>> {
    range.validate(duration)?;
    if !(1000..=3_600_000).contains(&interval) || range.duration_ms().div_ceil(interval) > 300 {
        return Err(Error::Invalid(
            "OCR 间隔须为 1–3600 秒，最多采样 300 帧；请缩短范围或增大间隔。",
        ));
    }
    Ok((range.start_ms..range.end_ms)
        .step_by(interval as usize)
        .collect())
}
fn validate(t: &Transcript, duration: u64) -> Result<()> {
    if t.segments.is_empty() {
        return Err(Error::Invalid(
            "未识别到画面文字，请调整采样范围、间隔或语言。",
        ));
    }
    text::render(
        t,
        TextFormat::Txt,
        TimeRange {
            start_ms: 0,
            end_ms: duration,
        },
        duration,
    )?;
    Ok(())
}
pub fn restore(asset: &MediaAsset) -> Option<Transcript> {
    let path = cache_path(asset).ok()?;
    if !std::fs::symlink_metadata(&path).ok()?.is_file() {
        return None;
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > 8 * 1024 * 1024 {
        return None;
    }
    let cache: Cache = serde_json::from_slice(&bytes).ok()?;
    if cache.version != 1 || cache.sha256 != asset.sha256() {
        return None;
    }
    samples(cache.range, asset.facts().duration_ms, cache.interval_ms).ok()?;
    validate(&cache.transcript, asset.facts().duration_ms).ok()?;
    Some(cache.transcript)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Recognition {
    text: String,
}
fn append(segments: &mut Vec<TextSegment>, text: String, start_ms: u64, end_ms: u64) {
    let text = text.trim();
    if text.is_empty() {
        return;
    }
    if let Some(last) = segments.last_mut() {
        if last.text == text && last.end_ms == start_ms {
            last.end_ms = end_ms;
            return;
        }
    }
    segments.push(TextSegment {
        start_ms,
        end_ms,
        text: text.into(),
    });
}
pub async fn recognize(
    asset: &MediaAsset,
    tools: &MediaTools,
    range: Option<TimeRange>,
    interval_ms: u64,
    language: &str,
    cancel: &CancellationToken,
    progress: impl Fn(usize, usize),
) -> Result<Transcript> {
    if !asset.facts().has_video {
        return Err(Error::Invalid("素材没有视频画面，无法进行 OCR。"));
    }
    if !["zh", "en", "ja", "ko"].contains(&language) {
        return Err(Error::Invalid("请选择支持的 OCR 语言。"));
    }
    if !ready() {
        return Err(Error::Invalid(
            "本地 OCR 引擎未就绪，请重新构建 macOS 应用。",
        ));
    }
    let range = range.unwrap_or(TimeRange {
        start_ms: 0,
        end_ms: asset.facts().duration_ms,
    });
    let times = samples(range, asset.facts().duration_ms, interval_ms)?;
    asset.check_integrity(cancel).await?;
    let temp = tempfile::Builder::new()
        .prefix("ocr-")
        .tempdir_in(workspace(asset)?)?;
    let frame = temp.path().join("frame.png");
    let mut transcript = Transcript {
        segments: Vec::new(),
    };
    let mut total_bytes = 0;
    for (index, time) in times.iter().enumerate() {
        progress(index, times.len());
        let mut args: Vec<OsString> = [
            "-nostdin",
            "-v",
            "error",
            "-y",
            "-threads",
            "2",
            "-protocol_whitelist",
            "file",
            "-format_whitelist",
            FORMAT_ALLOWLIST,
            "-ss",
        ]
        .map(Into::into)
        .to_vec();
        args.extend([
            format!("{}.{:03}", time / 1000, time % 1000).into(),
            "-i".into(),
            asset.path().into(),
        ]);
        args.extend(
            [
                "-map",
                "0:v:0",
                "-frames:v",
                "1",
                "-vf",
                "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease",
                "-threads",
                "2",
            ]
            .map(Into::into),
        );
        args.push(frame.as_os_str().to_owned());
        // Remove the prior frame so a failed/empty seek cannot reuse stale content.
        if frame.exists() {
            std::fs::remove_file(&frame)?;
        }
        tools
            .runner
            .run(&tools.ffmpeg, &args, temp.path(), cancel)
            .await?;
        let bytes = tools
            .runner
            .run(
                &executable(),
                &[frame.as_os_str().to_owned(), language.into()],
                temp.path(),
                cancel,
            )
            .await?;
        let result: Recognition = serde_json::from_slice(&bytes)?;
        total_bytes += result.text.len();
        if result.text.len() > 65536 || total_bytes > 4 * 1024 * 1024 {
            return Err(Error::Invalid("OCR 文字超出大小限制，请缩短范围。"));
        }
        append(
            &mut transcript.segments,
            result.text,
            *time,
            (*time + interval_ms).min(range.end_ms),
        );
    }
    validate(&transcript, asset.facts().duration_ms)?;
    let saved = Cache {
        version: 1,
        sha256: asset.sha256().into(),
        range,
        interval_ms,
        language: language.into(),
        transcript: transcript.clone(),
    };
    let file = tempfile::NamedTempFile::new_in(workspace(asset)?)?;
    serde_json::to_writer(file.as_file(), &saved)?;
    file.as_file().sync_all()?;
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    file.persist(cache_path(asset)?)
        .map_err(|e| Error::from(e.error))?;
    progress(times.len(), times.len());
    Ok(transcript)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_sampling_and_half_open_range() {
        assert_eq!(
            samples(
                TimeRange {
                    start_ms: 500,
                    end_ms: 2501
                },
                3000,
                1000
            )
            .unwrap(),
            vec![500, 1500, 2500]
        );
        for (end, step) in [(301000, 1000), (1000, 0), (1000, 999), (1000, u64::MAX)] {
            assert!(
                samples(
                    TimeRange {
                        start_ms: 0,
                        end_ms: end
                    },
                    400000,
                    step
                )
                .is_err()
            );
        }
    }
    #[test]
    fn duplicates_merge_only_across_adjacent_observations() {
        let mut segments = vec![];
        append(&mut segments, " A ".into(), 0, 1000);
        append(&mut segments, "A".into(), 1000, 2000);
        append(&mut segments, "".into(), 2000, 3000);
        append(&mut segments, "A".into(), 3000, 4000);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].end_ms, 2000);
        assert!(validate(&Transcript { segments: vec![] }, 1000).is_err());
    }
}
