#!/usr/bin/env python3
"""安装当前用户的启动入口，不覆盖已有命令，不修改 shell 配置。"""
from pathlib import Path
import os
import shlex

ROOT = Path(__file__).resolve().parents[1]
app = ROOT / 'build/LinkParsing.app'
if not (app / 'Contents/MacOS/LinkParsing').is_file():
    raise SystemExit('请先运行 ./LP build。')
command = Path.home() / '.local/bin/linkparsing'
shortcut = Path.home() / 'Applications/LinkParsing.app'
wrapper = '#!/bin/sh\nexec ' + shlex.quote(str(ROOT / 'LP')) + ' "$@"\n'
# 先检查全部目的地，避免冲突时只安装一半。
if command.is_symlink() or (command.exists() and command.read_text() != wrapper):
    raise SystemExit(f'保留已有命令，安装已停止：{command}')
if shortcut.is_symlink():
    if shortcut.resolve() != app.resolve():
        raise SystemExit(f'保留已有应用链接，安装已停止：{shortcut}')
elif shortcut.exists():
    raise SystemExit(f'保留已有应用，安装已停止：{shortcut}')
command.parent.mkdir(parents=True, exist_ok=True)
shortcut.parent.mkdir(parents=True, exist_ok=True)
if not command.exists():
    with command.open('x') as file:
        file.write(wrapper)
    command.chmod(0o755)
if not shortcut.is_symlink():
    shortcut.symlink_to(app, target_is_directory=True)
print(f'命令：{command}\n应用：{shortcut}')
if str(command.parent) not in os.environ.get('PATH', '').split(os.pathsep):
    print('请将以下一行加入 shell 配置后打开新终端：\nexport PATH="$HOME/.local/bin:$PATH"')
