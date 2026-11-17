use linkparsing_core::{
    domain::{AudioFormat, ExportRequest, ExportSelection, TimeRange, WatermarkState},
    download::{DownloadOptions, DownloadService, DownloadTools, load_download, review_download},
    export::{ExportService, JobStatus},
    process::MediaTools,
};
use std::{fs, path::PathBuf, process::Command};
use tokio_util::sync::CancellationToken;

fn tool(name: &str) -> PathBuf {
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

#[tokio::test]
#[ignore = "offline integration: requires FFmpeg, ffprobe, Python"]
async fn share_to_download_to_reviewed_export_with_private_cookie_copy() {
    let dir = tempfile::tempdir().unwrap();
    let media = dir.path().join("fixture.mp4");
    assert!(
        Command::new(tool("ffmpeg"))
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=64x64:r=5:d=2",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=2",
                "-c:v",
                "mpeg4",
                "-c:a",
                "aac",
                "-shortest"
            ])
            .arg(&media)
            .status()
            .unwrap()
            .success()
    );
    let worker = dir.path().join("fixture-worker.py");
    // An explicit transport double, not a production option. Real media processing is exercised below.
    fs::write(&worker,r#"
import sys,json,pathlib,shutil
req=json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
if req.get('cookie_file'):
    cookie=pathlib.Path(req['cookie_file'])
    assert cookie.parent.samefile(pathlib.Path.cwd())
    cookie.write_text('mutated private copy')
video={'platform':req['platform'],'id':'fixture','title':'Fixture','duration_ms':2000,'canonical_url':req['url'],'width':64,'height':64,'watermark':'unknown'}
if req['action']=='download':
    shutil.copyfile(pathlib.Path(__file__).with_name('fixture.mp4'),'media.mp4')
    video['media_file']='media.mp4'
print(json.dumps({'ok':True,'video':video}))
"#).unwrap();
    let tools = MediaTools::new(tool("ffmpeg"), tool("ffprobe")).unwrap();
    let cancel = CancellationToken::new();
    let service = DownloadService::new(DownloadTools {
        python: tool("python3"),
        worker,
        node: None,
        media: tools.clone(),
    })
    .unwrap();
    let cookies = dir.path().join("user-cookies.txt");
    fs::write(&cookies, "user supplied cookies").unwrap();
    let opts = DownloadOptions {
        cookie_file: Some(cookies.clone()),
        ..Default::default()
    };
    let workspace = dir.path().join("workspace");
    for share in [
        "https://youtu.be/BaW_jenozKc",
        "分享：https://www.bilibili.com/video/BV1g2sQ6FET3?vd_source=secret",
        "https://www.douyin.com/video/123456",
    ] {
        let metadata = service
            .resolve(share, &workspace, &opts, &cancel)
            .await
            .unwrap();
        assert_eq!(metadata.watermark, "unknown");
        let downloaded = service
            .download(share, &workspace, &opts, &cancel)
            .await
            .unwrap();
        assert_eq!(
            fs::read_to_string(&cookies).unwrap(),
            "user supplied cookies"
        );
        assert_eq!(
            fs::read_dir(&downloaded.directory).unwrap().count(),
            2,
            "only media and manifest may be published"
        );
        let (asset, _) = load_download(&downloaded.directory, &tools, &cancel)
            .await
            .unwrap();
        assert_eq!(asset.watermark_state(), WatermarkState::Unknown);
        let request = ExportRequest {
            range: Some(TimeRange {
                start_ms: 500,
                end_ms: 1500,
            }),
            outputs: vec![
                ExportSelection::Audio {
                    format: AudioFormat::Wav,
                },
                ExportSelection::Original,
            ],
        };
        let report = ExportService::new(tools.clone())
            .execute(&asset, &request, None, &dir.path().join("exports"), &cancel)
            .await
            .unwrap();
        assert_eq!(report.status, JobStatus::Partial);
        drop(asset);
        review_download(
            &downloaded.directory,
            true,
            "Generated solid-color test source",
            &tools,
            &cancel,
        )
        .await
        .unwrap();
        let (asset, _) = load_download(&downloaded.directory, &tools, &cancel)
            .await
            .unwrap();
        assert_eq!(asset.watermark_state(), WatermarkState::VerifiedClean);
        let report = ExportService::new(tools.clone())
            .execute(&asset, &request, None, &dir.path().join("exports"), &cancel)
            .await
            .unwrap();
        assert_eq!(report.status, JobStatus::Completed);
        assert_eq!(
            fs::read(report.directory.unwrap().join("original/original.mp4")).unwrap(),
            fs::read(&media).unwrap()
        );
        drop(asset);
        fs::write(downloaded.directory.join("media.mp4"), b"changed").unwrap();
        assert!(
            load_download(&downloaded.directory, &tools, &cancel)
                .await
                .is_err()
        );
    }
    assert!(
        fs::read_dir(workspace).unwrap().all(|entry| entry
            .unwrap()
            .file_name()
            .to_str()
            .unwrap()
            .starts_with("download-")),
        "no cookies or scratch remain"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn cancellation_terminates_descendants_with_inherited_pipes() {
    use linkparsing_core::{Error, process::ToolRunner};
    use std::time::Duration;
    let temp = tempfile::tempdir().unwrap();
    let script = temp.path().join("child.py");
    fs::write(&script,"import subprocess,time,pathlib\np=subprocess.Popen(['/bin/sleep','30'])\npathlib.Path('pid').write_text(str(p.pid))\ntime.sleep(30)\n").unwrap();
    let runner = ToolRunner::new(1, Duration::from_secs(10)).unwrap();
    let token = CancellationToken::new();
    let python = tool("python3");
    let args = [script.into_os_string()];
    let future = runner.run(&python, &args, temp.path(), &token);
    // Keep the executable alive across the spawned future.
    tokio::pin!(future);
    tokio::select! {
        result=&mut future=>panic!("unexpected early result: {result:?}"),
        _=async {while !temp.path().join("pid").exists(){tokio::time::sleep(Duration::from_millis(20)).await;}token.cancel();}=>{},
    }
    assert!(matches!(future.await, Err(Error::Cancelled)));
    let pid = fs::read_to_string(temp.path().join("pid")).unwrap();
    let mut gone = false;
    for _ in 0..50 {
        let status = Command::new("/bin/ps")
            .args(["-o", "stat=", "-p", pid.trim()])
            .output()
            .unwrap();
        let state = String::from_utf8_lossy(&status.stdout);
        if !status.status.success() || state.trim().starts_with('Z') {
            gone = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(gone, "child process survived cancellation");
}

#[cfg(windows)]
#[tokio::test]
#[ignore = "requires Python; checks Windows Job Object descendant cleanup"]
async fn windows_cancellation_terminates_descendants() {
    use linkparsing_core::{Error, process::ToolRunner};
    use std::time::Duration;
    let temp = tempfile::tempdir().unwrap();
    let script = temp.path().join("child.py");
    fs::write(&script, "import subprocess,sys,time,pathlib\np=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)'])\npathlib.Path('pid').write_text(str(p.pid))\ntime.sleep(30)\n").unwrap();
    let runner = ToolRunner::new(1, Duration::from_secs(10)).unwrap();
    let token = CancellationToken::new();
    let python = tool("python");
    let args = [script.into_os_string()];
    let future = runner.run(&python, &args, temp.path(), &token);
    tokio::pin!(future);
    tokio::select! {
        result=&mut future=>panic!("unexpected early result: {result:?}"),
        _=async {while !temp.path().join("pid").exists(){tokio::time::sleep(Duration::from_millis(20)).await;}token.cancel();}=>{},
    }
    assert!(matches!(future.await, Err(Error::Cancelled)));
    let pid = fs::read_to_string(temp.path().join("pid")).unwrap();
    let tasklist =
        PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32/tasklist.exe");
    let mut gone = false;
    for _ in 0..50 {
        let result = Command::new(&tasklist)
            .args([
                "/FI",
                &format!("PID eq {}", pid.trim()),
                "/FO",
                "CSV",
                "/NH",
            ])
            .output()
            .unwrap();
        assert!(result.status.success());
        if !String::from_utf8_lossy(&result.stdout).contains(&format!("\"{}\"", pid.trim())) {
            gone = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(gone, "Windows descendant survived cancellation");
}

#[tokio::test]
#[ignore = "requires Python; verifies parent-enforced download scratch budgets"]
async fn scratch_budget_rejects_large_files_and_aggregate_without_publishing() {
    use linkparsing_core::{Error, download::PlatformFailure, process::ToolRunner};
    use std::time::Duration;
    for (script, delay) in [
        (
            "from pathlib import Path\nPath('media').write_bytes(b'x'*5000)\n",
            false,
        ),
        (
            "from pathlib import Path\nPath('a').write_bytes(b'x'*4000)\nPath('b').write_bytes(b'x'*4000)\n",
            true,
        ),
    ] {
        let temp = tempfile::tempdir().unwrap();
        let script = format!(
            "{script}{}",
            if delay {
                "import time\ntime.sleep(2)\nPath('survived').touch()\n"
            } else {
                ""
            }
        );
        let file = temp.path().join("fixture.py");
        fs::write(&file, script).unwrap();
        let runner = ToolRunner::new(1, Duration::from_secs(5))
            .unwrap()
            .with_scratch_limits(4096, 7000)
            .unwrap();
        let result = runner
            .run(
                &tool("python3"),
                &[file.into_os_string()],
                temp.path(),
                &CancellationToken::new(),
            )
            .await;
        assert!(
            matches!(result, Err(Error::Platform(PlatformFailure::SizeLimit))),
            "{result:?}"
        );
        if delay {
            tokio::time::sleep(Duration::from_millis(2200)).await;
            assert!(
                !temp.path().join("survived").exists(),
                "writer survived the budget stop"
            );
        }
    }
}
