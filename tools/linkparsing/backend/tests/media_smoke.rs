use linkparsing_core::{
    Error,
    domain::*,
    export::{ExportService, JobStatus, OutputResult},
    media::import_local,
    process::{MediaTools, ToolRunner},
    text::{TextSegment, Transcript},
};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
use tokio_util::sync::CancellationToken;
fn find(name: &str) -> PathBuf {
    let name = if cfg!(windows) && name == "python3" {
        "python"
    } else {
        name
    };
    let path = linkparsing_core::runtime::tool(name);
    assert!(
        path.is_absolute() && path.is_file(),
        "install/configure {name} before integration tests"
    );
    path
}
fn fixture(root: &Path) -> PathBuf {
    let file = root.join("fixture ; $(never-execute).mp4");
    let status = Command::new(find("ffmpeg"))
        .args([
            "-nostdin",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=160x90:r=10:d=2",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2",
            "-c:v",
            "mpeg4",
            "-c:a",
            "aac",
            "-shortest",
        ])
        .arg(&file)
        .status()
        .unwrap();
    assert!(status.success());
    file
}
fn request() -> ExportRequest {
    ExportRequest {
        range: Some(TimeRange {
            start_ms: 500,
            end_ms: 1500,
        }),
        outputs: vec![
            ExportSelection::Text {
                format: TextFormat::Srt,
            },
            ExportSelection::Audio {
                format: AudioFormat::Wav,
            },
            ExportSelection::Frames {
                format: ImageFormat::Png,
                timestamps_ms: vec![750],
            },
            ExportSelection::Original,
        ],
    }
}
fn transcript() -> Transcript {
    Transcript {
        segments: vec![TextSegment {
            start_ms: 0,
            end_ms: 2000,
            text: "synthetic fixture".into(),
        }],
    }
}

#[tokio::test]
#[ignore = "requires installed FFmpeg and ffprobe"]
async fn real_exports_gate_visuals_then_preserve_full_original() {
    let temp = tempfile::tempdir().unwrap();
    let source = fixture(temp.path());
    let tools = MediaTools::new(find("ffmpeg"), find("ffprobe")).unwrap();
    let token = CancellationToken::new();
    let mut asset = import_local(&source, &temp.path().join("cache"), &tools, &token)
        .await
        .unwrap();
    assert_eq!(asset.watermark_state(), WatermarkState::Unknown);
    let service = ExportService::new(tools.clone());
    let dest = temp.path().join("exports");
    let r = service
        .execute(&asset, &request(), Some(&transcript()), &dest, &token)
        .await
        .unwrap();
    assert_eq!(r.status, JobStatus::Partial);
    assert!(matches!(r.outputs[2], OutputResult::Blocked { .. }));
    // This source is generated above from a solid color and tone; this is the trusted test review, not a frontend assertion.
    asset
        .record_review(
            SourceReview::manual(
                asset.sha256().into(),
                true,
                "Synthetic test source generated from a solid color".into(),
            )
            .unwrap(),
        )
        .unwrap();
    let r = service
        .execute(&asset, &request(), Some(&transcript()), &dest, &token)
        .await
        .unwrap();
    assert_eq!(r.status, JobStatus::Completed);
    for item in &r.outputs {
        let OutputResult::Completed { files, .. } = item else {
            panic!("output did not complete")
        };
        for file in files {
            assert!(file.is_file());
            assert!(fs::metadata(file).unwrap().len() > 0);
        }
    }
    let OutputResult::Completed { files, .. } = &r.outputs[3] else {
        panic!()
    };
    assert_eq!(
        fs::read(&files[0]).unwrap(),
        fs::read(&source).unwrap(),
        "original must be byte-identical despite selected range"
    );
    let OutputResult::Completed { files, .. } = &r.outputs[1] else {
        panic!()
    };
    let audio = import_local(&files[0], &temp.path().join("check"), &tools, &token)
        .await
        .unwrap();
    assert!((audio.facts().duration_ms as i64 - 1000).abs() < 100);
    let wrong = SourceReview::manual("a".repeat(64), true, "different file".into()).unwrap();
    assert!(asset.record_review(wrong).is_err());
}

#[tokio::test]
#[ignore = "requires installed FFmpeg and ffprobe"]
async fn cancelled_export_leaves_no_successful_files() {
    let temp = tempfile::tempdir().unwrap();
    let source = fixture(temp.path());
    let tools = MediaTools::new(find("ffmpeg"), find("ffprobe")).unwrap();
    let token = CancellationToken::new();
    let asset = import_local(&source, &temp.path().join("cache"), &tools, &token)
        .await
        .unwrap();
    token.cancel();
    let r = ExportService::new(tools)
        .execute(
            &asset,
            &request(),
            None,
            &temp.path().join("outputs"),
            &token,
        )
        .await;
    assert!(matches!(r, Err(Error::Cancelled)));
    assert!(!temp.path().join("outputs").exists());
}

#[tokio::test]
async fn process_timeout_and_cancel_are_enforced() {
    #[cfg(not(windows))]
    let sleep = PathBuf::from("/bin/sleep");
    #[cfg(windows)]
    let sleep = PathBuf::from(std::env::var_os("SystemRoot").expect("SystemRoot"))
        .join("System32/ping.exe");
    assert!(sleep.is_file());
    #[cfg(not(windows))]
    let args = ["5".into()];
    #[cfg(windows)]
    let args = ["-n".into(), "6".into(), "127.0.0.1".into()];
    let temp = tempfile::tempdir().unwrap();
    let runner = ToolRunner::new(1, Duration::from_millis(50)).unwrap();
    assert!(matches!(
        runner
            .run(&sleep, &args, temp.path(), &CancellationToken::new())
            .await,
        Err(Error::Timeout)
    ));
    let token = CancellationToken::new();
    token.cancel();
    assert!(matches!(
        runner.run(&sleep, &args, temp.path(), &token).await,
        Err(Error::Cancelled)
    ));
}
