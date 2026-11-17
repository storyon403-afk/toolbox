//! Trusted native-host protocol. Web content cannot send these commands directly:
//! the macOS host owns file panels, paths and the human-review confirmation.
use crate::{
    Error, Result,
    asr::{self, AsrTools},
    domain::{ExportRequest, SourceReview, TextFormat, TimeRange},
    download::{DownloadOptions, DownloadService, DownloadTools, load_download},
    export::ExportService,
    media::{MediaAsset, import_local},
    ocr,
    process::MediaTools,
    text::{self, Transcript},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{io::Read, path::PathBuf};
use tokio_util::sync::CancellationToken;

#[derive(Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextSource {
    #[default]
    Speech,
    Ocr,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub id: u64,
    pub command: Command,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    Doctor,
    Resolve {
        share: String,
        workspace: PathBuf,
        cookies: Option<PathBuf>,
        public_dns: bool,
    },
    Download {
        share: String,
        workspace: PathBuf,
        cookies: Option<PathBuf>,
        public_dns: bool,
    },
    Import {
        path: PathBuf,
        workspace: PathBuf,
    },
    Reopen {
        directory: PathBuf,
    },
    Transcript {
        asset_id: u64,
        path: PathBuf,
    },
    Transcribe {
        asset_id: u64,
        language: String,
    },
    Ocr {
        asset_id: u64,
        range: Option<TimeRange>,
        interval_ms: u64,
        language: String,
    },
    Review {
        asset_id: u64,
        clean: bool,
        note: String,
    },
    Export {
        asset_id: u64,
        request: ExportRequest,
        destination: PathBuf,
        #[serde(default)]
        text_source: TextSource,
    },
    Preview {
        asset_id: u64,
        #[serde(default)]
        playback: bool,
    },
    Content {
        asset_id: u64,
        offset: usize,
        #[serde(default)]
        text_source: TextSource,
    },
    Cancel,
}

pub struct Session {
    tools: DownloadTools,
    asset: Option<MediaAsset>,
    transcript: Option<Transcript>,
    ocr: Option<Transcript>,
    title: String,
    generation: u64,
}

impl Session {
    pub fn new(tools: DownloadTools) -> Self {
        Self {
            tools,
            asset: None,
            transcript: None,
            ocr: None,
            title: String::new(),
            generation: 0,
        }
    }

    fn asset(&self, id: u64) -> Result<&MediaAsset> {
        if id != self.generation {
            return Err(Error::Invalid("asset is no longer active"));
        }
        self.asset
            .as_ref()
            .ok_or(Error::Invalid("import a source first"))
    }

    fn info(&self) -> Result<Value> {
        let asset = self.asset(self.generation)?;
        Ok(json!({"asset": {
            "id": self.generation, "title": self.title, "facts": asset.facts(),
            "watermark": asset.watermark_state(), "has_transcript": self.transcript.is_some(), "has_ocr": self.ocr.is_some()
        }}))
    }

    fn adopt(&mut self, asset: MediaAsset, title: String) -> Result<Value> {
        self.transcript = asr::restore(&asset);
        self.ocr = ocr::restore(&asset);
        self.asset = Some(asset);
        self.title = title;
        self.generation += 1;
        self.info()
    }

