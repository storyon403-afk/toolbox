use crate::{
    Error, Result,
    domain::{MAX_DURATION_MS, SourceReview},
    media::{MediaAsset, import_local},
    process::{MediaTools, ToolRunner},
    source::{Platform, parse_share},
};
use serde::{Deserialize, Serialize};
use std::{
    fmt,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlatformFailure {
    AuthenticationRequired,
    RateLimited,
    NetworkUnavailable,
    NetworkPolicy,
    DnsNotPublic,
    VideoUnavailable,
    UnsupportedUrl,
    UnsupportedMedia,
    UnsupportedDuration,
    MissingDependency,
    SizeLimit,
    InvalidOutput,
    InvalidRequest,
    ExtractorFailed,
}
impl fmt::Display for PlatformFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::AuthenticationRequired => "需要登录、验证码或有效 Cookie；请主动提供 Cookie 文件",
            Self::RateLimited => "平台限流或风控，请稍后重试",
            Self::NetworkUnavailable => "网络或 TLS 连接失败",
            Self::NetworkPolicy => "网络策略拒绝了非公网地址或不允许的连接",
            Self::DnsNotPublic => {
                "系统 DNS 返回了非公网地址，可能由代理 FakeIP 引起；可启用公网 DNS 回退后重试"
            }
            Self::VideoUnavailable => "视频不存在、已删除或当前不可访问",
            Self::UnsupportedUrl => "仅支持三个目标平台的单视频链接",
            Self::UnsupportedMedia => "不支持直播、播放列表、DRM 或该下载协议",
            Self::UnsupportedDuration => "时长未知或超过 12 小时",
            Self::MissingDependency => "下载依赖缺失，请运行 doctor",
            Self::SizeLimit => "下载超过大小限制",
            Self::InvalidOutput => "下载器没有生成有效的单个媒体文件",
            Self::InvalidRequest => "下载请求无效",
            Self::ExtractorFailed => "平台解析失败，可能需要更新解析器",
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VideoMetadata {
    pub platform: Platform,
    pub id: String,
    pub title: String,
    pub duration_ms: u64,
    pub canonical_url: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub watermark: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_file: Option<String>,
}

#[derive(Clone)]
pub struct DownloadTools {
    pub python: PathBuf,
    pub worker: PathBuf,
    pub node: Option<PathBuf>,
    pub media: MediaTools,
}
impl DownloadTools {
    pub fn validate(&self) -> Result<()> {
        for p in [
            &self.python,
            &self.worker,
            &self.media.ffmpeg,
            &self.media.ffprobe,
        ]
        .into_iter()
        .chain(self.node.iter())
        {
            if !p.is_absolute() || !p.is_file() {
                return Err(Error::Platform(PlatformFailure::MissingDependency));
            }
        }
        Ok(())
    }
}

/// Cookies are only loaded from an explicitly chosen file, copied into scratch, and removed afterwards.
#[derive(Default)]
pub struct DownloadOptions {
    pub cookie_file: Option<PathBuf>,
    /// Explicit opt-in when system DNS returns proxy/FakeIP addresses. Never changes OS settings.
    pub public_dns_fallback: bool,
}
#[derive(Serialize)]
struct WorkerRequest<'a> {
    action: &'a str,
    platform: Platform,
    url: &'a str,
    ffmpeg: &'a Path,
    node: Option<&'a Path>,
    cookie_file: Option<PathBuf>,
    dns: &'a str,
}
#[derive(Deserialize)]
struct WorkerResponse {
    ok: bool,
    video: Option<VideoMetadata>,
    error: Option<PlatformFailure>,
    version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DownloadManifest {
    pub version: u32,
    pub video: VideoMetadata,
    pub sha256: String,
    pub media_file: String,
    /// A downloaded source is for local inspection, not a verified watermark-free export.
    pub status: String,
}
#[derive(Debug, Serialize)]
pub struct DownloadedSource {
    pub directory: PathBuf,
    pub manifest: DownloadManifest,
}

pub struct DownloadService {
    tools: DownloadTools,
    runner: ToolRunner,
}
impl DownloadService {
    pub fn new(tools: DownloadTools) -> Result<Self> {
        tools.validate()?;
        Ok(Self {
            tools,
            runner: ToolRunner::new(1, Duration::from_secs(1800))?
                .with_scratch_limits(4 * 1024_u64.pow(3), 8 * 1024_u64.pow(3))?,
        })
    }
    pub async fn version(&self, cancel: &CancellationToken) -> Result<String> {
        let temp = tempfile::tempdir()?;
        write_private(
            &temp.path().join("request.json"),
            &serde_json::json!({"action":"doctor"}),
        )?;
        let response = self.call_worker(temp.path(), cancel).await?;
        response
            .version
            .ok_or(Error::Platform(PlatformFailure::MissingDependency))
    }
    pub async fn resolve(
        &self,
        share: &str,
        workspace: &Path,
        options: &DownloadOptions,
        cancel: &CancellationToken,
    ) -> Result<VideoMetadata> {
        let root = workspace_dir(workspace)?;
        let scratch = tempfile::Builder::new()
            .prefix(".resolve-")
            .tempdir_in(root)?;
        self.request("resolve", share, scratch.path(), options)?;
        let response = self.call_worker(scratch.path(), cancel).await?;
        let video = response
            .video
            .ok_or(Error::Platform(PlatformFailure::InvalidOutput))?;
        validate_video(&video, parse_share(share)?.platform)?;
        Ok(video)
    }
    pub async fn download(
        &self,
        share: &str,
        workspace: &Path,
        options: &DownloadOptions,
        cancel: &CancellationToken,
    ) -> Result<DownloadedSource> {
        let root = workspace_dir(workspace)?;
        let scratch = tempfile::Builder::new()
            .prefix(".download-")
            .tempdir_in(&root)?;
        self.request("download", share, scratch.path(), options)?;
        let response = self.call_worker(scratch.path(), cancel).await?;
        let video = response
            .video
            .ok_or(Error::Platform(PlatformFailure::InvalidOutput))?;
        validate_video(&video, parse_share(share)?.platform)?;
        let filename = video
            .media_file
            .as_deref()
            .ok_or(Error::Platform(PlatformFailure::InvalidOutput))?;
        validate_filename(filename)?;
        let source = scratch.path().join(filename);
        if !fs::symlink_metadata(&source)?.is_file() {
            return Err(Error::Platform(PlatformFailure::InvalidOutput));
        }
        // Probe and hash real bytes before publishing the source. Import also applies size and duration bounds.
        let asset = import_local(&source, &root, &self.tools.media, cancel).await?;
        let published = tempfile::Builder::new()
            .prefix("download-")
            .tempdir_in(&root)?;
        let manifest = DownloadManifest {
            version: 1,
            video: video.clone(),
            sha256: asset.sha256().into(),
            media_file: filename.into(),
            status: "downloaded_unreviewed".into(),
        };
        // Publish only the media and manifest; private request/cookies/partial files remain in scratch.
        fs::rename(&source, published.path().join(filename))?;
        write_private(&published.path().join("asset.json"), &manifest)?;
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        Ok(DownloadedSource {
            directory: published.keep(),
            manifest,
        })
    }
    fn request(
        &self,
        action: &str,
        share: &str,
        scratch: &Path,
        options: &DownloadOptions,
    ) -> Result<()> {
        let link = parse_share(share)?;
        let cookie_file = if let Some(path) = &options.cookie_file {
            let meta = fs::symlink_metadata(path)?;
            if !meta.is_file() || meta.len() > 1024 * 1024 {
                return Err(Error::Invalid(
                    "Cookie file must be regular and at most 1 MiB",
                ));
            }
            let mut bytes = Vec::new();
            File::open(path)?
                .take(1024 * 1024 + 1)
                .read_to_end(&mut bytes)?;
            if bytes.len() > 1024 * 1024 {
                return Err(Error::Invalid("Cookie file is too large"));
            }
            let dest = scratch.join("cookies.txt");
            let mut file = create_private(&dest)?;
            file.write_all(&bytes)?;
            Some(dest)
        } else {
            None
        };
        write_private(
            &scratch.join("request.json"),
            &WorkerRequest {
                action,
                platform: link.platform,
                url: link.url.as_str(),
                ffmpeg: &self.tools.media.ffmpeg,
                node: self.tools.node.as_deref(),
                cookie_file,
                dns: if options.public_dns_fallback {
                    "auto"
                } else {
                    "system"
                },
            },
        )
    }
    async fn call_worker(
        &self,
        scratch: &Path,
        cancel: &CancellationToken,
    ) -> Result<WorkerResponse> {
        let args = vec![
            "-I".into(),
            "-B".into(),
            "-X".into(),
            "utf8".into(),
            "-u".into(),
            self.tools.worker.as_os_str().to_owned(),
            scratch.join("request.json").into_os_string(),
        ];
        let bytes = self
            .runner
            .run(&self.tools.python, &args, scratch, cancel)
            .await?;
        let response: WorkerResponse = serde_json::from_slice(&bytes)?;
        if !response.ok {
            return Err(Error::Platform(
                response.error.unwrap_or(PlatformFailure::ExtractorFailed),
            ));
        }
        Ok(response)
    }
}

fn validate_video(video: &VideoMetadata, expected: Platform) -> Result<()> {
    if video.platform != expected
        || video.id.is_empty()
        || video.id.len() > 200
        || video.title.len() > 2000
        || video.duration_ms == 0
        || video.duration_ms > MAX_DURATION_MS
        || video.watermark != "unknown"
        || parse_share(&video.canonical_url)?.platform != expected
    {
        return Err(Error::Platform(PlatformFailure::InvalidOutput));
    }
    Ok(())
}
fn validate_filename(name: &str) -> Result<()> {
    if ![
        "media.mp4",
        "media.mkv",
        "media.webm",
        "media.mov",
        "media.m4a",
        "media.mp3",
        "media.ogg",
    ]
    .contains(&name)
    {
        return Err(Error::Platform(PlatformFailure::InvalidOutput));
    }
    Ok(())
}
fn workspace_dir(path: &Path) -> Result<PathBuf> {
    fs::create_dir_all(path)?;
    Ok(fs::canonicalize(path)?)
}
fn create_private(path: &Path) -> Result<File> {
    let mut options = File::options();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    Ok(options.open(path)?)
}
fn write_private(path: &Path, value: &impl Serialize) -> Result<()> {
    let mut f = create_private(path)?;
    serde_json::to_writer_pretty(&mut f, value)?;
    f.sync_all()?;
    Ok(())
}
fn read_private<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    if !fs::symlink_metadata(path)?.is_file() {
        return Err(Error::Invalid("manifest must be a regular file"));
    }
    let mut bytes = Vec::new();
    File::open(path)?.take(32769).read_to_end(&mut bytes)?;
    if bytes.len() > 32768 {
        return Err(Error::Invalid("manifest too large"));
    }
    Ok(serde_json::from_slice(&bytes)?)
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ManualReview {
    sha256: String,
    clean: bool,
    note: String,
}

/// Review is an explicit trusted-user operation over already downloaded, inspectable media.
/// This API does not claim automatic detection, and is separate from untrusted ExportRequest.
pub async fn review_download(
    directory: &Path,
    clean: bool,
    note: &str,
    tools: &MediaTools,
    cancel: &CancellationToken,
) -> Result<()> {
    let (asset, _) = load_download(directory, tools, cancel).await?;
    SourceReview::manual(asset.sha256().into(), clean, note.into())?;
    let record = ManualReview {
        sha256: asset.sha256().into(),
        clean,
        note: note.into(),
    };
    let temp = tempfile::NamedTempFile::new_in(directory)?;
    serde_json::to_writer_pretty(temp.as_file(), &record)?;
    temp.as_file().sync_all()?;
    temp.persist(directory.join("review.json"))
        .map_err(|e| Error::from(e.error))?;
    Ok(())
}
pub async fn load_download(
    directory: &Path,
    tools: &MediaTools,
    cancel: &CancellationToken,
) -> Result<(MediaAsset, DownloadManifest)> {
    let directory = fs::canonicalize(directory)?;
    let manifest: DownloadManifest = read_private(&directory.join("asset.json"))?;
    if manifest.version != 1 || manifest.status != "downloaded_unreviewed" {
        return Err(Error::Invalid("unsupported source manifest"));
    }
    validate_filename(&manifest.media_file)?;
    validate_video(&manifest.video, manifest.video.platform)?;
    let mut asset = import_local(
        &directory.join(&manifest.media_file),
        &directory,
        tools,
        cancel,
    )
    .await?;
    if asset.sha256() != manifest.sha256 {
        return Err(Error::Invalid(
            "downloaded source changed; download it again",
        ));
    }
    let review = directory.join("review.json");
    if review.try_exists()? {
        let r: ManualReview = read_private(&review)?;
        asset.record_review(SourceReview::manual(r.sha256, r.clean, r.note)?)?;
    }
    Ok((asset, manifest))
}
