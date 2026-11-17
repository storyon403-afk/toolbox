#!/usr/bin/env python3
"""Real macOS Vision + FFmpeg + desktop IPC. No platform/network requests."""
import importlib.util
from pathlib import Path
import shutil
import subprocess
import unittest

spec = importlib.util.spec_from_file_location('desktop_tests', Path(__file__).with_name('test-desktop.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class OCRFlow(module.DesktopFlow):
    def test_real_ocr_cache_export_and_failures(self):
        image = self.root/'fixture.png'
        subprocess.run(['swift', str(module.ROOT/'scripts/ocr-fixture.swift'), str(image)],check=True)
        video = self.root/'screen.mp4'
        subprocess.run([shutil.which('ffmpeg'),'-v','error','-loop','1','-i',str(image),'-t','3','-r','10','-c:v','mpeg4','-pix_fmt','yuv420p',str(video)],check=True)
        asset = self.call(type='import',path=str(video),workspace=str(self.root))['asset']
        self.assertTrue(self.call(type='doctor')['ocr'])
        command = dict(type='ocr',asset_id=asset['id'],range=None,interval_ms=1000,language='zh')
        result = self.call(**command)['asset']
        self.assertTrue(result['has_ocr'])
        self.assertFalse(result['has_transcript'])
        self.assertEqual(result['watermark'],'unknown')
        content = self.call(type='content',asset_id=asset['id'],offset=0,text_source='ocr')['content']
        words = ''.join(s['text'] for s in content['segments'])
        self.assertIn('LinkParsing',words)
        self.assertIn('本地',words)
        self.assertEqual(content['total'],1) # Identical sampled screens coalesce.
        self.assertEqual(content['segments'][0]['end_ms'],3000)
        for fmt in ('txt','markdown','srt'):
            report = self.call(type='export',asset_id=asset['id'],text_source='ocr',destination=str(self.root),request={'range':None,'outputs':[{'kind':'text','format':fmt},{'kind':'original'}]})['report']
            self.assertEqual([o['status'] for o in report['outputs']],['completed','blocked'])
            self.assertIn('LinkParsing',Path(report['outputs'][0]['files'][0]).read_text())
        # Explicit speech selection cannot silently export OCR as speech.
        self.assertFalse(self.receive(self.send(dict(type='content',asset_id=asset['id'],offset=0)))['ok'])
        for overrides in (dict(interval_ms=0),dict(language='../../bad'),dict(range={'start_ms':3000,'end_ms':4000})):
            self.assertFalse(self.receive(self.send(command | overrides))['ok'])
        self.assertEqual(self.call(type='content',asset_id=asset['id'],offset=0,text_source='ocr')['content'],content)
        job = self.send(command)
        cancel = self.send(dict(type='cancel'))
        self.assertTrue(self.receive(cancel)['ok'])
        self.assertEqual(self.receive(job)['error']['code'],'cancelled')
        self.assertFalse(list(self.root.glob('ocr-*')))
        asset = self.call(type='import',path=str(video),workspace=str(self.root))['asset']
        self.assertTrue(asset['has_ocr'])
        self.assertEqual(self.call(type='content',asset_id=asset['id'],offset=0,text_source='ocr')['content'],content)
        # Cache corruption is ignored; unrelated source never inherits OCR.
        cache = next(self.root.glob('.linkparsing-ocr-*.json'))
        cache.write_text('{}')
        asset = self.call(type='import',path=str(video),workspace=str(self.root))['asset']
        self.assertFalse(asset['has_ocr'])
        blank = self.import_asset()
        self.assertFalse(self.receive(self.send(command | dict(asset_id=blank['id'])))['ok'])
        self.assertFalse(list(self.root.glob('ocr-*')))

if __name__ == '__main__':
    unittest.main(verbosity=2)