    pub async fn execute(
        &mut self,
        command: Command,
        cancel: &CancellationToken,
        progress: impl Fn(Value),
    ) -> Result<Value> {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        match command {
            Command::Doctor => {
                let download = match DownloadService::new(self.tools.clone()) {
                    Ok(service) => service.version(cancel).await,
                    Err(error) => Err(error),
                };
                Ok(json!({"ffmpeg": self.tools.media.ffmpeg.is_file(),
                    "ffprobe": self.tools.media.ffprobe.is_file(),
                    "node": self.tools.node.as_ref().is_some_and(|p| p.is_file()),
                    "download_ready": download.is_ok(), "yt_dlp": download.as_ref().ok(),
                    "download_error": download.err().map(|e| e.to_string()),
                    "asr": AsrTools::configured().ready(), "ocr": ocr::ready(), "agent": false}))
            }
            Command::Resolve {
                share,
                workspace,
                cookies,
                public_dns,
            } => {
                validate_share(&share)?;
                authorized_directory(&workspace)?;
                let video = DownloadService::new(self.tools.clone())?
                    .resolve(
                        &share,
                        &workspace,
                        &DownloadOptions {
                            cookie_file: cookies,
                            public_dns_fallback: public_dns,
                        },
                        cancel,
                    )
                    .await?;
                // No source URL or platform media path crosses back to the web view.
                Ok(
                    json!({"resolved": {"title": video.title, "duration_ms": video.duration_ms,
                    "platform": video.platform, "width": video.width, "height": video.height}}),
                )
            }
            Command::Download {
                share,
                workspace,
                cookies,
                public_dns,
            } => {
                validate_share(&share)?;
                authorized_directory(&workspace)?;
                let downloaded = DownloadService::new(self.tools.clone())?
                    .download(
                        &share,
                        &workspace,
                        &DownloadOptions {
                            cookie_file: cookies,
                            public_dns_fallback: public_dns,
                        },
                        cancel,
                    )
                    .await?;
                let (asset, manifest) =
                    load_download(&downloaded.directory, &self.tools.media, cancel).await?;
                let mut info = self.adopt(asset, manifest.video.title)?;
                // Trusted host strips private paths before dispatching the reply to JavaScript.
                info["source_directory"] = json!(downloaded.directory);
                Ok(info)
            }
            Command::Import { path, workspace } => {
                authorized_directory(&workspace)?;
                if !path.is_absolute() {
                    return Err(Error::Invalid("select an absolute local file"));
                }
                let asset = import_local(&path, &workspace, &self.tools.media, cancel).await?;
                let title = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned();
                self.adopt(asset, title)
            }
            Command::Reopen { directory } => {
                authorized_directory(&directory)?;
                let (asset, manifest) =
                    load_download(&directory, &self.tools.media, cancel).await?;
                let mut info = self.adopt(asset, manifest.video.title)?;
                info["source_directory"] = json!(directory);
                Ok(info)
            }
            Command::Transcript { asset_id, path } => {
                let asset = self.asset(asset_id)?;
                if !path.is_absolute() || !std::fs::symlink_metadata(&path)?.is_file() {
                    return Err(Error::Invalid("select a regular transcript JSON file"));
                }
                let mut bytes = Vec::new();
                std::fs::File::open(path)?
                    .take(4 * 1024 * 1024 + 1)
                    .read_to_end(&mut bytes)?;
                if bytes.len() > 4 * 1024 * 1024 {
                    return Err(Error::Invalid("transcript exceeds 4 MiB"));
                }
                let transcript: Transcript = serde_json::from_slice(&bytes)?;
                text::render(
                    &transcript,
                    TextFormat::Txt,
                    TimeRange {
                        start_ms: 0,
                        end_ms: asset.facts().duration_ms,
                    },
                    asset.facts().duration_ms,
                )?;
                self.transcript = Some(transcript);
                self.info()
            }
            Command::Transcribe { asset_id, language } => {
                let transcript = asr::transcribe(
                    self.asset(asset_id)?,
                    &self.tools.media,
                    &AsrTools::configured(),
                    &language,
                    cancel,
                    |stage| progress(json!({"stage": stage})),
                )
                .await?;
                self.transcript = Some(transcript);
                self.info()
            }
            Command::Ocr {
                asset_id,
                range,
                interval_ms,
                language,
            } => {
                let result = ocr::recognize(
                    self.asset(asset_id)?,
                    &self.tools.media,
                    range,
                    interval_ms,
                    &language,
                    cancel,
                    |done, total| progress(json!({"stage":"ocr", "done":done,"total":total})),
                )
                .await?;
                self.ocr = Some(result);
                self.info()
            }
            Command::Review {
                asset_id,
                clean,
                note,
            } => {
                let asset = self.asset(asset_id)?;
                asset.check_integrity(cancel).await?;
                let review = SourceReview::manual(asset.sha256().into(), clean, note)?;
                self.asset
                    .as_mut()
                    .ok_or(Error::Invalid("missing source"))?
                    .record_review(review)?;
                self.info()
            }
            Command::Export {
                asset_id,
                request,
                destination,
                text_source,
            } => {
                authorized_directory(&destination)?;
                let asset = self.asset(asset_id)?;
                let report = ExportService::new(self.tools.media.clone())
                    .execute(
                        asset,
                        &request,
                        match text_source {
                            TextSource::Speech => self.transcript.as_ref(),
                            TextSource::Ocr => self.ocr.as_ref(),
                        },
                        &destination,
                        cancel,
                    )
                    .await?;
                Ok(json!({"report": report}))
            }
            Command::Preview { asset_id, playback } => {
                let asset = self.asset(asset_id)?;
                if playback {
                    let (path, converted) =
                        crate::playback::prepare(asset, &self.tools.media, cancel, |stage| {
                            progress(json!({"stage":stage}))
                        })
                        .await?;
                    return Ok(json!({"preview_path":path,"playback_copy":converted}));
                }
                asset.check_integrity(cancel).await?;
                Ok(json!({"preview_path": asset.path()}))
            }
            Command::Content {
                asset_id,
                offset,
                text_source,
            } => {
                self.asset(asset_id)?;
                let document = match text_source {
                    TextSource::Speech => self.transcript.as_ref(),
                    TextSource::Ocr => self.ocr.as_ref(),
                }
                .ok_or(Error::Invalid("import a transcript first"))?;
                if offset > document.segments.len() {
                    return Err(Error::Invalid("invalid transcript page"));
                }
                let mut segments = Vec::new();
                let mut bytes = 0;
                for segment in document.segments.iter().skip(offset).take(50) {
                    let text: String = segment.text.chars().take(2000).collect();
                    if bytes + text.len() > 128 * 1024 {
                        break;
                    }
                    bytes += text.len();
                    segments.push(
                        json!({"start_ms": segment.start_ms, "end_ms": segment.end_ms,
                        "truncated": text.len() < segment.text.len(), "text": text}),
                    );
                }
                let next = offset + segments.len();
                Ok(json!({"content": {"segments": segments, "offset": offset,
                    "next_offset": (next < document.segments.len()).then_some(next),
                    "total": document.segments.len(),
                    "characters": document.segments.iter().map(|s| s.text.chars().filter(|c| !c.is_whitespace()).count()).sum::<usize>()}}))
            }
            Command::Cancel => Err(Error::Invalid("cancel must be handled by the transport")),
        }
    }
}

fn authorized_directory(path: &std::path::Path) -> Result<()> {
    if !path.is_absolute() || !path.is_dir() {
        return Err(Error::Invalid("select an existing local directory"));
    }
    Ok(())
}
fn validate_share(share: &str) -> Result<()> {
    if share.len() > 16 * 1024 {
        return Err(Error::Invalid("share text exceeds 16 KiB"));
    }
    crate::source::parse_share(share)?;
    Ok(())
}

pub fn configured_tools() -> Result<DownloadTools> {
    use crate::runtime::tool;
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let node = std::env::var_os("LINKPARSING_NODE")
        .map(PathBuf::from)
        .unwrap_or_else(|| tool("node"));
    Ok(DownloadTools {
        python: crate::runtime::python(&root),
        worker: std::env::var_os("LINKPARSING_WORKER")
            .map(PathBuf::from)
            .unwrap_or_else(|| root.join("worker/download.py")),
        node: node.is_file().then_some(node),
        media: MediaTools::new(tool("ffmpeg"), tool("ffprobe"))?,
    })
}
