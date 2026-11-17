use crate::{
    Error, Result,
    domain::{MAX_DURATION_MS, MediaFacts, SourceReview, WatermarkState},
    process::MediaTools,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;

pub(crate) const FORMAT_ALLOWLIST: &str = "mov,matroska,webm,avi,wav,mp3,flac,ogg";
const MAX_INPUT_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// Only import can construct an asset. Owns a private snapshot, not a caller-controlled pathname.
pub struct MediaAsset {
    _directory: TempDir,
    path: PathBuf,
    sha256: String,
    extension: String,
    facts: MediaFacts,
    review: Option<SourceReview>,
}
impl MediaAsset {
    pub fn facts(&self) -> &MediaFacts {
        &self.facts
    }
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
    pub(crate) fn extension(&self) -> &str {
        &self.extension
    }
    pub fn watermark_state(&self) -> WatermarkState {
        self.review
            .as_ref()
            .filter(|r| r.sha256 == self.sha256)
            .map_or(WatermarkState::Unknown, |r| r.state)
    }
    pub fn record_review(&mut self, review: SourceReview) -> Result<()> {
        if review.sha256 != self.sha256 {
            return Err(Error::Invalid("review belongs to a different source"));
        }
        self.review = Some(review);
        Ok(())
    }
    pub async fn check_integrity(&self, cancel: &CancellationToken) -> Result<()> {
        let path = self.path.clone();
        let token = cancel.clone();
        let digest = tokio::task::spawn_blocking(move || hash_file(&path, &token))
            .await
            .map_err(|_| Error::Cancelled)??;
        if digest != self.sha256 {
            return Err(Error::Invalid("imported media changed after review"));
        }
        Ok(())
    }
}

pub async fn import_local(
    source: &Path,
    workspace: &Path,
    tools: &MediaTools,
    cancel: &CancellationToken,
) -> Result<MediaAsset> {
    let source = source.to_owned();
    let workspace = workspace.to_owned();
    let token = cancel.clone();
    let (directory, path, extension, sha256) =
        tokio::task::spawn_blocking(move || snapshot(&source, &workspace, &token))
            .await
            .map_err(|_| Error::Cancelled)??;
    let facts = probe(&path, tools, cancel).await?;
    Ok(MediaAsset {
        _directory: directory,
        path,
        extension,
        sha256,
        facts,
        review: None,
    })
}

fn snapshot(
    source: &Path,
    workspace: &Path,
    cancel: &CancellationToken,
) -> Result<(TempDir, PathBuf, String, String)> {
    let meta = fs::symlink_metadata(source)?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_INPUT_BYTES {
        return Err(Error::Invalid(
            "source must be a regular media file of at most 4 GiB",
        ));
    }
    let extension = source
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ![
        "mp4", "mov", "m4v", "mkv", "webm", "avi", "wav", "mp3", "flac", "ogg", "m4a",
    ]
    .contains(&extension.as_str())
    {
        return Err(Error::Invalid("unsupported local media extension"));
    }
    fs::create_dir_all(workspace)?;
    let directory = tempfile::Builder::new()
        .prefix("source-")
        .tempdir_in(workspace)?;
    let path = directory.path().join(format!("source.{extension}"));
    let mut input = File::open(source)?;
    let mut output = File::options().write(true).create_new(true).open(&path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    let mut total = 0;
    loop {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let n = input.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > MAX_INPUT_BYTES {
            return Err(Error::Invalid("source grew beyond the size limit"));
        }
        output.write_all(&buffer[..n])?;
        hash.update(&buffer[..n]);
    }
    output.sync_all()?;
    let mut perms = output.metadata()?.permissions();
    perms.set_readonly(true);
    fs::set_permissions(&path, perms)?;
    Ok((
        directory,
        fs::canonicalize(path)?,
        extension,
        format!("{:x}", hash.finalize()),
    ))
}
fn hash_file(path: &Path, cancel: &CancellationToken) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buf = [0; 64 * 1024];
    loop {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

#[derive(Deserialize)]
struct Probe {
    format: ProbeFormat,
    #[serde(default)]
    streams: Vec<ProbeStream>,
}
#[derive(Deserialize)]
struct ProbeFormat {
    duration: String,
}
#[derive(Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
}
async fn probe(path: &Path, tools: &MediaTools, cancel: &CancellationToken) -> Result<MediaFacts> {
    let mut args: Vec<OsString> = [
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-format_whitelist",
        FORMAT_ALLOWLIST,
        "-show_entries",
        "format=duration:stream=codec_type",
        "-of",
        "json",
    ]
    .map(Into::into)
    .to_vec();
    args.push(path.as_os_str().to_owned());
    let bytes = tools
        .runner
        .run(
            &tools.ffprobe,
            &args,
            path.parent()
                .ok_or(Error::Invalid("missing parent directory"))?,
            cancel,
        )
        .await?;
    let probe: Probe = serde_json::from_slice(&bytes)?;
    let seconds: f64 = probe
        .format
        .duration
        .parse()
        .map_err(|_| Error::Invalid("media duration is unavailable"))?;
    if !seconds.is_finite() || seconds <= 0.0 || seconds * 1000.0 > MAX_DURATION_MS as f64 {
        return Err(Error::Invalid("unsupported media duration"));
    }
    Ok(MediaFacts {
        duration_ms: (seconds * 1000.0).round() as u64,
        has_audio: probe
            .streams
            .iter()
            .any(|s| s.codec_type.as_deref() == Some("audio")),
        has_video: probe
            .streams
            .iter()
            .any(|s| s.codec_type.as_deref() == Some("video")),
    })
}
