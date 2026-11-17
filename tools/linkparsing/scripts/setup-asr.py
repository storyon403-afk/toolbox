#!/usr/bin/env python3
"""Install the pinned multilingual Whisper model; never reads user media."""
import hashlib
from pathlib import Path
import shutil
import subprocess

MODEL = 'ggml-large-v3-turbo-q5_0.bin'
SHA256 = '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2'
REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1'
DIRECTORY = Path.home() / 'Library/Application Support/LinkParsing/Models'


def digest(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()


def main():
    if not shutil.which('whisper-cli'):
        raise SystemExit('请先运行 brew install whisper-cpp，再重新运行此脚本。')
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    model = DIRECTORY / MODEL
    if model.is_file() and digest(model) == SHA256:
        print('ASR 模型已就绪。')
        return
    partial = DIRECTORY / (MODEL + '.part')
    subprocess.run(['curl', '--fail', '--location', '--silent', '--show-error',
                    '--retry', '3', '--connect-timeout', '30', '--max-time', '1800',
                    '--output', str(partial),
                    f'https://huggingface.co/ggerganov/whisper.cpp/resolve/{REVISION}/{MODEL}'], check=True)
    if digest(partial) != SHA256:
        partial.unlink()
        raise SystemExit('模型校验失败，未启用。请重新下载。')
    partial.replace(model)
    print('ASR 模型已下载并通过 SHA-256 校验。')


if __name__ == '__main__':
    main()
