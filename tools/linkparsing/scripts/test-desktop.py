#!/usr/bin/env python3
"""Offline end-to-end checks against the built desktop IPC process and real FFmpeg."""
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
BINARY = Path(os.environ.get('LINKPARSING_TEST_APP', str(ROOT / 'build/LinkParsing.app'))) / 'Contents/MacOS/linkparsing-desktop'


class DesktopFlow(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='linkparsing desktop ')
        self.root = Path(self.temp.name)
        self.media = self.root / 'fixture ; $(not-a-command).mp4'
        subprocess.run([shutil.which('ffmpeg'), '-nostdin', '-v', 'error', '-f', 'lavfi',
                        '-i', 'color=c=blue:s=160x90:r=10:d=2', '-f', 'lavfi',
                        '-i', 'sine=frequency=440:duration=2', '-c:v', 'mpeg4',
                        '-c:a', 'aac', '-shortest', str(self.media)], check=True)
        self.worker = subprocess.Popen([str(BINARY)], stdin=subprocess.PIPE,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.worker.stdout, selectors.EVENT_READ)
        self.counter = 0
        self.buffer = b''
        self.replies = {}

    def tearDown(self):
        if self.worker.poll() is None:
            self.worker.stdin.close()
            try:
                self.worker.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.worker.terminate()
                self.worker.wait(timeout=15)
        self.assertEqual(self.worker.stderr.read(), b'')
        self.worker.stdout.close()
        self.worker.stderr.close()
        self.selector.close()
        self.temp.cleanup()

    def send(self, command):
        self.counter += 1
        self.worker.stdin.write(json.dumps({'id': self.counter, 'command': command}).encode()+b'\n')
        self.worker.stdin.flush()
        return self.counter

    def receive(self, identifier):
        deadline = time.monotonic() + 30
        while identifier not in self.replies:
            if time.monotonic() > deadline:
                self.fail('Desktop backend timed out')
            if not self.selector.select(timeout=1):
                continue
            chunk = self.worker.stdout.read1(65536)
            self.assertTrue(chunk, 'Backend exited before responding')
            self.buffer += chunk
            while b'\n' in self.buffer:
                line, self.buffer = self.buffer.split(b'\n', 1)
                reply = json.loads(line)
                if reply.get('event') != 'progress':
                    self.replies[reply['id']] = reply
        return self.replies.pop(identifier)

    def call(self, **command):
        reply = self.receive(self.send(command))
        self.assertTrue(reply['ok'], 'Desktop operation failed')
        return reply['data']

    def import_asset(self):
        return self.call(type='import', path=str(self.media), workspace=str(self.root))['asset']

    def test_import_review_export_and_cleanup(self):
        asset = self.import_asset()
        self.assertEqual(asset['watermark'], 'unknown')
        self.assertTrue(asset['facts']['has_audio'])
        self.assertEqual(asset['facts']['duration_ms'], 2000)
        transcript = self.root/'transcript.json'
        transcript.write_text(json.dumps({'segments':[{'start_ms':0,'end_ms':2000,'text':'<script>not executable</script>'}]}))
        self.call(type='transcript', asset_id=asset['id'], path=str(transcript))
        content = self.call(type='content', asset_id=asset['id'], offset=0)['content']
        self.assertEqual(content['total'], 1)
        self.assertEqual(content['segments'][0]['text'], '<script>not executable</script>')
        self.assertIsNone(content['next_offset'])
        request = {'range': {'start_ms':500,'end_ms':1500}, 'outputs':[
            {'kind':'audio','format':'wav'}, {'kind':'text','format':'srt'},
            {'kind':'frames','format':'png','timestamps_ms':[750]}, {'kind':'original'}]}
        report = self.call(type='export', asset_id=asset['id'], request=request, destination=str(self.root))['report']
        self.assertEqual(report['status'], 'partial')
        self.assertEqual([o['status'] for o in report['outputs']], ['completed','completed','blocked','blocked'])
        self.assertIn('00:00:00,000 --> 00:00:01,000', Path(report['outputs'][1]['files'][0]).read_text())
        audio = report['outputs'][0]['files'][0]
        duration = subprocess.check_output([shutil.which('ffprobe'),'-v','error','-show_entries','format=duration','-of','csv=p=0',audio], text=True)
        self.assertAlmostEqual(float(duration),1.0,places=2)
        preview = self.call(type='preview', asset_id=asset['id'])
        self.assertEqual(Path(preview['preview_path']).read_bytes(), self.media.read_bytes())
        # This test created the source from a solid color. This is not a production UI assertion.
        self.call(type='review', asset_id=asset['id'], clean=True, note='Synthetic solid-color test fixture')
        report = self.call(type='export', asset_id=asset['id'], request=request, destination=str(self.root))['report']
        self.assertEqual(report['status'], 'completed')
        self.assertEqual(Path(report['outputs'][3]['files'][0]).read_bytes(), self.media.read_bytes())
        self.assertGreater(Path(report['outputs'][2]['files'][0]).stat().st_size,0)
        self.call(type='review', asset_id=asset['id'], clean=False, note='Synthetic re-review blocking test')
        report = self.call(type='export', asset_id=asset['id'], request=request, destination=str(self.root))['report']
        self.assertEqual(report['outputs'][3]['status'],'blocked')
        old_id = asset['id']
        asset = self.import_asset()
        self.assertNotEqual(old_id,asset['id'])
        self.assertFalse(self.receive(self.send({'type':'preview','asset_id':old_id}))['ok'])
        self.assertEqual(asset['watermark'],'unknown')
        self.assertFalse(asset['has_transcript'])
        self.worker.stdin.close()
        self.assertEqual(self.worker.wait(timeout=15),0)
        self.assertFalse(list(self.root.glob('source-*')))
        self.assertTrue(list(self.root.glob('export-*')))

    def test_cancellation_and_untrusted_fields(self):
        asset = self.import_asset()
        self.call(type='review',asset_id=asset['id'],clean=True,note='Generated solid-color fixture')
        request = {'range':None,'outputs':[{'kind':'frames','format':'png','timestamps_ms':list(range(0,2000,10))}]}
        job = self.send({'type':'export','asset_id':asset['id'],'request':request,'destination':str(self.root)})
        cancel = self.send({'type':'cancel'})
        self.assertTrue(self.receive(cancel)['ok'])
        result = self.receive(job)
        self.assertTrue((not result['ok'] and result['error']['code']=='cancelled') or
                        (result['ok'] and result['data']['report']['status']=='cancelled'))
        self.assertFalse(list(self.root.glob('export-*')))
        request['watermark'] = 'verified_clean'
        malformed = self.send({'type':'export','asset_id':asset['id'],'request':request,'destination':str(self.root)})
        self.assertFalse(self.receive(malformed)['ok'])
        self.assertIn('preview_path',self.call(type='preview',asset_id=asset['id']))
        self.assertFalse(self.receive(self.send({'type':'review','asset_id':asset['id'],'clean':True,'note':''}))['ok'])

    def test_tampered_snapshot_cannot_export(self):
        asset=self.import_asset()
        self.call(type='review',asset_id=asset['id'],clean=True,note='Generated solid-color fixture')
        snapshot=Path(self.call(type='preview',asset_id=asset['id'])['preview_path'])
        snapshot.chmod(0o600)
        snapshot.write_bytes(snapshot.read_bytes()+b'tamper')
        result=self.receive(self.send({'type':'export','asset_id':asset['id'],
            'request':{'range':None,'outputs':[{'kind':'original'}]},'destination':str(self.root)}))
        self.assertFalse(result['ok'])
        self.assertFalse(list(self.root.glob('export-*')))


if __name__ == '__main__':
    unittest.main(verbosity=2)
