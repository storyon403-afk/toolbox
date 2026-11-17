use crate::{
    Error, Result,
    domain::{
        self, AudioFormat, BlockReason, ExportRequest, ExportSelection, ImageFormat, PlannedOutput,
        TextFormat,
    },
    media::{FORMAT_ALLOWLIST, MediaAsset},
    process::MediaTools,
    text::{self, Transcript},
};
use serde::Serialize;
use std::{
    ffi::OsString,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Completed,
    Partial,
    Failed,
    Cancelled,
}
#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum OutputResult {
    Completed { kind: String, files: Vec<PathBuf> },
    Blocked { kind: String, reason: BlockReason },
    Failed { kind: String, error: String },
    Cancelled { kind: String },
}
#[derive(Debug, Serialize)]
pub struct ExportReport {
    pub status: JobStatus,
    pub directory: Option<PathBuf>,
    pub outputs: Vec<OutputResult>,
}

pub struct ExportService {
    tools: MediaTools,
}
impl ExportService {
    pub fn new(tools: MediaTools) -> Self {
        Self { tools }
    }
    pub async fn execute(
        &self,
        asset: &MediaAsset,
        request: &ExportRequest,
        transcript: Option<&Transcript>,
        destination: &Path,
        cancel: &CancellationToken,
    ) -> Result<ExportReport> {
        let plans = domain::plan(request, asset.facts(), asset.watermark_state())?;
        asset.check_integrity(cancel).await?;
        fs::create_dir_all(destination)?;
        let destination = fs::canonicalize(destination)?;
        // Every run gets a private directory, so user-controlled titles cannot become paths or overwrite files.
        let job = tempfile::Builder::new()
            .prefix("export-")
            .tempdir_in(&destination)?;
        let mut outputs = Vec::new();
        let mut successes = 0;
        for plan in plans {
            let kind = plan.selection.kind().to_owned();
            if cancel.is_cancelled() {
                outputs.push(OutputResult::Cancelled { kind });
                continue;
            }
            if let Some(reason) = plan.blocked {
                outputs.push(OutputResult::Blocked { kind, reason });
                continue;
            }
            let stage = tempfile::Builder::new()
                .prefix(".partial-")
                .tempdir_in(job.path())?;
            match self
                .render_one(asset, &plan, transcript, stage.path(), cancel)
                .await
            {
                Ok(names) => {
                    if cancel.is_cancelled() {
                        outputs.push(OutputResult::Cancelled { kind });
                        continue;
                    }
                    let final_dir = job.path().join(&kind);
                    fs::rename(stage.path(), &final_dir)?;
                    let files = names.into_iter().map(|name| final_dir.join(name)).collect();
                    outputs.push(OutputResult::Completed { kind, files });
                    successes += 1;
                }
                Err(Error::Cancelled) => outputs.push(OutputResult::Cancelled { kind }),
                Err(e) => outputs.push(OutputResult::Failed {
                    kind,
                    error: e.to_string(),
                }),
            }
        }
        let status = if outputs
            .iter()
            .any(|r| matches!(r, OutputResult::Cancelled { .. }))
        {
            JobStatus::Cancelled
        } else if successes == outputs.len() {
            JobStatus::Completed
        } else if successes > 0 {
            JobStatus::Partial
        } else {
            JobStatus::Failed
        };
        let directory = if successes > 0 {
            Some(job.keep())
        } else {
            None
        };
        Ok(ExportReport {
            status,
            directory,
            outputs,
        })
    }
    async fn render_one(
        &self,
        asset: &MediaAsset,
        plan: &PlannedOutput,
        transcript: Option<&Transcript>,
        stage: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<String>> {
        match &plan.selection {
            ExportSelection::Text { format } => {
                let document =
                    transcript.ok_or(Error::Invalid("transcription result is not available"))?;
                let body = text::render(document, *format, plan.range, asset.facts().duration_ms)?;
                let ext = match format {
                    TextFormat::Txt => "txt",
                    TextFormat::Markdown => "md",
                    TextFormat::Srt => "srt",
                };
                let name = format!("transcript.{ext}");
                let mut file = File::options()
                    .create_new(true)
                    .write(true)
                    .open(stage.join(&name))?;
                file.write_all(body.as_bytes())?;
                file.sync_all()?;
                Ok(vec![name])
            }
            ExportSelection::Original => {
                let name = format!("original.{}", asset.extension());
                let src = asset.path().to_owned();
                let dest = stage.join(&name);
                let token = cancel.clone();
                tokio::task::spawn_blocking(move || copy_cancelable(&src, &dest, &token))
                    .await
                    .map_err(|_| Error::Cancelled)??;
                Ok(vec![name])
            }
            ExportSelection::Audio { format } => {
                let (ext, codec) = match format {
                    AudioFormat::Mp3 => ("mp3", "libmp3lame"),
                    AudioFormat::Wav => ("wav", "pcm_s16le"),
                    AudioFormat::M4a => ("m4a", "aac"),
                };
                let name = format!("audio.{ext}");
                let mut args = media_args(asset);
                args.extend(strings(&[
                    "-ss",
                    &seconds(plan.range.start_ms),
                    "-t",
                    &seconds(plan.range.duration_ms()),
                    "-map",
                    "0:a:0",
                    "-vn",
                    "-map_metadata",
                    "-1",
                    "-c:a",
                    codec,
                    "-threads",
                    "2",
                ]));
                args.push(stage.join(&name).into_os_string());
                self.tools
                    .runner
                    .run(&self.tools.ffmpeg, &args, stage, cancel)
                    .await?;
                ensure_output(&stage.join(&name))?;
                Ok(vec![name])
            }
            ExportSelection::Frames {
                format,
                timestamps_ms,
            } => {
                let ext = match format {
                    ImageFormat::Png => "png",
                    ImageFormat::Jpg => "jpg",
                };
                let mut names = Vec::new();
                for time in timestamps_ms {
                    let name = format!("frame-{time:010}.{ext}");
                    let mut args = media_args(asset);
                    args.extend(strings(&[
                        "-ss",
                        &seconds(*time),
                        "-map",
                        "0:v:0",
                        "-frames:v",
                        "1",
                        "-an",
                        "-map_metadata",
                        "-1",
                        "-threads",
                        "2",
                    ]));
                    args.push(stage.join(&name).into_os_string());
                    self.tools
                        .runner
                        .run(&self.tools.ffmpeg, &args, stage, cancel)
                        .await?;
                    ensure_output(&stage.join(&name))?;
                    names.push(name);
                }
                Ok(names)
            }
        }
    }
}
fn media_args(asset: &MediaAsset) -> Vec<OsString> {
    let mut args = strings(&[
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-n",
        "-protocol_whitelist",
        "file",
        "-format_whitelist",
        FORMAT_ALLOWLIST,
        "-threads",
        "2",
        "-filter_threads",
        "2",
        "-i",
    ]);
    args.push(asset.path().as_os_str().to_owned());
    args
}
fn strings(args: &[&str]) -> Vec<OsString> {
    args.iter().map(OsString::from).collect()
}
fn seconds(ms: u64) -> String {
    format!("{}.{:03}", ms / 1000, ms % 1000)
}
fn ensure_output(path: &Path) -> Result<()> {
    if fs::metadata(path)?.len() == 0 {
        return Err(Error::Invalid("media tool produced an empty output"));
    }
    Ok(())
}
fn copy_cancelable(src: &Path, dest: &Path, cancel: &CancellationToken) -> Result<()> {
    let mut input = File::open(src)?;
    let mut output = File::options().write(true).create_new(true).open(dest)?;
    let mut buf = [0; 64 * 1024];
    loop {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let n = input.read(&mut buf)?;
        if n == 0 {
            break;
        }
        output.write_all(&buf[..n])?;
    }
    output.sync_all()?;
    Ok(())
}
