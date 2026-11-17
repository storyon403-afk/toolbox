#!/usr/bin/env python3
"""Build index.html as a self-contained file, usable offline or through the Go service."""
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def build():
    # Generate only the public starter document, never embed the live database.
    snapshot = json.loads((ROOT / 'seed.json').read_text(encoding='utf-8'))
    snapshot['versions'][0]['createdAt'] = '2026-11-01T00:00:00+00:00'
    snapshot['sequence'] = 0
    css = (ROOT / 'style.css').read_text(encoding='utf-8')
    script = (ROOT / 'app.js').read_text(encoding='utf-8')
    script = re.sub(r'</script', r'<\\/script', script, flags=re.I)
    seed = json.dumps(snapshot, ensure_ascii=False).replace('<', '\\u003c')
    html = (ROOT / 'index.template.html').read_text(encoding='utf-8')
    html = html.replace('<link rel="stylesheet" href="/style.css">',
                        '<style id="offlineStyle">' + css + '</style>')
    html = html.replace('<script src="/app.js"></script>',
                        '<script>window.__SNAPSHOT__=' + seed + ';</script>\n'
                        '<script id="offlineApp">' + script + '</script>')
    (ROOT / 'index.html').write_text(html, encoding='utf-8')


if __name__ == '__main__':
    build()
    print('Built design/index.html (self-contained)')
