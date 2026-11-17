//! Local speech recognition. Media and intermediate files stay in the selected workspace.
use crate::{
    Error, Result,
    domain::{TextFormat, TimeRange},
    media::{FORMAT_ALLOWLIST, MediaAsset},
    process::{MediaTools, ToolRunner},
    text::{self, TextSegment, Transcript},
};
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsString,
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

pub struct AsrTools {
    pub executable: PathBuf,
    pub model: PathBuf,
}

impl AsrTools {
    pub fn configured() -> Self {
        Self {
            executable: std::env::var_os("LINKPARSING_WHISPER")
                .map(PathBuf::from)
                .unwrap_or_else(|| crate::runtime::tool("whisper-cli")),
            model: std::env::var_os("LINKPARSING_ASR_MODEL")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    crate::runtime::model_directory().join("ggml-large-v3-turbo-q5_0.bin")
                }),
        }
    }
    pub fn ready(&self) -> bool {
        self.executable.is_absolute()
            && self.executable.is_file()
            && self.model.is_absolute()
            && self
                .model
                .metadata()
                .is_ok_and(|m| m.is_file() && m.len() > 1_000_000)
    }
}

#[derive(Deserialize)]
struct WhisperOutput {
    transcription: Vec<WhisperSegment>,
}
#[derive(Deserialize)]
struct WhisperSegment {
    offsets: Offsets,
    text: String,
}
#[derive(Deserialize)]
struct Offsets {
    from: u64,
    to: u64,
}

fn normalize(bytes: &[u8], duration_ms: u64) -> Result<Transcript> {
    let output: WhisperOutput = serde_json::from_slice(bytes)?;
    let mut segments = Vec::new();
    let mut previous = 0;
    for segment in output.transcription {
        if segment.offsets.to < segment.offsets.from || segment.offsets.from < previous {
            return Err(Error::Invalid("转写引擎返回了无效时间轴，请重试。"));
        }
        previous = segment.offsets.from;
        let text = segment.text.trim().to_owned();
        let end_ms = segment.offsets.to.min(duration_ms);
        if text.is_empty() || segment.offsets.from >= end_ms {
            continue;
        }
        segments.push(TextSegment {
            start_ms: segment.offsets.from,
            end_ms,
            text,
        });
    }
    if segments.is_empty() {
        return Err(Error::Invalid(
            "没有识别到可导出的语音，请检查音轨或更换识别语言。",
        ));
    }
    let transcript = Transcript { segments };
    validate(&transcript, duration_ms)?;
    Ok(transcript)
}

fn validate(transcript: &Transcript, duration_ms: u64) -> Result<()> {
    text::render(
        transcript,
        TextFormat::Txt,
        TimeRange {
            start_ms: 0,
            end_ms: duration_ms,
        },
        duration_ms,
    )?;
    Ok(())
}

fn workspace(asset: &MediaAsset) -> Result<&Path> {
    asset
        .path()
        .parent()
        .and_then(Path::parent)
        .ok_or(Error::Invalid("missing source workspace"))
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SavedTranscript {
    version: u8,
    sha256: String,
    language: String,
    transcript: Transcript,
}

fn cache_path(asset: &MediaAsset) -> Result<PathBuf> {
    Ok(workspace(asset)?.join(format!(".linkparsing-transcript-{}.json", asset.sha256())))
}

fn read_limited(path: &Path) -> Result<Vec<u8>> {
    if !std::fs::symlink_metadata(path)?.is_file() {
        return Err(Error::Invalid("invalid transcript file"));
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(16 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err(Error::Invalid("transcript output exceeds limit"));
    }
    Ok(bytes)
}

pub fn restore(asset: &MediaAsset) -> Option<Transcript> {
    let saved: SavedTranscript =
        serde_json::from_slice(&read_limited(&cache_path(asset).ok()?).ok()?).ok()?;
    if saved.version != 1 || saved.sha256 != asset.sha256() {
        return None;
    }
    validate(&saved.transcript, asset.facts().duration_ms).ok()?;
    Some(saved.transcript)
}

pub async fn transcribe(
    asset: &MediaAsset,
    tools: &MediaTools,
    asr: &AsrTools,
    language: &str,
    cancel: &CancellationToken,
    progress: impl Fn(&str),
) -> Result<Transcript> {
    if !["auto", "zh", "en", "ja", "ko"].contains(&language) {
        return Err(Error::Invalid("请选择支持的识别语言。"));
    }
    if !asset.facts().has_audio {
        return Err(Error::Invalid("素材没有音轨，无法进行语音转写。"));
    }
    if !asr.ready() {
        return Err(Error::Invalid(
            "本地转写引擎或模型未就绪，请查看设置中的安装说明。",
        ));
    }
    progress("preparing");
    asset.check_integrity(cancel).await?;
    let temp = tempfile::Builder::new()
        .prefix("asr-")
        .tempdir_in(workspace(asset)?)?;
    let wav = temp.path().join("audio.wav");
    let mut args: Vec<OsString> = [
        "-nostdin",
        "-v",
        "error",
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
            "0:a:0",
            "-vn",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
        ]
        .map(Into::into),
    );
    args.push(wav.as_os_str().to_owned());
    tools
        .runner
        .run(&tools.ffmpeg, &args, temp.path(), cancel)
        .await?;
    progress("recognizing");
    let output = temp.path().join("recognition");
    let mut args: Vec<OsString> = ["-m"].map(Into::into).to_vec();
    args.push(asr.model.as_os_str().to_owned());
    args.extend([
        "-f".into(),
        wav.into_os_string(),
        "-of".into(),
        output.as_os_str().to_owned(),
    ]);
    args.extend(
        [
            "-oj", "-np", "-l", language, "-t", "4", "-bs", "1", "-bo", "1", "-sns",
        ]
        .map(Into::into),
    );
    if language == "zh" {
        args.extend(["--prompt", "以下是普通话内容，请使用简体中文。"].map(Into::into));
    }
    ToolRunner::new(1, Duration::from_secs(3600))?
        .run(&asr.executable, &args, temp.path(), cancel)
        .await?;
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    progress("saving");
    let transcript = normalize(
        &read_limited(&output.with_extension("json"))?,
        asset.facts().duration_ms,
    )?;
    let saved = SavedTranscript {
        version: 1,
        sha256: asset.sha256().into(),
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
    // TempDir removes decoded audio and engine JSON on success, error and cancellation.
    Ok(transcript)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn timestamps_remain_milliseconds_and_final_rounding_is_clamped() {
        let t = normalize(
            br#"{"transcription":[{"offsets":{"from":120,"to":1010},"text":" example "}]}"#,
            1001,
        )
        .unwrap();
        assert_eq!(t.segments[0].start_ms, 120);
        assert_eq!(t.segments[0].end_ms, 1001);
        assert_eq!(t.segments[0].text, "example");
    }
    #[test]
    fn invalid_or_empty_recognition_is_not_success() {
        for bytes in [
            br#"{"transcription":[]}"#.as_slice(),
            br#"{"transcription":[{"offsets":{"from":900,"to":100},"text":"x"}]}"#,
            br#"{"transcription":[{"offsets":{"from":0,"to":100},"text":"\u0000"}]}"#,
        ] {
            assert!(normalize(bytes, 1000).is_err());
        }
    }
}
