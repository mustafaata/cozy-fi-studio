"""Browser regressions for workspace layout and interaction.

Run: python -m unittest discover -s tests -p test_workspace_ui.py
Requires the optional Playwright Python package and installed browser engines.
"""
import json
import math
from pathlib import Path
import struct
import sys
import tempfile
import threading
import unittest
from browser_helpers import wait_for_browser
from unittest.mock import patch
import wave

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None


@unittest.skipIf(sync_playwright is None, 'Install Playwright to run browser regressions.')
class WorkspaceUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app import app
        from werkzeug.serving import make_server, WSGIRequestHandler

        class QuietHandler(WSGIRequestHandler):
            def log_request(self, *args, **kwargs):
                pass

        cls.server = make_server('127.0.0.1', 0, app, threaded=True, request_handler=QuietHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}'
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()
        cls.temporary = tempfile.TemporaryDirectory(prefix='cozy-ui-')
        cls.audio = Path(cls.temporary.name) / 'uzun-bir-kaynak-ismi-ile-ses-denemesi.wav'
        with wave.open(str(cls.audio), 'wb') as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(8000)
            out.writeframes(b''.join(struct.pack('<h', int(2000 * math.sin(2 * math.pi * 220 * i / 8000))) for i in range(24000)))

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)
        cls.temporary.cleanup()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1440, 'height': 900}, color_scheme='dark')
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.goto(self.url, wait_until='networkidle')

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [], 'No unhandled browser errors')

    def select(self, mode):
        self.page.locator(f'[data-mode="{mode}"]').click()
        self.assertEqual(self.page.locator(f'[data-mode="{mode}"]').get_attribute('aria-pressed'), 'true')

    def load_audio(self):
        self.page.locator('#mainUpload').set_input_files(str(self.audio))
        wait_for_browser(self.page, '!!audioEngine.files.main')
        self.assertTrue(self.page.locator('#playBtn').is_enabled())

    def test_layout_modes_themes_and_unique_controls(self):
        duplicates = self.page.evaluate('''() => [...document.querySelectorAll('[id]')].map(e=>e.id).filter((id,i,ids)=>ids.indexOf(id)!==i)''')
        self.assertEqual(duplicates, [])
        for theme in ['light', 'dark']:
            self.page.emulate_media(color_scheme=theme)
            for width in [320, 375, 768, 1024, 1440]:
                self.page.set_viewport_size({'width': width, 'height': 900})
                for mode, inspector in [('mix','main'),('lyrics','lyrics'),('videofx','videofx'),('output','output')]:
                    with self.subTest(theme=theme, width=width, mode=mode):
                        self.select(mode)
                        self.assertTrue(self.page.locator('#inspector-' + inspector).is_visible())
                        self.assertEqual(self.page.locator('#lyricsWorkbench').is_visible(), mode == 'lyrics')
                        self.assertEqual(self.page.locator('.timeline').is_visible(), mode != 'lyrics')
                        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
                        self.assertTrue(self.page.locator('#renderBtn').is_visible())
        self.select('mix')
        tracks = self.page.locator('.tracks-container').bounding_box()
        for track in self.page.locator('.track').all():
            box = track.bounding_box()
            self.assertLessEqual(box['y'] + box['height'], tracks['y'] + tracks['height'])

    def test_trim_single_keypress_undo_playback_and_status(self):
        self.load_audio()
        self.page.locator('#inspect-main .trim-header').click()
        self.page.locator('.brand h1').click()
        self.page.keyboard.press(']')
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.main.start'), .1)
        self.assertEqual(self.page.locator('#main-start').count(), 1)
        self.assertAlmostEqual(float(self.page.locator('#main-start').input_value()), .1)
        self.page.locator('#undoBtn').click()
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.main.start'), 0)
        self.page.locator('#main-start').fill('0.25')
        self.page.locator('#main-start').press('Tab')
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.main.start'), .25)
        self.page.locator('#playBtn').click()
        wait_for_browser(self.page, 'audioEngine.wsMain.isPlaying()')
        self.page.locator('#playBtn').click()
        self.assertFalse(self.page.evaluate('audioEngine.wsMain.isPlaying()'))
        self.page.evaluate("document.dispatchEvent(new CustomEvent('studio-error', {detail: 'Test hatası'}))")
        self.assertEqual(self.page.locator('#studioStatusLabel').inner_text(), 'Uyarı')
        self.assertEqual(self.page.locator('#studioStatusPill .status-dot').count(), 1)
        self.assertEqual(self.page.locator('#statusText').inner_text(), 'Test hatası')

    def test_inspector_scroll_is_restored(self):
        self.select('videofx')
        self.page.locator('.sidebar-bottom-content').evaluate('(node) => node.scrollTop = 400')
        position = self.page.locator('.sidebar-bottom-content').evaluate('(node) => node.scrollTop')
        self.select('output')
        self.select('videofx')
        self.assertEqual(self.page.locator('.sidebar-bottom-content').evaluate('(node) => node.scrollTop'), position)

    def test_slow_refresh_stays_in_place(self):
        self.page.add_init_script('''window.layoutShiftTotal = 0;
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) {
              if (!entry.hadRecentInput) window.layoutShiftTotal += entry.value;
            }
          }).observe({type:'layout-shift', buffered:true});''')
        session = self.context.new_cdp_session(self.page)
        session.send('Network.enable')
        session.send('Network.setCacheDisabled', {'cacheDisabled': True})
        session.send('Network.emulateNetworkConditions', {
            'offline': False, 'latency': 180,
            'downloadThroughput': 200000, 'uploadThroughput': 100000})
        self.page.reload(wait_until='networkidle')
        self.assertLess(self.page.evaluate('window.layoutShiftTotal'), .005)
        self.assertTrue(self.page.locator('.timeline-lane').first.is_visible())

    def test_giphy_focus_trap_escape_and_upload_keyboard(self):
        self.page.route('**/api/gifs?*', lambda route: route.fulfill(json={'items': [], 'offset':0, 'limit':24, 'total':0}))
        self.page.locator('#stageGiphyBtn').click()
        self.assertTrue(self.page.locator('#giphySearchInput').evaluate('(node) => node === document.activeElement'))
        self.assertTrue(self.page.locator('.app-shell').evaluate('(node) => node.inert'))
        self.page.locator('#closeGiphy').focus()
        self.page.keyboard.press('Shift+Tab')
        self.assertEqual(self.page.evaluate('document.activeElement.id'), 'giphySearchBtn')
        self.page.keyboard.press('Tab')
        self.assertEqual(self.page.evaluate('document.activeElement.id'), 'closeGiphy')
        self.page.keyboard.press('Escape')
        self.assertFalse(self.page.locator('#giphyModal').is_visible())
        self.assertEqual(self.page.evaluate('document.activeElement.id'), 'stageGiphyBtn')
        self.assertFalse(self.page.locator('.app-shell').evaluate('(node) => node.inert'))
        self.page.locator('label[for="mainUpload"]').focus()
        with self.page.expect_file_chooser():
            self.page.keyboard.press('Enter')

    def test_extra_channel_uses_current_workspace(self):
        self.page.locator('.add-track-btn').click()
        kind = self.page.evaluate('Object.keys(projectStore.state.tracks).find(id => id.startsWith("track_"))')
        self.assertTrue(kind)
        self.assertTrue(self.page.locator('#inspector-' + kind).is_visible())
        self.assertEqual(self.page.locator('.tracks-container > .track').count(), 4)
        self.page.locator('#' + kind + 'Upload').set_input_files(str(self.audio))
        wait_for_browser(self.page, '(kind) => !!audioEngine.files[kind]', arg=kind)
        self.assertEqual(self.page.locator('#' + kind + 'Name').inner_text(), self.audio.name)
        self.page.locator('#' + kind + 'VolOut').fill('65')
        self.page.locator('#' + kind + 'VolOut').press('Tab')
        self.assertEqual(self.page.evaluate('(kind) => projectStore.state.tracks[kind].volume', kind), 65)
        self.select('mix')
        self.page.locator(f'.sidebar-tab[data-inspect="{kind}"]').click()
        self.assertTrue(self.page.locator('#inspect-' + kind).is_visible())

    def test_lyrics_editing_and_save(self):
        self.select('lyrics')
        self.page.locator('#lyricsNewLine').click()
        self.assertEqual(self.page.locator('.lyric-row').count(), 1)
        self.page.locator('.lyric-row textarea').fill('Sakin bir akşam')
        self.page.locator('.lyric-row textarea').press('Tab')
        self.assertEqual(self.page.evaluate('projectStore.state.lyrics.lines[0].text'), 'Sakin bir akşam')
        with self.page.expect_download() as download:
            self.page.locator('#saveProjectBtn').click()
        data = json.loads(Path(download.value.path()).read_text(encoding='utf-8'))
        self.assertEqual(data['lyrics']['lines'][0]['text'], 'Sakin bir akşam')

    def test_media_import_and_render_controls(self):
        from PIL import Image
        import media_assets

        media = Path(self.temporary.name) / 'scene.gif'
        Image.new('RGB', (64, 64), '#627255').save(
            media, save_all=True, append_images=[Image.new('RGB', (64, 64), '#a08060')],
            duration=500, loop=0)
        self.load_audio()
        with patch.object(media_assets, 'ASSET_DIR', Path(self.temporary.name) / 'assets'):
            self.page.locator('#backgroundUpload').set_input_files(str(media))
            wait_for_browser(self.page, 'videoPreview.ready && !videoPreview.busy', timeout=30000)
            self.assertFalse(self.page.locator('#previewEmpty').is_visible())
            self.assertTrue(self.page.locator('#renderBtn').is_enabled())
            # Verify the UI contract without launching an expensive final export.
            job = 'a' * 32
            self.page.route('**/render', lambda route: route.fulfill(json={'job_id':job}))
            self.page.route('**/status/' + job, lambda route: route.fulfill(json={
                'state':'done', 'progress':100, 'download_url':'/download/test.mp4'}))
            self.page.locator('#renderBtn').click()
            wait_for_browser(self.page, '!document.getElementById("downloadLink").classList.contains("hidden")')
            self.assertEqual(self.page.locator('#downloadLink').get_attribute('href'), '/download/test.mp4')
            self.assertFalse(self.page.locator('#cancelRenderBtn').is_visible())

    def test_missing_media_keeps_recovery_actions(self):
        self.page.route('**/api/media/' + 'b' * 64, lambda route: route.fulfill(status=404, json={'message':'Dosya gerekli'}))
        self.page.evaluate("projectStore.update(p => { p.background.asset = 'b'.repeat(64); })")
        wait_for_browser(self.page, 'document.getElementById("previewState").textContent === "Dosya gerekli"')
        self.assertTrue(self.page.locator('#stageMediaBtn').is_visible())
        self.assertTrue(self.page.locator('#stageGiphyBtn').is_visible())


if __name__ == '__main__':
    unittest.main()
