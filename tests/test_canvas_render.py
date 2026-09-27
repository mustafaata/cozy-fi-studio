"""Decode real MP4 output and compare it with the actual studio's canvas layers."""
import base64
import io
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from browser_helpers import wait_for_browser
from unittest.mock import patch

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright
from werkzeug.serving import make_server, WSGIRequestHandler

import app
import engine
import media_assets
from overlay_assets import prepare_overlay, overlay_path
from project import validate_project


class CanvasParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="canvas-parity-")
        cls.root = Path(cls.temp.name)
        cls.assets = patch.object(media_assets, "ASSET_DIR", cls.root / "assets"); cls.assets.start()
        cls.ffmpeg = engine._ffmpeg_bin()
        cls.audio = cls.root / "audio.wav"
        subprocess.run([cls.ffmpeg, "-v", "error", "-f", "lavfi", "-i",
                        "aevalsrc=0.3*sin(2*PI*110*t)*(0.4+0.6*sin(2*PI*3*t)^2):s=44100:d=3",
                        str(cls.audio)], check=True)
        cls.media = []
        for index, source in enumerate(("testsrc2=s=256x144:r=24:d=2", "color=c=0x996633:s=192x144:r=24:d=2")):
            video = cls.root / f"source{index}.mp4"
            subprocess.run([cls.ffmpeg, "-v", "error", "-f", "lavfi", "-i", source,
                            "-c:v", "libx264", "-crf", "12", str(video)], check=True)
            cls.media.append(media_assets.prepare_asset(video, video.name, cls.ffmpeg))
        buf = io.BytesIO(); Image.new("RGBA", (100, 60), (210, 185, 95, 180)).save(buf, format="PNG")
        cls.overlay = prepare_overlay(buf.getvalue(), "layer.png")

        class QuietHandler(WSGIRequestHandler):
            def log_request(self, *args, **kwargs):
                pass
        cls.server = make_server("127.0.0.1", 0, app.app, threaded=True, request_handler=QuietHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True); cls.thread.start()
        cls.origin = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join(timeout=3)
        cls.assets.stop(); cls.temp.cleanup()

    def project(self):
        return validate_project(dict(version=1, tracks={"main": {
            "source": dict(name=self.audio.name, size=self.audio.stat().st_size, lastModified=0, duration=3), "end":1.5}},
            effects=dict(speed=1,reverb=0), background=dict(asset=self.media[0]["asset"])))

    def compare(self, project, times):
        target = self.root / "result.mp4"
        files = dict(main=str(self.audio), background=media_assets.source_path(project["background"]["asset"]))
        if project["videoClips"]:
            files["clip_paths"] = [media_assets.source_path(clip["asset"]) for clip in project["videoClips"]]
        if project["overlay"]["asset"]:
            files["overlay"] = overlay_path(project["overlay"]["asset"])
        ok, message = engine.process_and_render(project, files, str(target))
        self.assertTrue(ok, message)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="chromium", args=["--enable-unsafe-swiftshader"])
            try:
                page = browser.new_page(); errors=[]; page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(self.origin)
                page.locator('#mainUpload').set_input_files(str(self.audio))
                wait_for_browser(page, 'audioEngine.files.main && audioEngine.wsMain.getDecodedData()')
                page.evaluate('p => projectStore.replace(p)', project)
                wait_for_browser(page, 'videoPreview.ready && !videoPreview.busy')
                page.evaluate('document.fonts.ready')
                if project["overlay"]["asset"]:
                    wait_for_browser(page, "performance.getEntriesByType('resource').some(x=>x.name.includes('/api/overlay/'))")
                for time in times:
                    page.evaluate('time => audioEngine.seekTo(projectStore.state.tracks.main.start+time*projectStore.state.effects.speed)', time)
                    wait_for_browser(page, "!videoPreview.video.seeking && videoPreview.clips.entries.every(entry=>!entry.video.seeking)")
                    png = page.evaluate('''() => {
                        videoPreview.draw();lyricsPreview.draw();overlayPreview.draw();
                        const canvas=document.createElement('canvas'),base=document.getElementById('previewCanvas');
                        canvas.width=base.width;canvas.height=base.height;const ctx=canvas.getContext('2d');
                        for(const id of ['previewCanvas','overlayCanvas','lyricsCanvas'])ctx.drawImage(document.getElementById(id),0,0);
                        return canvas.toDataURL('image/png').split(',')[1];
                    }''')
                    preview = np.asarray(Image.open(io.BytesIO(base64.b64decode(png))).convert('RGB'), dtype=float)
                    result = subprocess.run([self.ffmpeg, '-v', 'error', '-i', str(target), '-ss', str(time),
                                             '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-'], capture_output=True, check=True)
                    output = np.asarray(Image.open(io.BytesIO(result.stdout)).convert('RGB'), dtype=float)
                    self.assertEqual(preview.shape, output.shape)
                    difference = np.abs(preview-output)
                    # Delivery MP4 uses 4:2:0 chroma subsampling. Saturated one-pixel
                    # edges differ from RGB canvas even with a lossless video codec.
                    self.assertLess(difference.mean(), 8, f't={time}, mean={difference.mean():.2f}')
                    luma=np.abs((preview-output) @ np.array([.2126,.7152,.0722])).mean()
                    self.assertLess(luma, 4, f't={time}, luma={luma:.2f}')
                self.assertEqual(errors, [])
            finally:
                browser.close()

    def test_colors_film_grain_and_framing_match(self):
        project=self.project()
        project['video'].update(temperature=35, liftShadows=20, brightness=.12, contrast=1.2, gamma=1.4,
                                saturation=.65, hueShift=35, vignette=.4, grain=14, blur=1,
                                filmOverlay='lightleak', filmIntensity=45, letterbox=8, zoom=1.15,
                                start=.25,end=1,speed=.75)
        self.compare(project,[.5,1.25])

    def test_visualizer_and_layers_match_at_seeked_times(self):
        project=self.project()
        project['video'].update(vizType='radial',vizTheme='gold_amber',vizScale=65,
                                bassEffects=['zoom','rgb_split','glow'],bassSensitivity=75)
        project['overlay'].update(asset=self.overlay['asset'],url=self.overlay['url'],x=70,y=20,scale=200)
        project['lyrics'].update(fontSize=70,glowIntensity=30,template='karaoke',boxStyle='pill',
                                 animation='slide',bassEffects=['pulse','color_flash','wave_float','tilt_shake'],
                                 lines=[dict(id='one',text='Sakin akşam',start=0,end=.75),
                                        dict(id='two',text='Yumuşak geçiş',start=.75,end=1.5)])
        self.compare(project,[.5,.75,.875,1.25])

    def test_cancelled_batch_does_not_publish_video(self):
        project = self.project()
        cancel = threading.Event()
        target = self.root / 'cancelled.mp4'
        files = dict(main=str(self.audio), background=media_assets.source_path(project['background']['asset']))
        def progress(percent, _message):
            if percent >= 63:
                cancel.set()
        ok, _message = engine.process_and_render(project, files, str(target), progress=progress, cancel=cancel)
        self.assertFalse(ok)
        self.assertFalse(target.exists())
        self.assertFalse(Path(str(target) + '.partial.mp4').exists())

    def test_multi_clip_transition_and_portrait_match(self):
        project=self.project()
        project['videoClips']=[dict(asset=m['asset'],start=.25,end=1.25,speed=1,transition='fade',transitionDuration=.5) for m in self.media]
        project['output']['aspect']='9:16'
        self.compare(project,[.25,.75,1.25])

    def test_word_highlight_and_line_crossfade_match(self):
        project = self.project()
        project['lyrics'].update(template='word-by-word', animation='pop', fontSize=64,
                                 lines=[dict(id='one',text='Soft words',start=0,end=.75),
                                        dict(id='two',text='Flow together',start=.75,end=1.5)])
        self.compare(project, [.125, .5, .875, 1.25])


if __name__ == '__main__':
    unittest.main()
