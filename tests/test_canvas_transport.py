import io
from pathlib import Path
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

from PIL import Image
import requests

from canvas_render import FrameSink, frame_batch_size, prepare_sources, scene_origin
from project import validate_project
from render_process import RenderCancelled


def frame(width=16, height=16):
    output = io.BytesIO()
    Image.new('RGBA', (width, height), (120, 50, 30, 255)).save(output, format='PNG')
    png = output.getvalue()
    return len(png).to_bytes(4, 'big') + png


class CanvasTransportTests(unittest.TestCase):
    def test_cancellation_interrupts_a_stalled_scene_initialization(self):
        from playwright.sync_api import sync_playwright, Error
        cancel=threading.Event();sink=self.sink(cancel=cancel)
        with scene_origin({},sink) as origin,sync_playwright() as runtime:
            browser=runtime.chromium.launch(channel='chromium')
            try:
                page=browser.new_page();page.goto(origin)
                self.assertEqual(requests.get(origin+'cancelled',timeout=5).json(),{'cancelled':False})
                # A never-resolving font/image stands in for the original initialization stall.
                page.evaluate('()=>{createExportScene=()=>new Promise(()=>{});}')
                timer=threading.Timer(.3,cancel.set);timer.start();start=time.monotonic()
                try:
                    with self.assertRaisesRegex(Error,'iptal'):
                        page.evaluate('initializeExportScene({})')
                finally:timer.cancel()
                self.assertLess(time.monotonic()-start,3)
            finally:browser.close()

    def sink(self, count=8, cancel=None):
        sink = FrameSink(16, 16, count, cancel)
        sink.process = SimpleNamespace(stdin=io.BytesIO())
        return sink

    def test_validates_entire_batch_before_writing(self):
        for data in [b'', b'\0', frame()[:-1], frame(18), frame()+b'bad', frame()*9]:
            sink = self.sink()
            with self.assertRaises(ValueError):
                sink.write(data)
            self.assertEqual(sink.process.stdin.getvalue(), b'')
        sink = self.sink(count=2)
        sink.write(frame()*2)
        self.assertEqual(sink.received, 2)
        self.assertEqual(sink.process.stdin.getvalue(), frame()[4:]*2)
        with self.assertRaises(ValueError):
            sink.write(frame())

    def test_cancel_and_memory_bound(self):
        cancel = threading.Event(); cancel.set()
        sink = self.sink(cancel=cancel)
        with self.assertRaises(RenderCancelled):
            sink.write(frame())
        self.assertEqual(sink.received, 0)
        self.assertEqual(frame_batch_size(8192, 4096), 1)
        self.assertLessEqual(frame_batch_size(1280, 720)*1280*720*6, 32*1024*1024)

    def test_private_origin_order_size_and_csp(self):
        sink = self.sink(count=2)
        with scene_origin({}, sink) as origin:
            split = urlsplit(origin)
            headers = {'Origin': f'{split.scheme}://{split.netloc}', 'X-Frame-Index': '0'}
            self.assertIn("connect-src 'self'", requests.get(origin, timeout=5).headers['Content-Security-Policy'])
            self.assertEqual(requests.get(origin+'unknown', timeout=5).status_code, 404)
            self.assertEqual(requests.post(origin+'frames', data=frame(), timeout=5).status_code, 403)
            self.assertEqual(requests.post(origin+'frames', data=frame(), headers=headers, timeout=5).status_code, 204)
            self.assertEqual(requests.post(origin+'frames', data=frame(), headers=headers, timeout=5).status_code, 204)
            self.assertEqual(sink.received, 1)
            self.assertEqual(requests.post(origin+'frames', data=frame()*2, headers=headers, timeout=5).status_code, 409)
            headers['X-Frame-Index'] = '1'
            self.assertEqual(requests.post(origin+'frames', data=b'x'*(sink.max_bytes+1), headers=headers, timeout=5).status_code, 413)
            self.assertEqual(requests.post(origin+'frames', data=frame(18), headers=headers, timeout=5).status_code, 400)
            self.assertEqual(requests.post(origin+'frames', data=frame(), headers=headers, timeout=5).status_code, 204)
            headers['X-Frame-Index'] = '0'
            self.assertEqual(requests.post(origin+'frames', data=frame(), headers=headers, timeout=5).status_code, 409)
            self.assertEqual(sink.process.stdin.getvalue(), frame()[4:]*2)

    def test_browser_recovers_lost_acknowledgement_without_duplicate_frames(self):
        from playwright.sync_api import sync_playwright

        sink = self.sink(count=2)
        with scene_origin({}, sink) as origin, sync_playwright() as runtime:
            browser = runtime.chromium.launch(channel='chromium')
            try:
                page = browser.new_page()
                page.goto(origin)
                page.evaluate('''async bytes => {
                    const send = window.fetch.bind(window);
                    let calls = 0;
                    window.fetch = async (...args) => {
                        const response = await send(...args);
                        if (++calls === 1) throw new TypeError('Simulated lost acknowledgement');
                        return response;
                    };
                    await uploadFrameBatch(0, new Uint8Array(bytes));
                    await uploadFrameBatch(1, new Uint8Array(bytes));
                    if (calls !== 3) throw new Error('Expected one retry');
                }''', list(frame()))
                self.assertEqual(sink.received, 2)
                self.assertEqual(sink.process.stdin.getvalue(), frame()[4:]*2)
            finally:
                browser.close()

    def test_source_preparation_reuses_repeated_clips_and_limits_end(self):
        project = validate_project(dict(version=1, tracks={'main': {}}))
        project['videoClips'] = [dict(start=0,end=2,speed=1), dict(start=1,end=2,speed=1)]
        info = dict(width=320,height=180,duration=10,fps=30)
        with tempfile.TemporaryDirectory() as folder, patch('canvas_render.probe', return_value=info) as probe, \
                patch('canvas_render.run_ffmpeg') as encode:
            sources, infos, urls, _audio = prepare_sources(project, ['source.mp4']*2, {}, Path(folder),
                                                          'ffmpeg', lambda *_: None, None)
            self.assertEqual(probe.call_count, 1)
            self.assertEqual(encode.call_count, 1)
            self.assertEqual(urls[0], urls[1])
            self.assertEqual(infos, [info, info])
            args = encode.call_args.args[0]
            self.assertEqual(args[args.index('-t')+1], '2')


if __name__ == '__main__':
    unittest.main()
