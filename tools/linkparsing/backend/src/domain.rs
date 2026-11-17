use crate::{Error, Result};
use serde::{Deserialize, Serialize};

pub const MAX_DURATION_MS: u64 = 12 * 60 * 60 * 1000;
pub const MAX_FRAME_COUNT: usize = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TimeRange {
    pub start_ms: u64,
    pub end_ms: u64,
}
impl TimeRange {
    pub fn validate(self, duration_ms: u64) -> Result<Self> {
        if self.start_ms >= self.end_ms || self.end_ms > duration_ms {
            return Err(Error::Invalid(
                "range must be nonempty and within the source",
            ));
        }
        Ok(self)
    }
    pub fn duration_ms(self) -> u64 {
        self.end_ms - self.start_ms
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextFormat {
    Txt,
    Markdown,
    Srt,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioFormat {
    Mp3,
    Wav,
    M4a,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImageFormat {
    Png,
    Jpg,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ExportSelection {
    Text {
        format: TextFormat,
    },
    Audio {
        format: AudioFormat,
    },
    Frames {
        format: ImageFormat,
        timestamps_ms: Vec<u64>,
    },
    Original,
}
impl ExportSelection {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Text { .. } => "text",
            Self::Audio { .. } => "audio",
            Self::Frames { .. } => "frames",
            Self::Original => "original",
        }
    }
    pub fn is_visual(&self) -> bool {
        matches!(self, Self::Frames { .. } | Self::Original)
    }
}

/// The untrusted UI contract intentionally contains no watermark status or command strings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExportRequest {
    pub range: Option<TimeRange>,
    pub outputs: Vec<ExportSelection>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WatermarkState {
    Pending,
    VerifiedClean,
    Watermarked,
    Unknown,
    Unavailable,
}

/// Trusted internal result; deliberately not deserializable from IPC.
#[derive(Debug, Clone)]
pub struct SourceReview {
    pub(crate) sha256: String,
    pub(crate) state: WatermarkState,
    pub(crate) provenance: String,
}
impl SourceReview {
    /// Called only by the review workflow after an explicit human review, never by a download adapter.
    /// A content hash binds that human assertion to the exact imported bytes; it is not an automated detector.
    pub fn manual(sha256: String, clean: bool, note: String) -> Result<Self> {
        if sha256.len() != 64
            || !sha256.bytes().all(|b| b.is_ascii_hexdigit())
            || note.trim().is_empty()
            || note.len() > 500
        {
            return Err(Error::Invalid(
                "review requires a source digest and a nonempty note",
            ));
        }
        Ok(Self {
            sha256,
            state: if clean {
                WatermarkState::VerifiedClean
            } else {
                WatermarkState::Watermarked
            },
            provenance: format!("manual_review: {}", note.trim()),
        })
    }
    pub fn provenance(&self) -> &str {
        &self.provenance
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct MediaFacts {
    pub duration_ms: u64,
    pub has_audio: bool,
    pub has_video: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockReason {
    WatermarkNotVerified,
    NoAudio,
    NoVideo,
}
#[derive(Debug, Clone, Serialize)]
pub struct PlannedOutput {
    pub selection: ExportSelection,
    pub range: TimeRange,
    pub blocked: Option<BlockReason>,
}

pub fn plan(
    request: &ExportRequest,
    facts: &MediaFacts,
    watermark: WatermarkState,
) -> Result<Vec<PlannedOutput>> {
    if facts.duration_ms == 0 || facts.duration_ms > MAX_DURATION_MS {
        return Err(Error::Invalid("unsupported media duration"));
    }
    if request.outputs.is_empty() || request.outputs.len() > 4 {
        return Err(Error::Invalid("choose one to four output categories"));
    }
    let full = TimeRange {
        start_ms: 0,
        end_ms: facts.duration_ms,
    };
    let range = request.range.unwrap_or(full).validate(facts.duration_ms)?;
    let mut seen = std::collections::HashSet::new();
    request
        .outputs
        .iter()
        .map(|selection| {
            if !seen.insert(selection.kind()) {
                return Err(Error::Invalid("duplicate output category"));
            }
            if let ExportSelection::Frames { timestamps_ms, .. } = selection {
                if timestamps_ms.is_empty() || timestamps_ms.len() > MAX_FRAME_COUNT {
                    return Err(Error::Invalid("choose 1 to 300 frames"));
                }
                let mut times = std::collections::HashSet::new();
                if timestamps_ms
                    .iter()
                    .any(|t| *t < range.start_ms || *t >= range.end_ms || !times.insert(*t))
                {
                    return Err(Error::Invalid(
                        "frame timestamps must be unique and inside the selected range",
                    ));
                }
            }
            let blocked = match selection {
                ExportSelection::Audio { .. } if !facts.has_audio => Some(BlockReason::NoAudio),
                ExportSelection::Frames { .. } | ExportSelection::Original if !facts.has_video => {
                    Some(BlockReason::NoVideo)
                }
                s if s.is_visual() && watermark != WatermarkState::VerifiedClean => {
                    Some(BlockReason::WatermarkNotVerified)
                }
                _ => None,
            };
            Ok(PlannedOutput {
                selection: selection.clone(),
                range: if matches!(selection, ExportSelection::Original) {
                    full
                } else {
                    range
                },
                blocked,
            })
        })
        .collect()
}
