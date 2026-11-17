#!/usr/bin/env python3
"""构建本机开发应用；所有外部程序均用参数数组调用。"""
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'build/LinkParsing.app'


def run(*args, **kwargs):
    subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def build():
    if sys.platform != 'darwin':
        raise SystemExit('应用构建仅支持 macOS。')
    for tool in ('cargo', 'xcrun', 'swift', 'sips', 'iconutil', 'codesign'):
        if not shutil.which(tool):
            raise SystemExit(f'缺少构建工具：{tool}')
    resources = APP / 'Contents/Resources'
    binaries = APP / 'Contents/MacOS'
    icons = ROOT / 'build/LinkParsing.iconset'
    for directory in (resources / 'Desktop', resources / 'Worker', binaries, icons):
        directory.mkdir(parents=True, exist_ok=True)
    run('swift', ROOT / 'scripts/render-icon.swift', ROOT / 'icon/app-icon.svg',
        ROOT / 'build/rendered-icon.png')
    run('sips', '-z', 1024, 1024, ROOT / 'build/rendered-icon.png',
        '--out', ROOT / 'build/app-icon.png', stdout=subprocess.DEVNULL)
    for size in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            suffix = '@2x' if scale == 2 else ''
            run('sips', '-z', size * scale, size * scale, ROOT / 'build/app-icon.png',
                '--out', icons / f'icon_{size}x{size}{suffix}.png', stdout=subprocess.DEVNULL)
    run('iconutil', '-c', 'icns', icons, '-o', resources / 'LinkParsing.icns')
    env = dict(os.environ, CARGO_TARGET_DIR=str(ROOT / 'target'))
    run('cargo', 'build', '--locked', '--offline', '--release', '-p', 'linkparsing-core',
        cwd=ROOT, env=env)
    shutil.copy2(ROOT / 'target/release/linkparsing', binaries / 'linkparsing-cli')
    shutil.copy2(ROOT / 'target/release/linkparsing-desktop', binaries / 'linkparsing-desktop')
    for name in ('index.html', 'app.css', 'app.js', 'logic.js'):
        shutil.copy2(ROOT / 'desktop' / name, resources / 'Desktop' / name)
    shutil.copy2(ROOT / 'backend/worker/download.py', resources / 'Worker/download.py')
    python = os.environ.get('LINKPARSING_PYTHON', str(ROOT / 'backend/.venv/bin/python'))
    with (resources / 'Runtime.plist').open('wb') as file:
        plistlib.dump({'Python': python,
                      'FFmpeg': shutil.which('ffmpeg') or '',
                      'FFprobe': shutil.which('ffprobe') or '',
                      'Node': shutil.which('node') or '',
                      'Whisper': os.environ.get('LINKPARSING_WHISPER', shutil.which('whisper-cli') or '/opt/homebrew/bin/whisper-cli'),
                      'ASRModel': os.environ.get('LINKPARSING_ASR_MODEL', str(Path.home() / 'Library/Application Support/LinkParsing/Models/ggml-large-v3-turbo-q5_0.bin'))}, file)
    run('xcrun', 'clang', '-fobjc-arc', '-Wall', '-Wextra', '-Werror',
        '-mmacosx-version-min=13.0', ROOT / 'macos/OCR.m', '-framework', 'Foundation',
        '-framework', 'Vision', '-o', binaries / 'linkparsing-ocr')
    run('codesign', '--force', '--sign', '-', binaries / 'linkparsing-ocr')
    run('xcrun', 'clang', '-fobjc-arc', '-fblocks', '-Wall', '-Wextra', '-Werror',
        '-mmacosx-version-min=13.0', ROOT / 'macos/App.m', '-framework', 'AppKit',
        '-framework', 'WebKit', '-framework', 'AVKit', '-framework', 'AVFoundation',
        '-framework', 'UniformTypeIdentifiers', '-o', binaries / 'LinkParsing')
    info = {
        'CFBundleExecutable': 'LinkParsing',
        'CFBundleIdentifier': 'dev.linkparsing.preview',
        'CFBundleName': 'LinkParsing',
        'CFBundleDisplayName': 'LinkParsing',
        'CFBundleIconFile': 'LinkParsing.icns',
        'CFBundlePackageType': 'APPL',
        'CFBundleShortVersionString': '0.3.0',
        'CFBundleVersion': '3',
        'CFBundleDevelopmentRegion': 'zh-Hans',
        'LSMinimumSystemVersion': '13.0',
        'NSHighResolutionCapable': True,
        'NSPrincipalClass': 'NSApplication',
    }
    with (APP / 'Contents/Info.plist').open('wb') as file:
        plistlib.dump(info, file)
    run('codesign', '--force', '--sign', '-', binaries / 'linkparsing-cli')
    run('codesign', '--force', '--sign', '-', binaries / 'linkparsing-desktop')
    run('codesign', '--force', '--sign', '-', APP)
    run('codesign', '--verify', '--deep', '--strict', APP)
    run(binaries / 'LinkParsing', '--self-check')
    print(APP)


if __name__ == '__main__':
    build()
