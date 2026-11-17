#![forbid(unsafe_code)]

pub mod asr;
pub mod desktop;
pub mod domain;
pub mod download;
pub mod export;
pub mod media;
pub mod ocr;
pub mod playback;
pub mod process;
pub mod runtime;
pub mod source;
pub mod text;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid request: {0}")]
    Invalid(&'static str),
    #[error("unsupported source")]
    UnsupportedSource,
    #[error("platform operation failed: {0}")]
    Platform(download::PlatformFailure),
    #[error("ambiguous input: provide one video URL")]
    AmbiguousSource,
    #[error("operation cancelled")]
    Cancelled,
    #[error("media tool timed out")]
    Timeout,
    #[error("media tool produced too much diagnostic output")]
    OutputLimit,
    #[error("media tool failed (exit code {0:?}); raw diagnostics withheld")]
    ToolFailed(Option<i32>),
    #[error("I/O failure ({0:?})")]
    Io(std::io::ErrorKind),
    #[error("invalid JSON data")]
    Json,
}

impl From<std::io::Error> for Error {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value.kind())
    }
}
impl From<serde_json::Error> for Error {
    fn from(_: serde_json::Error) -> Self {
        Self::Json
    }
}
pub type Result<T> = std::result::Result<T, Error>;
