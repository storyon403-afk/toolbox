use linkparsing_core::{
    domain::*,
    source::{Platform, parse_share},
    text::{TextSegment, Transcript, render},
};
fn facts() -> MediaFacts {
    MediaFacts {
        duration_ms: 504000,
        has_audio: true,
        has_video: true,
    }
}
fn request(outputs: Vec<ExportSelection>) -> ExportRequest {
    ExportRequest {
        range: Some(TimeRange {
            start_ms: 30000,
            end_ms: 300000,
        }),
        outputs,
    }
}

#[test]
fn parses_share_copy_with_chinese_prefix() {
    let link = parse_share("打开抖音看看：https://v.douyin.com/abc123/ 复制此链接").unwrap();
    assert_eq!(link.platform, Platform::Douyin);
    assert_eq!(link.url.as_str(), "https://v.douyin.com/abc123/");
}
#[test]
fn accepts_supported_short_links() {
    for link in [
        "https://youtu.be/abc",
        "https://b23.tv/abc",
        "https://www.bilibili.com/video/BVabc",
    ] {
        assert!(parse_share(link).is_ok());
    }
}
#[test]
fn rejects_unsafe_urls() {
    for link in [
        "https://youtube.com.evil.test/video",
        "https://youtube.com@127.0.0.1/video",
        "https://user:password@youtube.com/video",
        "https://127.0.0.1/a",
        "https://www.youtube.com:8443/a",
        "file:///etc/passwd",
        "https://evil.test/?next=youtube.com",
    ] {
        assert!(parse_share(link).is_err(), "{link}");
    }
}
#[test]
fn rejects_ambiguous_links() {
    assert!(parse_share("https://youtu.be/a https://youtu.be/b").is_err());
}
#[test]
fn original_always_uses_complete_source() {
    let plans = plan(
        &request(vec![ExportSelection::Original]),
        &facts(),
        WatermarkState::VerifiedClean,
    )
    .unwrap();
    assert_eq!(
        plans[0].range,
        TimeRange {
            start_ms: 0,
            end_ms: 504000
        }
    );
}
#[test]
fn watermark_failure_does_not_block_audio() {
    let plans = plan(
        &request(vec![
            ExportSelection::Audio {
                format: AudioFormat::Mp3,
            },
            ExportSelection::Original,
        ]),
        &facts(),
        WatermarkState::Unknown,
    )
    .unwrap();
    assert_eq!(plans[0].blocked, None);
    assert_eq!(plans[1].blocked, Some(BlockReason::WatermarkNotVerified));
}
#[test]
fn all_unverified_states_block_visuals() {
    for state in [
        WatermarkState::Pending,
        WatermarkState::Unknown,
        WatermarkState::Watermarked,
        WatermarkState::Unavailable,
    ] {
        let p = plan(&request(vec![ExportSelection::Original]), &facts(), state).unwrap();
        assert!(p[0].blocked.is_some());
    }
}
#[test]
fn frontend_cannot_claim_clean_media() {
    assert!(
        serde_json::from_str::<ExportRequest>(
            r#"{"range":null,"outputs":[{"kind":"original"}],"watermark":"verified_clean"}"#
        )
        .is_err()
    );
}
#[test]
fn rejects_duplicate_output_categories() {
    assert!(
        plan(
            &request(vec![ExportSelection::Original, ExportSelection::Original]),
            &facts(),
            WatermarkState::VerifiedClean
        )
        .is_err()
    );
}
#[test]
fn rejects_out_of_range_frames() {
    let r = request(vec![ExportSelection::Frames {
        format: ImageFormat::Png,
        timestamps_ms: vec![300000],
    }]);
    assert!(plan(&r, &facts(), WatermarkState::VerifiedClean).is_err());
}
#[test]
fn rejects_reversed_range() {
    assert!(
        TimeRange {
            start_ms: 2000,
            end_ms: 1000
        }
        .validate(3000)
        .is_err()
    );
}
#[test]
fn absent_audio_is_independent_failure() {
    let mut f = facts();
    f.has_audio = false;
    let p = plan(
        &request(vec![
            ExportSelection::Audio {
                format: AudioFormat::Wav,
            },
            ExportSelection::Original,
        ]),
        &f,
        WatermarkState::VerifiedClean,
    )
    .unwrap();
    assert_eq!(p[0].blocked, Some(BlockReason::NoAudio));
    assert_eq!(p[1].blocked, None);
}
#[test]
fn srt_clips_and_rebases_timestamps() {
    let transcript = Transcript {
        segments: vec![
            TextSegment {
                start_ms: 0,
                end_ms: 2000,
                text: "你好".into(),
            },
            TextSegment {
                start_ms: 2000,
                end_ms: 3500,
                text: "世界".into(),
            },
        ],
    };
    let result = render(
        &transcript,
        TextFormat::Srt,
        TimeRange {
            start_ms: 1000,
            end_ms: 3000,
        },
        4000,
    )
    .unwrap();
    assert_eq!(
        result,
        "1\n00:00:00,000 --> 00:00:01,000\n你好\n\n2\n00:00:01,000 --> 00:00:02,000\n世界\n\n"
    );
}
#[test]
fn text_export_rejects_invalid_segments() {
    let t = Transcript {
        segments: vec![TextSegment {
            start_ms: 2000,
            end_ms: 1000,
            text: "bad".into(),
        }],
    };
    assert!(
        render(
            &t,
            TextFormat::Txt,
            TimeRange {
                start_ms: 0,
                end_ms: 4000
            },
            4000
        )
        .is_err()
    );
}
#[test]
fn markdown_escapes_active_content() {
    let t = Transcript {
        segments: vec![TextSegment {
            start_ms: 0,
            end_ms: 1000,
            text: "<script>x</script> [a](javascript:x)".into(),
        }],
    };
    let result = render(
        &t,
        TextFormat::Markdown,
        TimeRange {
            start_ms: 0,
            end_ms: 1000,
        },
        1000,
    )
    .unwrap();
    assert!(!result.contains("<script>"));
    assert!(!result.contains("[a]"));
}
#[test]
fn removes_share_tracking_but_keeps_video_and_part_selectors() {
    use linkparsing_core::source::parse_share;
    for (share, expected) in [
        (
            "https://www.bilibili.com/video/BV1g2sQ6FET3?vd_source=private&p=2#tracking",
            "https://www.bilibili.com/video/BV1g2sQ6FET3?p=2",
        ),
        (
            "https://www.youtube.com/watch?v=BaW_jenozKc&si=private&list=ignored",
            "https://www.youtube.com/watch?v=BaW_jenozKc",
        ),
        (
            "https://www.douyin.com/?modal_id=123&secret=private",
            "https://www.douyin.com/?modal_id=123",
        ),
    ] {
        assert_eq!(parse_share(share).unwrap().url.as_str(), expected);
    }
}
