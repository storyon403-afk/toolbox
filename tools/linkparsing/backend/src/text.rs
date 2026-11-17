use crate::{
    Error, Result,
    domain::{TextFormat, TimeRange},
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextSegment {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Transcript {
    pub segments: Vec<TextSegment>,
}

/// Millisecond source timestamps are retained in the export; SRT is relative to the selected clip.
pub fn render(
    document: &Transcript,
    format: TextFormat,
    range: TimeRange,
    duration_ms: u64,
) -> Result<String> {
    range.validate(duration_ms)?;
    if document.segments.len() > 50_000 {
        return Err(Error::Invalid("too many text segments"));
    }
    let mut total = 0;
    let mut previous = 0;
    for (i, s) in document.segments.iter().enumerate() {
        total += s.text.len();
        if total > 4 * 1024 * 1024
            || s.text.contains('\0')
            || s.start_ms >= s.end_ms
            || s.end_ms > duration_ms
            || (i > 0 && s.start_ms < previous)
        {
            return Err(Error::Invalid("invalid or oversized transcript"));
        }
        previous = s.start_ms;
    }
    let mut result = String::new();
    let mut index = 0;
    for s in &document.segments {
        if s.end_ms <= range.start_ms || s.start_ms >= range.end_ms {
            continue;
        }
        index += 1;
        let start = s.start_ms.max(range.start_ms);
        let end = s.end_ms.min(range.end_ms);
        let body = s.text.replace('\r', "");
        match format {
            TextFormat::Txt => {
                result.push_str(&format!("[{}] {}\n", timestamp(start, false), body))
            }
            TextFormat::Markdown => result.push_str(&format!(
                "- **{}** {}\n",
                timestamp(start, false),
                escape_markdown(&body)
            )),
            TextFormat::Srt => result.push_str(&format!(
                "{}\n{} --> {}\n{}\n\n",
                index,
                timestamp(start - range.start_ms, true),
                timestamp(end - range.start_ms, true),
                body.lines()
                    .filter(|line| !line.trim().is_empty())
                    .collect::<Vec<_>>()
                    .join("\n")
            )),
        }
    }
    if index == 0 {
        return Err(Error::Invalid("no text in the selected range"));
    }
    Ok(result)
}
fn timestamp(ms: u64, srt: bool) -> String {
    let h = ms / 3_600_000;
    let m = ms / 60_000 % 60;
    let s = ms / 1000 % 60;
    if srt {
        format!("{h:02}:{m:02}:{s:02},{:03}", ms % 1000)
    } else {
        format!("{h:02}:{m:02}:{s:02}.{:03}", ms % 1000)
    }
}
fn escape_markdown(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('\\', "\\\\")
        .replace('*', "\\*")
        .replace('_', "\\_")
        .replace('[', "\\[")
        .replace(']', "\\]")
        .replace('`', "\\`")
        .replace('\n', " ")
}
