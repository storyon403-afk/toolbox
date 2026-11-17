#!/usr/bin/env python3
"""Offline full-length playback compatibility + real native decoder regression."""
import importlib.util
from pathlib import Path
import json
import shutil
import subprocess
import unittest
spec=importlib.util.spec_from_file_location('desktop_tests',Path(__file__).with_name('test-desktop.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
class PlaybackFlow(module.DesktopFlow):
    def test_unsupported_codec_full_preview_and_original_isolation(self):
        video=self.root/'vp9.webm'
        subprocess.run([shutil.which('ffmpeg'),'-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=15:d=3','-f','lavfi','-i','sine=duration=3','-c:v','libvpx-vp9','-c:a','libopus','-shortest',str(video)],check=True)
        original=video.read_bytes()
        asset=self.call(type='import',path=str(video),workspace=str(self.root))['asset']
        source=self.call(type='preview',asset_id=asset['id'])['preview_path']
        preview=self.call(type='preview',asset_id=asset['id'],playback=True)
        self.assertTrue(preview['playback_copy'])
        path=Path(preview['preview_path'])
        self.assertNotEqual(path,Path(source))
        facts=json.loads(subprocess.check_output([shutil.which('ffprobe'),'-v','error','-show_entries','format=duration:stream=codec_name','-of','json',str(path)]))
        self.assertAlmostEqual(float(facts['format']['duration']),3,delta=.15)
        self.assertEqual([s['codec_name'] for s in facts['streams']],['h264','aac'])
        timestamp=path.stat().st_mtime_ns
        self.assertEqual(self.call(type='preview',asset_id=asset['id'],playback=True),preview)
        self.assertEqual(path.stat().st_mtime_ns,timestamp)
        self.assertEqual(video.read_bytes(),original)
        self.assertEqual(Path(source).read_bytes(),original)
        self.assertEqual(asset['watermark'],'unknown')
        self.call(type='review',asset_id=asset['id'],clean=True,note='Synthetic testsrc fixture')
        report=self.call(type='export',asset_id=asset['id'],destination=str(self.root),request={'range':{'start_ms':500,'end_ms':1000},'outputs':[{'kind':'original'}]})['report']
        self.assertEqual(Path(report['outputs'][0]['files'][0]).read_bytes(),original)
        binary=self.root/'test-player'
        subprocess.run(['xcrun','clang','-fobjc-arc','-fblocks','-Wall','-Wextra','-Werror','-mmacosx-version-min=13.0',str(module.ROOT/'scripts/test-player.m'),'-framework','AppKit','-framework','WebKit','-framework','AVKit','-framework','AVFoundation','-framework','UniformTypeIdentifiers','-framework','CoreVideo','-framework','CoreMedia','-o',str(binary)],check=True)
        subprocess.run([str(binary),str(path)],check=True,timeout=45)
        # Supported H.264/AAC file should be played directly without a second encode.
        compatible=self.root/'compatible.mp4'
        shutil.copyfile(path,compatible)
        asset=self.call(type='import',path=str(compatible),workspace=str(self.root))['asset']
        self.assertFalse(path.exists(), 'old private playback cache leaked')
        self.assertFalse(self.call(type='preview',asset_id=asset['id'],playback=True)['playback_copy'])
    def test_cancelled_preview_has_no_published_copy(self):
        asset=self.import_asset()
        source=Path(self.call(type='preview',asset_id=asset['id'])['preview_path'])
        job=self.send(dict(type='preview',asset_id=asset['id'],playback=True))
        cancel=self.send(dict(type='cancel'))
        self.assertTrue(self.receive(cancel)['ok'])
        self.assertEqual(self.receive(job)['error']['code'],'cancelled')
        self.assertFalse((source.parent/'playback.mp4').exists())
        self.assertFalse(list(source.parent.glob('playback-*')))
if __name__=='__main__': unittest.main(verbosity=2)
