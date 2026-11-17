#!/usr/bin/env python3
"""Offline real-ASR integration: macOS TTS fixture, FFmpeg, installed Whisper/model."""
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory(prefix='linkparsing-asr-test-') as directory:
        work = Path(directory)
        subprocess.run(['/usr/bin/say', '-v', 'Tingting', '-o', str(work/'speech.aiff'),
                        '这是本地语音识别测试。视频里的声音现在可以转换成文字，并且导出字幕。'], check=True)
        subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-f', 'lavfi',
                        '-i', 'color=c=blue:s=160x90:r=10', '-i', str(work/'speech.aiff'),
                        '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', str(work/'speech.mp4')], check=True)
        app = Path(os.environ.get('LINKPARSING_TEST_APP', str(ROOT/'build/LinkParsing.app')))
        worker = subprocess.Popen([str(app/'Contents/MacOS/linkparsing-desktop')],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        selector = selectors.DefaultSelector()
        selector.register(worker.stdout, selectors.EVENT_READ)
        sequence = 0
        buffer = b''

        def send(**command):
            nonlocal sequence
            sequence += 1
            worker.stdin.write(json.dumps({'id': sequence, 'command': command}).encode()+b'\n')
            worker.stdin.flush()
            return sequence

        def receive():
            nonlocal buffer
            deadline = time.monotonic()+180
            while b'\n' not in buffer:
                if time.monotonic() > deadline:
                    raise AssertionError('ASR timed out')
                if selector.select(timeout=1):
                    chunk = worker.stdout.read1(65536)
                    assert chunk, 'Backend unexpectedly exited'
                    buffer += chunk
            line, buffer = buffer.split(b'\n', 1)
            return json.loads(line)

        def call(**command):
            identifier = send(**command)
            while True:
                reply = receive()
                assert reply['id'] == identifier
                if reply.get('event') == 'progress':
                    continue
                assert reply['ok'], reply.get('error')
                return reply['data']

        try:
            assert call(type='doctor')['asr'], 'Install engine/model before this test'
            asset = call(type='import', path=str(work/'speech.mp4'), workspace=str(work))['asset']
            original_id = asset['id']
            call(type='transcribe', asset_id=original_id, language='zh')
            content = call(type='content', asset_id=original_id, offset=0)['content']
            words = ''.join(s['text'] for s in content['segments'])
            assert '本地' in words and '文字' in words, 'Synthetic speech was not recognized'
            assert asset['watermark'] == 'unknown'
            for fmt in ('txt', 'markdown', 'srt'):
                report = call(type='export', asset_id=original_id, destination=str(work),
                              request={'range':None, 'outputs':[{'kind':'text', 'format':fmt}]})['report']
                assert report['status'] == 'completed'
                exported = Path(report['outputs'][0]['files'][0]).read_text()
                assert '文字' in exported
                if fmt == 'srt':
                    assert ' --> ' in exported
            # A cancelled replacement must retain the successful transcript and cache.
            job = send(type='transcribe', asset_id=original_id, language='zh')
            while True:
                event = receive()
                assert event.get('event') == 'progress', 'Unexpected early completion'
                if event['data']['stage'] == 'recognizing':
                    break
            cancel = send(type='cancel')
            replies = {}
            while len(replies) < 2:
                reply = receive()
                if 'event' not in reply:
                    replies[reply['id']] = reply
            assert replies[cancel]['ok']
            assert replies[job]['error']['code'] == 'cancelled'
            assert not list(work.glob('asr-*')), 'Temporary audio remained after cancellation'
            assert call(type='content', asset_id=original_id, offset=0)['content'] == content
            asset = call(type='import', path=str(work/'speech.mp4'), workspace=str(work))['asset']
            assert asset['has_transcript'], 'Cached transcript not restored'
            assert call(type='content', asset_id=asset['id'], offset=0)['content'] == content
            send(type='transcribe', asset_id=original_id, language='zh')
            assert not receive()['ok'], 'Stale asset accepted'
            send(type='transcribe', asset_id=asset['id'], language='../../invalid')
            assert not receive()['ok'], 'Invalid language accepted'
            subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-i', str(work/'speech.mp4'),
                            '-an', '-c:v', 'copy', str(work/'silent.mp4')], check=True)
            silent = call(type='import', path=str(work/'silent.mp4'), workspace=str(work))['asset']
            send(type='transcribe', asset_id=silent['id'], language='zh')
            rejected = receive()
            assert not rejected['ok'] and '没有音轨' in rejected['error']['message']
            assert not list(work.glob('asr-*'))
            print('PASS: real Chinese speech → timestamped transcript → TXT/Markdown/SRT; watermark independence; cancellation preserves text and removes temporary audio; cache restore; stale ID/language/no-audio rejected.')
        finally:
            worker.stdin.close()
            worker.wait(timeout=15)
            assert worker.stderr.read() == b''
            selector.close()


if __name__ == '__main__':
    main()
