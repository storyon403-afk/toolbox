use crate::{Error, Result};
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::Command,
    sync::Semaphore,
};
use tokio_util::sync::CancellationToken;

const PIPE_LIMIT: usize = 1024 * 1024;
#[derive(Clone)]
pub struct ToolRunner {
    permits: Arc<Semaphore>,
    timeout: Duration,
    scratch_limits: Option<(u64, u64)>,
}
impl ToolRunner {
    pub fn new(concurrency: usize, timeout: Duration) -> Result<Self> {
        if !(1..=4).contains(&concurrency)
            || timeout.is_zero()
            || timeout > Duration::from_secs(3600)
        {
            return Err(Error::Invalid("invalid process limits"));
        }
        Ok(Self {
            permits: Arc::new(Semaphore::new(concurrency)),
            timeout,
            scratch_limits: None,
        })
    }
    /// Poll a private download scratch directory, including native postprocessors.
    /// This bounds publication and detects overshoot; it is not a disk quota.
    pub fn with_scratch_limits(mut self, file_bytes: u64, total_bytes: u64) -> Result<Self> {
        if file_bytes == 0 || total_bytes < file_bytes {
            return Err(Error::Invalid("invalid scratch limits"));
        }
        self.scratch_limits = Some((file_bytes, total_bytes));
        Ok(self)
    }
    pub async fn run(
        &self,
        executable: &Path,
        args: &[OsString],
        cwd: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<u8>> {
        if !executable.is_absolute() || !executable.is_file() {
            return Err(Error::Invalid(
                "tool must be a configured absolute executable path",
            ));
        }
        let _permit = tokio::select! {
            biased;
            _=cancel.cancelled()=>return Err(Error::Cancelled),
            p=self.permits.acquire()=>p.map_err(|_|Error::Cancelled)?,
        };
        let mut command = Command::new(executable);
        command
            .args(args)
            .current_dir(cwd)
            .env_clear()
            .env("LANG", "C")
            .env("LC_ALL", "C")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        // Windows DLL loading and Python need these OS-provided directories.
        // Do not inherit credentials, proxy settings or arbitrary application variables.
        #[cfg(windows)]
        {
            for name in ["SystemRoot", "WINDIR", "TEMP", "TMP", "LOCALAPPDATA"] {
                if let Some(value) = std::env::var_os(name) {
                    command.env(name, value);
                }
            }
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        #[cfg(unix)]
        command.process_group(0);
        let mut child = command.spawn()?;
        #[cfg(unix)]
        let group = ProcessGroup(child.id().ok_or(Error::Cancelled)? as i32);
        #[cfg(windows)]
        let group = windows_job(&child)?;
        let stdout = child
            .stdout
            .take()
            .ok_or(Error::Invalid("missing stdout pipe"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or(Error::Invalid("missing stderr pipe"))?;
        let mut out_task = tokio::spawn(read_bounded(stdout));
        let mut err_task = tokio::spawn(read_bounded(stderr));
        // The timeout covers both the process and pipe draining (including inherited pipes).
        let result = tokio::select! {
            biased;
            _=cancel.cancelled()=>Err(Error::Cancelled),
            _=tokio::time::sleep(self.timeout)=>Err(Error::Timeout),
            result=watch_scratch(cwd, self.scratch_limits)=>result,

            result=async {
                let status=child.wait().await?;
                let out=(&mut out_task).await.map_err(|_|Error::Cancelled)??;
                let err=(&mut err_task).await.map_err(|_|Error::Cancelled)??;
                if out.1 || err.1 {return Err(Error::OutputLimit);}
                if !status.success() {return Err(Error::ToolFailed(status.code()));}
                if let Some(limits) = self.scratch_limits { check_scratch(cwd, limits)?; }
                Ok(out.0)
            }=>result,
        };
        #[cfg(any(unix, windows))]
        drop(group);
        if result.is_err() {
            let _ = child.kill().await;
        }
        out_task.abort();
        err_task.abort();
        result
    }
}

fn check_scratch(root: &Path, (file_limit, total_limit): (u64, u64)) -> Result<()> {
    let mut total = 0_u64;
    let mut entries = 0;
    let mut directories = vec![root.to_path_buf()];
    while let Some(directory) = directories.pop() {
        for entry in std::fs::read_dir(directory)? {
            let entry = entry?;
            entries += 1;
            if entries > 4096 {
                return Err(Error::OutputLimit);
            }
            let metadata = match entry.path().symlink_metadata() {
                Ok(value) => value,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.into()),
            };
            if metadata.is_symlink() {
                return Err(Error::Invalid("scratch contains a symbolic link"));
            }
            if metadata.is_dir() {
                directories.push(entry.path());
            } else if metadata.is_file() {
                total = total.saturating_add(metadata.len());
                if metadata.len() > file_limit || total > total_limit {
                    return Err(Error::Platform(crate::download::PlatformFailure::SizeLimit));
                }
            }
        }
    }
    Ok(())
}
async fn watch_scratch(root: &Path, limits: Option<(u64, u64)>) -> Result<Vec<u8>> {
    let Some(limits) = limits else {
        return std::future::pending().await;
    };
    loop {
        check_scratch(root, limits)?;
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(unix)]
struct ProcessGroup(i32);
#[cfg(unix)]
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        let _ = nix::sys::signal::killpg(
            nix::unistd::Pid::from_raw(self.0),
            nix::sys::signal::Signal::SIGKILL,
        );
    }
}
async fn read_bounded(mut stream: impl AsyncRead + Unpin) -> Result<(Vec<u8>, bool)> {
    let mut data = Vec::new();
    let mut buf = [0; 8192];
    let mut exceeded = false;
    loop {
        let n = stream.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        let keep = n.min(PIPE_LIMIT.saturating_sub(data.len()));
        data.extend_from_slice(&buf[..keep]);
        exceeded |= keep < n;
    }
    Ok((data, exceeded))
}

#[derive(Clone)]
pub struct MediaTools {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    pub runner: ToolRunner,
}
impl MediaTools {
    pub fn new(ffmpeg: PathBuf, ffprobe: PathBuf) -> Result<Self> {
        for p in [&ffmpeg, &ffprobe] {
            if !p.is_absolute() || !p.is_file() {
                return Err(Error::Invalid(
                    "FFmpeg and ffprobe must be installed and configured",
                ));
            }
        }
        Ok(Self {
            ffmpeg,
            ffprobe,
            runner: ToolRunner::new(2, Duration::from_secs(1800))?,
        })
    }
}

// RAII cleanup on cancellation, timeout, normal completion and dropped futures.
// This is process cleanup, not an OS security sandbox.
#[cfg(windows)]
fn windows_job(child: &tokio::process::Child) -> Result<win32job::Job> {
    let mut limits = win32job::ExtendedLimitInfo::new();
    limits.limit_kill_on_job_close();
    let job = win32job::Job::create_with_limit_info(&limits)
        .map_err(|_| Error::Invalid("cannot create Windows process job"))?;
    let handle = child.raw_handle().ok_or(Error::Cancelled)?;
    job.assign_process(handle as isize)
        .map_err(|_| Error::Invalid("cannot assign Windows process job"))?;
    Ok(job)
}
