#!/usr/bin/env python3
"""Run real media/ASR/OCR checks against a relocated package, with bundled dependencies."""
import os
from pathlib import Path
import plistlib
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
app = Path(sys.argv[1]).resolve()
resources = app / 'Contents/Resources'
with (resources / 'Runtime.plist').open('rb') as file:
    config = plistlib.load(file)
env = dict(os.environ, LINKPARSING_TEST_APP=str(app))
for key, name in [('Python','PYTHON'),('FFmpeg','FFMPEG'),('FFprobe','FFPROBE'),('Node','NODE'),('Whisper','WHISPER'),('ASRModel','ASR_MODEL')]:
    assert not Path(config[key]).is_absolute(), 'Packaged runtime must be relative: ' + key
    target = resources / config[key]
    assert target.is_file(), target
    env['LINKPARSING_' + name] = str(target)
env['LINKPARSING_WORKER'] = str(resources / 'Worker/download.py')
env['LINKPARSING_OCR'] = str(app / 'Contents/MacOS/linkparsing-ocr')
for test in ['test-desktop.py','test-playback.py','test-ocr.py','test-asr.py']:
    subprocess.run([sys.executable, str(ROOT/'scripts'/test)], env=env, check=True, timeout=180)
subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
print('PASS: relocated package uses bundled Python, Node, FFmpeg/ffprobe, Whisper/model and native OCR for real operations.')
