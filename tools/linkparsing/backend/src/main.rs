#![forbid(unsafe_code)]
use linkparsing_core::{
    Error, Result,
    domain::ExportRequest,
    download::{DownloadOptions, DownloadService, DownloadTools, load_download, review_download},
    export::{ExportService, JobStatus},
    media::import_local,
    process::MediaTools,
    source::parse_share,
    text::Transcript,
};
use std::{
    ffi::OsString,
    io::Read,
    path::{Path, PathBuf},
    process::ExitCode,
};
use tokio_util::sync::CancellationToken;

use linkparsing_core::runtime::tool;
fn media_tools() -> Result<MediaTools> {
    MediaTools::new(tool("ffmpeg"), tool("ffprobe"))
}
fn download_tools() -> Result<DownloadTools> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let python = linkparsing_core::runtime::python(root);
    let node = std::env::var_os("LINKPARSING_NODE")
        .map(PathBuf::from)
        .unwrap_or_else(|| tool("node"));
    Ok(DownloadTools {
        python,
        worker: root.join("worker/download.py"),
        node: node.is_file().then_some(node),
        media: media_tools()?,
    })
}
fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(4 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err(Error::Invalid("JSON input exceeds 4 MiB"));
    }
    Ok(serde_json::from_slice(&bytes)?)
}
fn print_json(value: impl serde::Serialize, code: u8) -> Result<u8> {
    println!("{}", serde_json::to_string_pretty(&value)?);
    Ok(code)
}
fn utf8(value: &OsString) -> Result<&str> {
    value.to_str().ok_or(Error::Invalid("text must be UTF-8"))
}
fn report_code(status: &JobStatus) -> u8 {
    match status {
        JobStatus::Completed => 0,
        JobStatus::Cancelled => 130,
        _ => 2,
    }
}
struct Options {
    download: DownloadOptions,
    transcript: Option<Transcript>,
}
fn options(args: &[OsString], cookies_allowed: bool, transcript_allowed: bool) -> Result<Options> {
    let mut result = Options {
        download: DownloadOptions::default(),
        transcript: None,
    };
    let mut i = 0;
    let mut dns_seen = false;
    while i < args.len() {
        let flag = utf8(&args[i])?;
        let value = args
            .get(i + 1)
            .ok_or(Error::Invalid("option requires a value"))?;
        match flag {
            "--dns" if cookies_allowed && !dns_seen => {
                dns_seen = true;
                result.download.public_dns_fallback = match utf8(value)? {
                    "auto" => true,
                    "system" => false,
                    _ => return Err(Error::Invalid("DNS mode must be auto or system")),
                }
            }
            "--cookies" if cookies_allowed && result.download.cookie_file.is_none() => {
                result.download.cookie_file = Some(PathBuf::from(value))
            }
            "--transcript" if transcript_allowed && result.transcript.is_none() => {
                result.transcript = Some(read_json(Path::new(value))?)
            }
            _ => return Err(Error::Invalid("unknown or repeated option")),
        }
        i += 2;
    }
    Ok(result)
}
#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(code) => ExitCode::from(code),
        Err(e) => {
            let code = match &e {
                Error::Platform(kind) => serde_json::to_value(kind).unwrap_or_default(),
                Error::Cancelled => serde_json::json!("cancelled"),
                Error::Timeout => serde_json::json!("timeout"),
                _ => serde_json::json!("request_failed"),
            };
            eprintln!(
                "{}",
                serde_json::json!({"error":code,"message":e.to_string()})
            );
            ExitCode::from(if matches!(e, Error::Cancelled) {
                130
            } else {
                1
            })
        }
    }
}
async fn run() -> Result<u8> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let command = args.first().and_then(|s| s.to_str()).unwrap_or("");
    let cancel = CancellationToken::new();
    let signal = cancel.clone();
    tokio::spawn(async move {
        if tokio::signal::ctrl_c().await.is_ok() {
            signal.cancel();
        }
    });
    match command {
        "doctor" if args.len() == 1 => {
            let worker = match download_tools().and_then(DownloadService::new) {
                Ok(service) => service.version(&cancel).await,
                Err(e) => Err(e),
            };
            print_json(
                serde_json::json!({"ffmpeg":tool("ffmpeg").is_file(),"ffprobe":tool("ffprobe").is_file(),"node":tool("node").is_file(),"yt_dlp":worker.as_ref().ok(),"download_worker_error":worker.err().map(|e|e.to_string()),"platforms":["youtube","douyin","bilibili"],"asr":"not_connected","ocr":"not_connected","agent":"not_connected"}),
                0,
            )
        }
        "parse-link" if args.len() == 2 => print_json(parse_share(utf8(&args[1])?)?, 0),
        "probe-local" if args.len() == 3 => {
            let tools = media_tools()?;
            let asset =
                import_local(Path::new(&args[1]), Path::new(&args[2]), &tools, &cancel).await?;
            print_json(
                serde_json::json!({"facts":asset.facts(),"sha256":asset.sha256(),"watermark":asset.watermark_state()}),
                0,
            )
        }
        "resolve-link" | "download-link" if args.len() >= 3 => {
            let service = DownloadService::new(download_tools()?)?;
            let opts = options(&args[3..], true, false)?;
            if command == "resolve-link" {
                print_json(
                    service
                        .resolve(
                            utf8(&args[1])?,
                            Path::new(&args[2]),
                            &opts.download,
                            &cancel,
                        )
                        .await?,
                    0,
                )
            } else {
                print_json(
                    service
                        .download(
                            utf8(&args[1])?,
                            Path::new(&args[2]),
                            &opts.download,
                            &cancel,
                        )
                        .await?,
                    0,
                )
            }
        }
        "export-link" if args.len() >= 4 => {
            let request: ExportRequest = read_json(Path::new(&args[2]))?;
            let opts = options(&args[4..], true, true)?;
            let tools = download_tools()?;
            let service = DownloadService::new(tools.clone())?;
            let destination = Path::new(&args[3]);
            let downloaded = service
                .download(utf8(&args[1])?, destination, &opts.download, &cancel)
                .await?;
            let (asset, _) = load_download(&downloaded.directory, &tools.media, &cancel).await?;
            let report = ExportService::new(tools.media)
                .execute(
                    &asset,
                    &request,
                    opts.transcript.as_ref(),
                    destination,
                    &cancel,
                )
                .await?;
            let code = report_code(&report.status);
            print_json(
                serde_json::json!({"source":downloaded,"export":report}),
                code,
            )
        }
        "review-download" if args.len() == 4 => {
            let clean = match utf8(&args[2])? {
                "clean" => true,
                "watermarked" => false,
                _ => {
                    return Err(Error::Invalid(
                        "review decision must be clean or watermarked",
                    ));
                }
            };
            review_download(
                Path::new(&args[1]),
                clean,
                utf8(&args[3])?,
                &media_tools()?,
                &cancel,
            )
            .await?;
            print_json(
                serde_json::json!({"recorded":true,"method":"explicit_manual_review","clean":clean}),
                0,
            )
        }
        "export-downloaded" if args.len() >= 4 => {
            let request: ExportRequest = read_json(Path::new(&args[2]))?;
            let opts = options(&args[4..], false, true)?;
            let tools = media_tools()?;
            let (asset, _) = load_download(Path::new(&args[1]), &tools, &cancel).await?;
            let report = ExportService::new(tools)
                .execute(
                    &asset,
                    &request,
                    opts.transcript.as_ref(),
                    Path::new(&args[3]),
                    &cancel,
                )
                .await?;
            let code = report_code(&report.status);
            print_json(report, code)
        }
        "export-local" if args.len() >= 4 => {
            let request: ExportRequest = read_json(Path::new(&args[2]))?;
            let transcript = if args.len() == 5 && !utf8(&args[4])?.starts_with("--") {
                Some(read_json(Path::new(&args[4]))?)
            } else {
                options(&args[4..], false, true)?.transcript
            };
            let tools = media_tools()?;
            let destination = Path::new(&args[3]);
            let asset = import_local(Path::new(&args[1]), destination, &tools, &cancel).await?;
            let report = ExportService::new(tools)
                .execute(&asset, &request, transcript.as_ref(), destination, &cancel)
                .await?;
            let code = report_code(&report.status);
            print_json(report, code)
        }
        "" | "--help" | "help" => {
            println!(
                "linkparsing doctor\nlinkparsing parse-link '<share text>'\nlinkparsing resolve-link '<share text>' <workspace> [--cookies file] [--dns system|auto]\nlinkparsing download-link '<share text>' <workspace> [--cookies file] [--dns system|auto]\nlinkparsing export-link '<share text>' <request.json> <output> [--cookies file] [--dns system|auto] [--transcript file]\nlinkparsing review-download <download-dir> clean|watermarked '<review note>'\nlinkparsing export-downloaded <download-dir> <request.json> <output> [--transcript file]\nlinkparsing probe-local <media> <workspace>\nlinkparsing export-local <media> <request.json> <output> [--transcript file]\n\nDownloaded sources are unreviewed. Only record 'clean' after personally inspecting the source. No automatic watermark detection.\nExit codes: 0 completed, 1 request/platform error, 2 partial/blocked/failed export, 130 cancelled."
            );
            Ok(0)
        }
        _ => Err(Error::Invalid(
            "unknown command or missing argument; use --help",
        )),
    }
}
