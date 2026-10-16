"""Browser regressions for workspace layout and interaction.

Run: python -m unittest discover -s tests -p test_workspace_ui.py
Requires the optional Playwright Python package and installed browser engines.
"""
import json
from contextlib import contextmanager
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

    def provide_microphone_signal(self):
        # Exercise the real MediaStream/AudioWorklet recorder with deterministic
        # input. Device discovery and OS capture availability are separate checks.
        self.page.evaluate('''()=>{
          navigator.mediaDevices.getUserMedia=async()=>{
            const context=new AudioContext({sampleRate:PROJECT_SCHEMA.microphoneLimits.sampleRate});await context.resume();
            const source=context.createOscillator(),gain=context.createGain(),destination=context.createMediaStreamDestination();
            source.frequency.value=440;gain.gain.value=.1;source.connect(gain).connect(destination);source.start();
            let closed=false;for(const track of destination.stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{stop();if(!closed){closed=true;source.stop();source.disconnect();gain.disconnect();context.close().catch(error=>console.warn(error.name));}};}
            return destination.stream;
          };
        }''')

    def test_loudness_real_analysis_audition_apply_undo_reopen_and_invalidation(self):
        self.load_audio();self.select('output')
        self.page.evaluate('projectStore.update(p=>{p.effects.speed=1;p.effects.reverb=0;p.tracks.main.loop=false;p.tracks.main.fadeIn=p.tracks.main.fadeOut=0;});')
        panel=self.page.locator('#loudnessEditor');panel.locator('summary').click()
        panel.locator('.loudness-preset').select_option('-23')
        panel.locator('.loudness-normalize').click()
        wait_for_browser(self.page,'!!loudnessEditor.result?.output',timeout=60000)
        result=self.page.evaluate('loudnessEditor.result');self.assertAlmostEqual(result['output']['integrated'],-23,delta=.2)
        self.assertTrue(panel.locator('.loudness-audition').get_attribute('src'))
        history=self.page.evaluate('projectStore.past.length');panel.locator('.loudness-apply').click()
        self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
        self.assertEqual(self.page.evaluate('projectStore.state.master.loudnormI'),-23)
        self.assertTrue(self.page.evaluate('!!loudnessEditor.result'))
        saved=self.page.evaluate('projectStore.snapshot()');self.page.evaluate('projectStore.undo()')
        self.assertFalse(self.page.evaluate('projectStore.state.master.loudnorm'));self.page.evaluate('p=>projectStore.replace(p)',saved)
        self.assertEqual(self.page.evaluate('projectStore.state.master.loudnormI'),-23)
        panel.locator('.loudness-measure').click();wait_for_browser(self.page,'!!loudnessEditor.result',timeout=60000)
        self.page.evaluate('projectStore.update(p=>p.tracks.main.volume=70)');self.assertFalse(self.page.evaluate('!!loudnessEditor.result'))
        panel.locator('.loudness-measure').click();panel.locator('.loudness-cancel').click()
        wait_for_browser(self.page,'!loudnessEditor.busy');self.assertFalse(self.page.evaluate('!!loudnessEditor.result'))
        for theme in ['dark','light']:
            self.page.emulate_media(color_scheme=theme)
            for width in [320,375,768,1024,1440]:
                self.page.set_viewport_size(dict(width=width,height=900));self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))

    def test_loudness_native_worklet_and_speaker_channel_calibration(self):
        from audio_channels import speaker_stereo
        import numpy as np
        actual=self.page.evaluate('''async()=>{const ctx=new OfflineAudioContext(2,176400,44100),source=ctx.createBufferSource(),gain=ctx.createGain();gain.gain.value=0;gain.connect(ctx.destination);const monitor=new LoudnessMonitor(ctx,source);monitor.running=true;await monitor.prepare();source.connect(gain);const buffer=ctx.createBuffer(2,176400,44100);for(let c=0;c<2;c++){const data=buffer.getChannelData(c);for(let i=0;i<data.length;i++)data[i]=.1*Math.sin(2*Math.PI*1000*i/44100);}source.buffer=buffer;source.start();await ctx.startRendering();await new Promise(resolve=>{monitor.node.port.onmessage=e=>{monitor.values=e.data;resolve();};monitor.node.port.postMessage({running:false});});const result=monitor.values;monitor.disconnect();return result;}''')
        self.assertAlmostEqual(actual['integrated'],-20.05,delta=.15);self.assertAlmostEqual(actual['truePeak'],-20,delta=.05);self.assertAlmostEqual(actual['seconds'],4,delta=.01)
        for channels in [1,2,4,6]:
            with self.subTest(channels=channels):
                actual=self.page.evaluate('''async channels=>{const ctx=new OfflineAudioContext(2,128,44100),source=ctx.createBufferSource(),gain=ctx.createGain();gain.channelCount=2;gain.channelCountMode='explicit';gain.connect(ctx.destination);const buffer=ctx.createBuffer(channels,128,44100);for(let c=0;c<channels;c++)buffer.getChannelData(c).fill((c+1)/10);source.buffer=buffer;source.connect(gain);source.start();const result=await ctx.startRendering();return [result.getChannelData(0)[64],result.getChannelData(1)[64]];}''',channels)
                expected=speaker_stereo(np.arange(1,channels+1,dtype=np.float32).reshape(channels,1)/10)[:,0]
                np.testing.assert_allclose(actual,expected,atol=1e-7)

    @contextmanager
    def open_sequence(self):
        with self.open_transition_editor():
            self.page.locator('#rainUpload').set_input_files(str(self.audio));wait_for_browser(self.page,'!!audioEngine.files.rain')
            self.page.evaluate('''projectStore.update(p=>{Object.assign(p.tracks.rain,{offset:.25,end:1,until:1.25,loop:false,fadeIn:0,fadeOut:0});Object.assign(p.videoClips[0],{offset:.25,start:0,end:1,transitionDuration:0});p.visualLayers.push({...projectFields({},'visualLayer'),id:'seq_text',type:'text',name:'Sekans metni',text:'İçerik',offset:.25,until:1.25});});window.sequenceSource=audioEngine.files.rain;void 0;''')
            self.page.evaluate("window.selectSidebarTab('main');sequenceEditor.panel.open=true;")
            panel=self.page.locator('#sequenceEditor')
            for key in ['audio:rain','visual:seq_text',self.page.evaluate('"video:"+projectStore.state.videoClips[0].id')]:panel.locator(f'[data-sequence-candidate="{key}"]').check()
            panel.locator('.sequence-new-name').fill('Birinci sekans');panel.locator('.sequence-create').click()
            wait_for_browser(self.page,'projectStore.state.sequences.length===1')
            yield panel

    def test_sequence_mixed_create_local_edit_move_history_dissolve_and_reopen(self):
        with self.open_sequence() as panel:
            identifier=self.page.evaluate('projectStore.state.sequences[0].id');self.assertEqual(self.page.locator('[data-sequence-clip]').count(),1)
            self.assertFalse(self.page.locator('.tracks-container [data-track="rain"]').is_visible());self.assertEqual(self.page.locator('[data-visual-layer="seq_text"]').count(),0)
            before=self.page.evaluate('projectStore.snapshot()');history=self.page.evaluate('projectStore.past.length')
            self.page.locator('[data-sequence-clip]').dblclick();wait_for_browser(self.page,'!!sequenceEditor.openId')
            panel.locator('.sequence-member').select_option('visual:seq_text');field=panel.locator('[data-sequence-field="member:text"]');field.fill('Yerel düzenleme');field.dispatch_event('change')
            self.assertEqual(self.page.evaluate('projectStore.state.visualLayers[0].text'),'Yerel düzenleme');self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            panel.locator('.sequence-cursor').fill('.5');panel.locator('.sequence-cursor').dispatch_event('change');self.assertAlmostEqual(self.page.evaluate('audioEngine.getProjectTime()'),.75,delta=.01)
            panel.locator('.sequence-up').click();offset=panel.locator('[data-sequence-field="offset"]');offset.fill('.5');offset.dispatch_event('change')
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.rain.offset'),.5);self.assertTrue(self.page.evaluate('audioEngine.files.rain===sequenceSource'))
            after=self.page.evaluate('projectStore.snapshot()');self.page.locator('#undoBtn').click();self.assertAlmostEqual(self.page.evaluate('projectStore.state.sequences[0].offset'),.25);self.page.locator('#redoBtn').click();self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)
            with self.page.expect_download() as download:self.page.locator('#saveProjectBtn').click()
            self.page.locator('#openProjectInput').set_input_files(dict(name='sequences.json',mimeType='application/json',buffer=Path(download.value.path()).read_bytes()));wait_for_browser(self.page,'projectStore.state.sequences[0]?.id===%s'%json.dumps(identifier));self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)
            self.page.evaluate("window.selectSidebarTab('main');sequenceEditor.panel.open=true;");panel.locator('.sequence-dissolve').click();self.assertEqual(self.page.evaluate('projectStore.state.sequences'),[])
            self.assertTrue(self.page.locator('.tracks-container [data-track="rain"]').is_visible());self.assertEqual(self.page.evaluate('projectStore.state.visualLayers[0].text'),'Yerel düzenleme')

    def test_sequence_nested_add_release_locks_canvas_precision_cancel_and_responsive(self):
        with self.open_sequence() as panel:
            inner=self.page.evaluate('projectStore.state.sequences[0].id');panel.locator(f'[data-sequence-candidate="sequence:{inner}"]').check();panel.locator('.sequence-new-name').fill('Üst sekans');panel.locator('.sequence-create').click()
            self.assertEqual(self.page.evaluate('projectStore.state.sequences.length'),2);self.assertEqual(self.page.locator('[data-sequence-clip]').count(),1)
            panel.locator('.sequence-lock').check();self.assertTrue(panel.locator('[data-sequence-field="offset"]').is_disabled());before=self.page.evaluate('projectStore.snapshot()')
            self.page.locator('[data-sequence-clip]').focus();self.page.locator('[data-sequence-clip]').press('ArrowRight');self.assertEqual(self.page.evaluate('projectStore.snapshot()'),before);panel.locator('.sequence-lock').uncheck()
            block=self.page.locator('[data-sequence-clip]');block.focus();block.press('ArrowRight');self.assertAlmostEqual(self.page.evaluate('projectStore.state.sequences[0].offset'),.25+1/24,delta=.001)
            block.scroll_into_view_if_needed();box=block.bounding_box();self.page.mouse.move(box['x']+10,box['y']+15);self.page.mouse.down();self.page.mouse.move(box['x']+40,box['y']+15,steps=3);self.page.keyboard.press('Escape');self.page.mouse.up();self.assertAlmostEqual(self.page.evaluate('projectStore.state.sequences[0].offset'),.25+1/24,delta=.001)
            block=self.page.locator('[data-sequence-clip]');block.press('Enter');panel.locator('.sequence-member').select_option('sequence:'+inner);panel.locator('.sequence-detail').click();self.assertEqual(self.page.evaluate('sequenceEditor.openId'),inner)
            panel.locator('.sequence-member').select_option('visual:seq_text');panel.locator('.sequence-release').click();self.assertEqual(self.page.evaluate('projectStore.state.sequences[0].members.length'),2)
            self.assertTrue(self.page.evaluate('sequenceOwner(projectStore.state,"visual","seq_text").name==="Üst sekans"'))
            panel.locator('.sequence-up').click();panel.locator('.sequence-up').click()
            invalid=panel.locator('[data-sequence-field="duration"]');invalid.fill('.1');invalid.dispatch_event('change');self.assertGreater(self.page.evaluate('projectStore.state.sequences[1].duration'),.1)
            for theme in ['dark','light']:
                self.page.emulate_media(color_scheme=theme)
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))

    def test_sequence_main_montage_detailed_split_and_new_text_stay_inside(self):
        self.load_audio();self.page.evaluate('''projectStore.update(p=>{p.effects.speed=1;p.effects.reverb=0;p.tracks.main.loop=false;});window.selectSidebarTab('main');sequenceEditor.panel.open=true;''')
        panel=self.page.locator('#sequenceEditor');panel.locator('[data-sequence-candidate="main:main_original"]').check();panel.locator('.sequence-create').click()
        self.assertFalse(self.page.locator('.tracks-container [data-track="main"]').is_visible())
        panel.locator('.sequence-enter').click();self.assertTrue(self.page.locator('.tracks-container [data-track="main"]').is_visible())
        self.page.evaluate('audioEngine.seekProjectTime(1.5)');self.assertAlmostEqual(self.page.evaluate('audioEngine.getProjectTime()'),1.5,delta=.01);self.page.locator('[data-main-operation="split"]').click();self.assertEqual(self.page.evaluate('projectStore.state.mainClips.length'),2,self.page.locator('#statusMessage').text_content() if self.page.locator('#statusMessage').count() else self.page.locator('.main-clip-editor .clip-feedback').text_content())
        self.assertEqual(self.page.evaluate('projectStore.state.sequences[0].members.length'),2)
        self.page.evaluate("visualLayerEditor.add('text','','Yerel yeni metin')")
        self.assertEqual(self.page.evaluate('projectStore.state.sequences[0].members.length'),3)
        self.assertTrue(self.page.evaluate('!!sequenceOwner(projectStore.state,"visual",visualLayerEditor.selected)'))
        self.page.locator('.visual-delete').click();self.assertEqual(self.page.evaluate('projectStore.state.sequences[0].members.length'),2)
        self.page.evaluate("sequenceEditor.enter(null)");self.assertEqual(self.page.locator('[data-sequence-clip]').count(),1)
        self.assertEqual(self.page.locator('[data-main-clip]').count(),0)

    def test_sequence_reuse_shared_edits_detach_source_files_and_single_undo(self):
        with self.open_sequence() as panel:
            # Leave space for the second use on the base-video lane.
            self.page.evaluate("projectStore.update(p=>p.videoClips=p.videoClips.filter(c=>c.id!=='transition-second'))")
            history=self.page.evaluate('projectStore.past.length');original=self.page.evaluate('projectStore.state.sequences[0].id')
            panel.locator('.sequence-instance-offset').fill('1.5');panel.locator('.sequence-instance').click();wait_for_browser(self.page,'!sequenceEditor.busy&&projectStore.state.sequences.length===2')
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1);self.assertEqual(self.page.locator('[data-sequence-clip]').count(),2)
            copied=self.page.evaluate('projectStore.state.sequences[1].id');audio=self.page.evaluate('projectStore.state.sequences[1].members.find(r=>r[0]==="audio")[1]');self.assertTrue(self.page.evaluate('id=>audioEngine.files[id]===sequenceSource',audio))
            panel.locator('.sequence-enter').click();member=self.page.evaluate('projectStore.state.sequences[1].members.find(r=>r[0]==="visual").join(":")');panel.locator('.sequence-member').select_option(member)
            text=panel.locator('[data-sequence-field="member:text"]');text.fill('Her kullanımda ortak');text.dispatch_event('change');self.assertEqual(self.page.evaluate('projectStore.state.visualLayers.map(l=>l.text)'),['Her kullanımda ortak','Her kullanımda ortak'])
            panel.locator('.sequence-up').click();panel.locator('.sequence-detach').click();panel.locator('.sequence-enter').click();panel.locator('.sequence-member').select_option(member);text=panel.locator('[data-sequence-field="member:text"]');text.fill('Bağımsız');text.dispatch_event('change');self.assertEqual(self.page.evaluate('projectStore.state.visualLayers.map(l=>l.text)'),['Her kullanımda ortak','Bağımsız'])
            after=self.page.evaluate('projectStore.snapshot()');self.page.locator('#undoBtn').click();self.assertEqual(self.page.evaluate('projectStore.state.visualLayers[1].text'),'Her kullanımda ortak');self.page.locator('#redoBtn').click();self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)
            self.page.evaluate('sequenceEditor.enter(null)');panel.locator('.sequence-select').select_option(original)
            self.page.evaluate('''async()=>{window.replacementError=null;try{await audioEngine.loadAudio('rain',new File([new Uint8Array([1,2,3])],'other.wav'));}catch(error){window.replacementError=error.message;}}''');self.assertTrue(self.page.evaluate('!!replacementError&&audioEngine.files.rain===sequenceSource'))

    def test_sequence_reuse_waveform_failure_restores_definition_and_history(self):
        with self.open_sequence() as panel:
            self.page.evaluate("projectStore.update(p=>p.videoClips=p.videoClips.filter(c=>c.id!=='transition-second'))")
            before=self.page.evaluate('projectStore.snapshot()');history=self.page.evaluate('projectStore.past.length')
            self.page.evaluate("window.originalSequenceLoad=audioEngine.loadAudio;audioEngine.loadAudio=async()=>{throw new Error('Dalga yükleme denemesi');};void 0;")
            panel.locator('.sequence-instance-offset').fill('1.5');panel.locator('.sequence-instance').click();wait_for_browser(self.page,'!sequenceEditor.busy')
            self.assertEqual(self.page.evaluate('projectStore.snapshot()'),before);self.assertEqual(self.page.evaluate('projectStore.past.length'),history);self.assertIn('Dalga',panel.locator('.sequence-status').inner_text())
            self.page.evaluate('audioEngine.loadAudio=originalSequenceLoad;void 0;')

    def open_volume_recording(self, mode='touch', end='2.7'):
        self.load_audio()
        self.page.evaluate('''projectStore.update(p=>{p.effects.speed=1;p.tracks.main.loop=false;
          p.tracks.main.fadeIn=p.tracks.main.fadeOut=0;
          p.tracks.main.automation.volume=[[0,30,{type:'smooth'}],[3,170]];});''')
        panel = self.page.locator('#inspect-main .automation-editor')
        panel.locator(':scope > summary').click()
        recording = panel.locator('.automation-recording')
        recording.locator('summary').click()
        recording.locator('.record-mode').select_option(mode)
        recording.locator('.record-start').fill('0.1')
        recording.locator('.record-end').fill(end)
        return recording

    def test_live_touch_recording_playback_single_undo_and_saved_curve(self):
        recording = self.open_volume_recording()
        before = self.page.evaluate('copyProject(projectStore.state)')
        history = self.page.evaluate('projectStore.past.length')
        recording.locator('.record-arm').click()
        self.page.evaluate('audioEngine.play()')
        wait_for_browser(self.page, 'audioEngine.getProjectTime()>.15')
        fader = recording.locator('.record-fader')
        fader.evaluate('(el)=>{el.value=70;el.dispatchEvent(new Event("input"));}')
        wait_for_browser(self.page, 'audioEngine.getProjectTime()>.4')
        self.assertAlmostEqual(self.page.evaluate('audioEngine.trackNodes.main.gain.gain.value'), .7, places=3)
        fader.dispatch_event('keyup', {'key': 'ArrowRight'})
        self.assertEqual(self.page.evaluate('audioEngine.volumePreviews.size'), 0)
        self.assertEqual(self.page.evaluate('projectStore.past.length'), history)
        wait_for_browser(self.page, 'audioEngine.getProjectTime()>.7')
        self.assertAlmostEqual(self.page.evaluate('audioEngine.trackNodes.main.gain.gain.value-audioEngine.automationVolumeAt("main",audioEngine.getProjectTime())/100'), 0, places=2)
        fader.evaluate('(el)=>{el.value=130;el.dispatchEvent(new Event("input"));}')
        wait_for_browser(self.page, 'audioEngine.getProjectTime()>1')
        fader.dispatch_event('keyup', {'key': 'ArrowRight'})
        self.page.evaluate('audioEngine.pause()')
        self.assertEqual(self.page.evaluate('projectStore.past.length'), history+1)
        after = self.page.evaluate('copyProject(projectStore.state)')
        self.assertNotEqual(after, before)
        self.assertEqual(after['tracks']['main']['volume'], before['tracks']['main']['volume'])
        for time in [.05, .6, 2.8]:
            difference = self.page.evaluate('''([original,t])=>curveValue(projectStore.state.tracks.main.automation.volume,t,100)-curveValue(original,t,100)''', [before['tracks']['main']['automation']['volume'], time])
            self.assertAlmostEqual(difference, 0, places=5)
        self.page.evaluate('projectStore.undo()')
        self.assertEqual(self.page.evaluate('projectStore.state'), before)
        self.page.evaluate('projectStore.redo()')
        self.assertEqual(self.page.evaluate('projectStore.state'), after)
        with self.page.expect_download() as download:
            self.page.locator('#saveProjectBtn').click()
        saved = json.loads(Path(download.value.path()).read_text(encoding='utf-8'))
        self.assertEqual(saved['tracks']['main']['automation'], after['tracks']['main']['automation'])

    def test_live_latch_recording_range_precision_cancel_seek_and_external_edits(self):
        recording = self.open_volume_recording('latch', '0.9')
        original = self.page.evaluate('copyProject(projectStore.state)')
        history = self.page.evaluate('projectStore.past.length')
        recording.locator('.record-arm').click()
        self.page.evaluate('audioEngine.play()')
        wait_for_browser(self.page, 'audioEngine.getProjectTime()>.15')
        fader = recording.locator('.record-fader')
        fader.evaluate('(el)=>{el.value=80;el.dispatchEvent(new Event("input"));}')
        fader.press('Shift+ArrowRight')
        self.assertEqual(self.page.evaluate('AutomationEditors.main.recorder.take.value'), 80.1)
        self.assertTrue(self.page.evaluate('AutomationEditors.main.recorder.take.writing'))
        wait_for_browser(self.page, '!AutomationEditors.main.recorder.armed')
        self.assertEqual(self.page.evaluate('audioEngine.volumePreviews.size'), 0)
        self.assertEqual(self.page.evaluate('projectStore.past.length'), history+1)
        self.assertAlmostEqual(self.page.evaluate('curveValue(projectStore.state.tracks.main.automation.volume,.85)'), 80.1, delta=.011)
        self.page.evaluate('audioEngine.pause();projectStore.undo();audioEngine.seekProjectTime(.2)')
        self.assertEqual(self.page.evaluate('projectStore.state'), original)
        recording.locator('.record-end').fill('2.5')
        recording.locator('.record-arm').click()
        self.page.evaluate('audioEngine.play()')
        fader.evaluate('(el)=>{el.value=120;el.dispatchEvent(new Event("input"));}')
        wait_for_browser(self.page, 'audioEngine.getProjectTime()>.4')
        fader.press('Escape')
        self.assertEqual(self.page.evaluate('projectStore.state'), original)
        self.assertEqual(self.page.evaluate('audioEngine.volumePreviews.size'), 0)
        recording.locator('.record-arm').click()
        fader.evaluate('(el)=>{el.value=50;el.dispatchEvent(new Event("input"));}')
        wait_for_browser(self.page, 'audioEngine.getProjectTime()>.65')
        self.page.evaluate('audioEngine.seekProjectTime(1.8)')
        self.assertFalse(self.page.evaluate('AutomationEditors.main.recorder.armed'))
        self.assertAlmostEqual(self.page.evaluate('curveValue(projectStore.state.tracks.main.automation.volume,1.5)-curveValue([[0,30,{type:"smooth"}],[3,170]],1.5)'), 0)
        self.page.evaluate('audioEngine.pause();projectStore.undo();audioEngine.seekProjectTime(.2)')
        recording.locator('.record-arm').click()
        self.page.evaluate('audioEngine.play()')
        fader.evaluate('(el)=>{el.value=20;el.dispatchEvent(new Event("input"));}')
        self.page.evaluate('projectStore.update(p=>{p.tracks.main.pan=.2})')
        self.assertFalse(self.page.evaluate('AutomationEditors.main.recorder.armed'))
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.automation'), original['tracks']['main']['automation'])
        recording.locator('.record-mode').select_option('read')
        self.assertTrue(recording.locator('.record-arm').is_disabled())
        self.assertTrue(fader.is_disabled())

    def test_live_recording_added_layer_snapshot_and_removal(self):
        self.load_audio()
        self.page.evaluate('''projectStore.update(p=>{p.effects.speed=1;p.tracks.main.loop=false;
          p.tracks.track_live={...copyProject(p.tracks.rain),volume:45,fadeIn:0,fadeOut:0};});''')
        self.page.locator('#track_liveUpload').set_input_files(str(self.audio))
        wait_for_browser(self.page, '!!audioEngine.files.track_live')
        self.page.evaluate('window.selectSidebarTab("track_live")')
        panel = self.page.locator('#inspect-track_live .automation-editor')
        panel.locator(':scope > summary').click()
        recording = panel.locator('.automation-recording')
        recording.locator('summary').click()
        recording.locator('.record-mode').select_option('latch')
        recording.locator('.record-end').fill('2.7')
        history = self.page.evaluate('projectStore.past.length')
        recording.locator('.record-arm').click()
        self.page.evaluate('audioEngine.play()')
        wait_for_browser(self.page, 'audioEngine.getProjectTime()>.15')
        recording.locator('.record-fader').evaluate('(el)=>{el.value=120;el.dispatchEvent(new Event("input"));}')
        wait_for_browser(self.page, 'audioEngine.getProjectTime()>.4')
        self.assertAlmostEqual(self.page.evaluate('audioEngine.trackNodes.track_live.gain.gain.value'), 1.2, places=3)
        with self.page.expect_download() as download:
            self.page.locator('#saveProjectBtn').click()
        saved = json.loads(Path(download.value.path()).read_text(encoding='utf-8'))
        self.assertTrue(saved['tracks']['track_live']['automation']['volume'])
        self.assertEqual(saved, self.page.evaluate('projectStore.state'))
        self.assertEqual(self.page.evaluate('projectStore.past.length'), history+1)
        self.assertFalse(self.page.evaluate('AutomationEditors.track_live.recorder.armed'))
        recording.locator('.record-arm').click()
        recording.locator('.record-fader').evaluate('(el)=>{el.value=40;el.dispatchEvent(new Event("input"));}')
        self.page.evaluate('projectStore.update(p=>{delete p.tracks.track_live});')
        self.assertFalse(self.page.evaluate('AutomationEditors.track_live.recorder.armed'))
        self.assertEqual(self.page.evaluate('audioEngine.volumePreviews.size'), 0)
        self.page.evaluate('audioEngine.pause();projectStore.undo()')
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.track_live.automation'), saved['tracks']['track_live']['automation'])

    def test_real_audio_recording_preview_respects_punch_fades_mute_solo_and_gate(self):
        errors = self.page.evaluate('''async () => {
          const errors=[];
          for(const scenario of ['main','rain','muted','solo','seek']){
            projectStore.update(p=>{p.effects.speed=1;
              for(const kind of ['main','rain'])Object.assign(p.tracks[kind],{source:{name:kind,size:1,lastModified:0,duration:2},
                start:0,end:2,offset:kind==='rain'?.2:0,until:kind==='rain'?2:null,fadeIn:.7,fadeOut:.8,volume:100,
                muted:scenario==='muted',solo:scenario==='solo'&&kind==='rain',automation:{volume:[[0,30,{type:'smooth'}],[2,170]]}});});
            const ctx=new OfflineAudioContext(2,Math.round(2.3*44100),44100),engine=Object.create(Object.getPrototypeOf(audioEngine));engine.routing={schedule(){},scheduleEffects(){}};
            const kind=scenario==='rain'?'rain':'main',seek=scenario==='seek'?.75:0;
            engine.graphReady=true;engine.audioCtx=ctx;engine.getProjectTime=()=>seek;
            engine.wsMap={main:{isPlaying:()=>true}};engine.trackNodes={};
            for(const id of Object.keys(projectStore.state.tracks))engine.trackNodes[id]={gain:ctx.createGain(),pan:ctx.createStereoPanner()};
            engine.volumePreviews=new Map([[kind,{start:.5,end:1.5,value:140}]]);
            const source=ctx.createConstantSource();source.connect(engine.trackNodes[kind].gain).connect(ctx.destination);
            engine.scheduleEnvelopes();source.start();const data=(await ctx.startRendering()).getChannelData(0);
            for(const elapsed of [.1,.3,.499,.5,.501,.75,1,1.499,1.5,1.501,1.8,2.1]){
              const index=Math.round(elapsed*44100),time=seek+index/44100,track=projectStore.state.tracks[kind];
              const value=time>=.5&&time<1.5?140:automationValue(track.automation.volume,time,100);
              const timing=trackTiming(projectStore.state,kind,time);
              const expected=trackAudible(projectStore.state,kind)?timing.envelope*value/100:0;
              if(Math.abs(data[index]-expected)>.0007)errors.push({scenario,time,actual:data[index],expected});
            }
          }return errors;
        }''')
        self.assertEqual(errors, [])

    def test_parameter_automation_edit_bounds_lanes_clipboard_and_save(self):
        self.load_audio()
        self.page.evaluate('projectStore.update(p=>{p.effects.speed=1;})')
        panel = self.page.locator('#inspect-main .automation-editor')
        panel.locator(':scope > summary').click()
        parameter = panel.locator('.automation-parameter')
        authored = {}
        for key, value in [('pan', '-0.4'), ('cutoff', '1200'), ('reverb', '65')]:
            parameter.select_option(key)
            base = panel.locator('.automation-base-value')
            base.fill(value); base.dispatch_event('change')
            panel.locator('.automation-preset').select_option('flat')
            panel.locator('.automation-apply').click()
            self.assertEqual(self.page.evaluate(f'projectStore.state.tracks.main.automation.{key}[0][1]'), float(value))
            panel.locator('.automation-point').select_option('0')
            panel.locator('.automation-value').fill({'pan': '-0.9', 'cutoff': '200', 'reverb': '0'}[key])
            panel.locator('.automation-value').dispatch_event('change')
            authored[key] = self.page.evaluate(f'copyProject(projectStore.state.tracks.main.automation.{key})')
        parameter.select_option('pan')
        self.assertEqual(self.page.evaluate('AutomationEditors.main.tools.low'), -1)
        self.assertEqual(self.page.evaluate('AutomationEditors.main.tools.high'), 1)
        self.assertTrue(panel.locator('.automation-recording').is_hidden())
        canvas = panel.locator('.automation-curve')
        panel.locator('.automation-point').select_option('0')
        canvas.focus(); self.page.keyboard.press('ArrowDown')
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.main.automation.pan[0][1]'), -.91)
        self.page.evaluate('projectStore.undo()')
        canvas.focus(); self.page.keyboard.press('Control+a'); self.page.keyboard.press('Control+c')
        parameter.select_option('cutoff')
        self.assertTrue(panel.locator('.automation-paste').is_disabled())
        self.assertEqual(panel.locator('.automation-value').get_attribute('min'), '20')
        self.assertEqual(panel.locator('.automation-value').get_attribute('max'), '22000')
        panel.locator('.automation-overview > summary').click()
        self.assertEqual(panel.locator('.automation-lane canvas').count(), 4)
        panel.locator('.automation-lane').nth(3).click()
        self.assertEqual(parameter.input_value(), 'reverb')
        self.assertEqual(self.page.evaluate('AutomationEditors.main.tools.high'), 100)
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.automation'), authored)
        with self.page.expect_download() as download:
            self.page.locator('#saveProjectBtn').click()
        saved = json.loads(Path(download.value.path()).read_text(encoding='utf-8'))
        self.assertEqual(saved['tracks']['main']['automation'], authored)
        for width in [320, 375, 768, 1024, 1440]:
            self.page.set_viewport_size({'width': width, 'height': 900})
            self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.assertTrue(panel.locator('.automation-parameters').evaluate('(el)=>el.scrollWidth<=el.clientWidth'))

    def test_track_effects_browser_export_audio_match(self):
        import numpy as np
        from project import validate_project
        from track_effects import TrackEffectProcessor

        results = self.page.evaluate('''async () => {
          const results=[];
          for(const type of [...PROJECT_SCHEMA.curveTypes,'seek','refill','open','low']){
            const shape=['seek','refill'].includes(type)?'smooth':['open','low'].includes(type)?'linear':type;
            const descriptor={type:shape,...(shape==='bezier'?{control:[.8,.1,.2,.9]}:{})};
            const track=copyProject(projectStore.state.tracks.main);
            track.cutoff=type==='open'?22000:1200;track.reverb=type==='open'?0:35;
            track.automation=type==='open'?{}:{cutoff:[[0,600,descriptor],[.6,5000,{type:'hold'}],[1.1,900]],
              reverb:[[0,20,descriptor],[.5,75,{type:'hold'}],[1.1,0]]};
            if(type==='low'){track.cutoff=20;track.reverb=0;track.automation={};}
            const seek=type==='seek'?.25:0,frames=Math.round(1.25*44100);
            const ctx=new OfflineAudioContext(2,frames,44100),gain=ctx.createGain();gain.connect(ctx.destination);
            const effects=new TrackEffectsNode(ctx,gain,()=>trackReverbImpulse(ctx));
            effects.schedule(track,seek,0,true,2);
            const buffer=ctx.createBuffer(2,frames,44100);
            for(let c=0;c<2;c++)for(let i=0;i<frames;i++){
              const t=seek+i/44100;
              buffer.getChannelData(c)[i]=c===0?.08*Math.sin(2*Math.PI*200*t)+.04*Math.sin(2*Math.PI*5000*t):.09*Math.sin(2*Math.PI*960*t);
            }
            const source=ctx.createBufferSource();source.buffer=buffer;source.connect(effects.input);source.start();
            const refill=type==='refill'?ctx.suspend(.9).then(()=>{
              effects.schedule(track,ctx.currentTime,ctx.currentTime,true,2);return ctx.resume();
            }):Promise.resolve();
            const rendered=await ctx.startRendering();await refill;
            results.push({type,track,seek,channels:[...Array(2)].map((_,c)=>Array.from(rendered.getChannelData(c)))});
          }return results;
        }''')
        for result in results:
            track = validate_project({'version': 1, 'tracks': {'main': result['track']}})['tracks']['main']
            first = round(result['seek']*44100)
            observed = np.array(result['channels'], dtype=np.float32)
            times = (first+np.arange(observed.shape[1]))/44100
            samples = np.stack((.08*np.sin(2*np.pi*200*times)+.04*np.sin(2*np.pi*5000*times), .09*np.sin(2*np.pi*960*times))).astype(np.float32)
            processor = TrackEffectProcessor(track, 44100, first_frame=first)
            expected = np.concatenate([processor.process(samples[:, i:i+8192], first+i) for i in range(0, samples.shape[1], 8192)], axis=1)
            difference = np.abs(observed-expected)
            peak = np.unravel_index(np.argmax(difference), difference.shape)
            self.assertLess(float(np.max(difference)), .001, f"{result['type']}: max={np.max(difference)}, rms={np.sqrt(np.mean(difference**2))}, time={(first+peak[1])/44100}, nearby={difference[peak[0],max(0,peak[1]-3):peak[1]+4]}")

    def test_added_layer_effect_playback_refills_seek_and_parameter_switch_finishes_volume_take(self):
        self.load_audio()
        self.page.evaluate('''projectStore.update(p=>{p.effects.speed=1;p.effects.reverb=0;p.tracks.main.muted=true;
          p.tracks.track_effect={...copyProject(p.tracks.rain),fadeIn:0,fadeOut:0,cutoff:2000,reverb:30,
            automation:{pan:[[0,-.5],[3,.5]],cutoff:[[0,100],[3,5000]],reverb:[[0,10],[3,80]]}};});''')
        self.page.locator('#track_effectUpload').set_input_files(str(self.audio))
        wait_for_browser(self.page, '!!audioEngine.files.track_effect')
        self.page.evaluate('window.selectSidebarTab("track_effect")')
        panel = self.page.locator('#inspect-track_effect .automation-editor')
        panel.locator(':scope > summary').click()
        recording = panel.locator('.automation-recording')
        recording.locator('summary').click()
        recording.locator('.record-mode').select_option('latch')
        recording.locator('.record-arm').click()
        self.page.evaluate('audioEngine.play()')
        wait_for_browser(self.page, 'audioEngine.getProjectTime()>.1')
        recording.locator('.record-fader').evaluate('(el)=>{el.value=80;el.dispatchEvent(new Event("input"));}')
        wait_for_browser(self.page, 'audioEngine.getProjectTime()>.3')
        effects = self.page.evaluate('copyProject(projectStore.state.tracks.track_effect.automation)')
        panel.locator('.automation-parameter').select_option('cutoff')
        self.assertFalse(self.page.evaluate('AutomationEditors.track_effect.recorder.armed'))
        self.assertTrue(self.page.evaluate('projectStore.state.tracks.track_effect.automation.volume.length>0'))
        for parameter in ['pan', 'cutoff', 'reverb']:
            self.assertEqual(self.page.evaluate(f'projectStore.state.tracks.track_effect.automation.{parameter}'), effects[parameter])
        # The lookahead must refill beyond two seconds while the added layer stays connected.
        self.page.evaluate('''() => {
          const analyser=audioEngine.audioCtx.createAnalyser();analyser.fftSize=2048;
          audioEngine.trackNodes.track_effect.pan.connect(analyser);window.effectAnalyser=analyser;
        }''')
        wait_for_browser(self.page, 'audioEngine.getProjectTime()>2.1')
        self.assertGreater(self.page.evaluate('audioEngine.effectRefillAt'), 2)
        self.assertGreater(self.page.evaluate('audioEngine.trackNodes.track_effect.effects.filter.frequency.value'), 3300)
        self.assertTrue(self.page.evaluate('''() => {const samples=new Float32Array(effectAnalyser.fftSize);
          effectAnalyser.getFloatTimeDomainData(samples);return samples.some(v=>Math.abs(v)>.005);}'''))
        self.page.evaluate('audioEngine.pause();audioEngine.seekProjectTime(.5)')
        self.assertIsNone(self.page.evaluate('audioEngine.effectsTimer'))
        frequency = self.page.evaluate('audioEngine.trackNodes.track_effect.effects.filter.frequency.value')
        self.assertAlmostEqual(frequency, 100+4900*(int(.5*44100/128)*128/44100)/3, delta=.01)
        self.page.evaluate('projectStore.update(p=>{delete p.tracks.track_effect});')
        self.assertFalse(self.page.evaluate('!!audioEngine.ambientSources.track_effect'))

    def test_layer_chain_browser_export_audio_match_all_orders_and_bypass(self):
        import numpy as np
        from project import validate_project
        from track_effects import TrackEffectProcessor

        results = self.page.evaluate('''async () => {
          const permutations=items=>items.length?items.flatMap((item,i)=>permutations(items.filter((_,j)=>i!==j)).map(rest=>[item,...rest])):[[]];
          const cases=permutations(['eq','filter','reverb','delay']).map(order=>({order,bypass:[]}));
          for(const bypass of [['eq'],['filter'],['reverb'],['delay'],['eq','filter','reverb','delay']])cases.push({order:['delay','filter','reverb','eq'],bypass});
          cases.push({order:['eq','filter','reverb','delay'],bypass:['eq','filter','reverb'],long:true});
          const results=[];
          for(let index=0;index<cases.length;index++){
            const config=cases[index],seek=index%3===0?.07:0,frames=config.long?92000:12000;
            const track=copyProject(projectStore.state.tracks.main);track.cutoff=1500;track.reverb=40;
            track.automation={cutoff:[[0,250],[.12,4000,{type:'hold'}],[.25,500]],reverb:[[0,30,{type:'hold'}],[.2,80]]};
            Object.assign(track.effectChain,{order:config.order,bypass:config.bypass,delayTime:config.long?2:.017,delayFeedback:55,delayMix:45,
              eq:[{frequency:180,gain:6,q:1.5},{frequency:900,gain:-8,q:4},{frequency:6000,gain:9,q:.7}]});
            const ctx=new OfflineAudioContext(2,frames,44100),effects=new TrackEffectsNode(ctx,ctx.destination,()=>trackReverbImpulse(ctx));
            const buffer=ctx.createBuffer(2,frames,44100);
            for(let c=0;c<2;c++)for(let i=0;i<frames;i++){
              const t=seek+i/44100;buffer.getChannelData(c)[i]=c===0?.02*Math.sin(2*Math.PI*200*t)+.01*Math.sin(2*Math.PI*5000*t):.025*Math.sin(2*Math.PI*960*t);
            }
            effects.schedule(track,seek,0,true,4);
            const source=ctx.createBufferSource();source.buffer=buffer;source.connect(effects.input);source.start();
            const data=await ctx.startRendering();results.push({track,seek,channels:[...Array(2)].map((_,c)=>Array.from(data.getChannelData(c)))});
          }return results;
        }''')
        for result in results:
            track = validate_project({'version': 1, 'tracks': {'main': result['track']}})['tracks']['main']
            first = round(result['seek']*44100)
            observed = np.array(result['channels'], dtype=np.float32)
            times = (first+np.arange(observed.shape[1]))/44100
            samples = np.stack((.02*np.sin(2*np.pi*200*times)+.01*np.sin(2*np.pi*5000*times), .025*np.sin(2*np.pi*960*times))).astype(np.float32)
            processor = TrackEffectProcessor(track, 44100, first_frame=first)
            expected = np.concatenate([processor.process(samples[:, i:i+8192], first+i) for i in range(0, samples.shape[1], 8192)], axis=1)
            difference = float(np.max(np.abs(observed-expected)))
            self.assertLess(difference, .001, f"{track['effectChain']['order']} bypass={track['effectChain']['bypass']}: {difference}")

    def test_layer_chain_editor_eq_drag_precision_reorder_bypass_save_and_added_track(self):
        self.load_audio()
        panel = self.page.locator('#inspect-main .layer-effects-editor')
        panel.locator(':scope > summary').click()
        eq = panel.locator('[data-effect="eq"]')
        for key, value in [('frequency','500'),('gain','6'),('q','2.5')]:
            eq.locator(f'[data-eq-field="{key}"]').fill(value)
            eq.locator(f'[data-eq-field="{key}"]').dispatch_event('change')
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.effectChain.eq[0]'), {'frequency':500,'gain':6,'q':2.5})
        eq.locator('.eq-band-tabs button').nth(1).click()
        canvas = eq.locator('.eq-response')
        canvas.focus();self.page.keyboard.press('Shift+ArrowUp');self.page.keyboard.press('+')
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.main.effectChain.eq[1].gain'), .1)
        before = self.page.evaluate('copyProject(projectStore.state.tracks.main.effectChain.eq)')
        canvas.scroll_into_view_if_needed()
        x,y = self.page.evaluate('''()=>{const e=LayerEffectsEditors.main,[x,y]=e.position(e.chain.eq[1]),r=e.canvas.getBoundingClientRect();return [r.left+x,r.top+y];}''')
        history = self.page.evaluate('projectStore.past.length')
        self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+12,y-18);self.page.mouse.up()
        self.assertEqual(self.page.evaluate('projectStore.past.length'), history+1)
        self.assertGreater(self.page.evaluate('projectStore.state.tracks.main.effectChain.eq[1].frequency'), before[1]['frequency'])
        self.page.evaluate('projectStore.undo()')
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.effectChain.eq'), before)
        self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+20,y-10);self.page.keyboard.press('Escape');self.page.mouse.up()
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.effectChain.eq'), before)
        delay = panel.locator('[data-effect="delay"]')
        for label,value in [('Gecikme · ms','370'),('Geri besleme · %','55'),('Miktar · %','40')]:
            field=delay.get_by_label(label,exact=True);field.fill(value);field.dispatch_event('change')
        for _ in range(3):delay.locator('[data-direction="-1"]').click()
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.effectChain.order'), ['delay','eq','filter','reverb'])
        eq.locator('.layer-effect-enabled').uncheck()
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.effectChain.bypass'), ['eq'])
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.effectChain.eq'), before)
        self.assertTrue(eq.locator('.eq-response').is_visible())
        with self.page.expect_download() as download:self.page.locator('#saveProjectBtn').click()
        saved = json.loads(Path(download.value.path()).read_text(encoding='utf-8'))
        self.page.evaluate('p=>openStudioProject(p)',saved)
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.effectChain'), saved['tracks']['main']['effectChain'])
        for width in [320,375,768,1024,1440]:
            self.page.set_viewport_size({'width':width,'height':900})
            self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.assertTrue(panel.evaluate('(el)=>el.scrollWidth<=el.clientWidth'))
        self.page.locator('.add-track-btn').click()
        kind=self.page.evaluate('Object.keys(projectStore.state.tracks).find(id=>id.startsWith("track_"))')
        added=self.page.locator('#inspect-'+kind+' .layer-effects-editor')
        self.assertEqual(added.count(),1)
        added.locator(':scope > summary').click()
        added.locator('[data-effect="delay"]').get_by_label('Miktar · %',exact=True).fill('65')
        added.locator('[data-effect="delay"]').get_by_label('Miktar · %',exact=True).dispatch_event('change')
        self.assertEqual(self.page.evaluate('id=>projectStore.state.tracks[id].effectChain.delayMix',kind),65)
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.effectChain.delayMix'),40)

    def test_main_montage_commands_clock_reconnect_and_lyrics(self):
        self.load_audio()
        self.page.evaluate('''() => {
            projectStore.update(p=>{p.effects.speed=1;p.effects.reverb=0;p.tracks.main.start=.5;p.tracks.main.end=2.5;
              p.tracks.main.fadeIn=p.tracks.main.fadeOut=0;
              p.lyrics.lines=[{id:'l',text:'Kaynak sözü',start:1.5,end:2}];});
            audioEngine.seekProjectTime(1);
        }''')
        self.page.locator('[data-main-operation="split"]').click()
        wait_for_browser(self.page, 'projectStore.state.mainClips?.length===2 && !audioEngine.mainMontage.pending')
        self.assertAlmostEqual(self.page.evaluate('audioEngine.getProjectTime()'), 1, places=3)
        self.assertTrue(self.page.locator('#main-start').is_disabled())
        self.assertEqual(self.page.evaluate('mainSourceTime(projectStore.state,1.25)'), 1.75)
        self.page.locator('[data-main-field="offset"]').fill('2')
        self.page.locator('[data-main-field="offset"]').dispatch_event('change')
        wait_for_browser(self.page, '!audioEngine.mainMontage.pending')
        self.assertEqual(self.page.evaluate('projectDuration(projectStore.state)'), 3)
        self.assertEqual(self.page.evaluate('activeLyric(projectStore.state,1.5)'), None)
        self.assertEqual(self.page.evaluate('activeLyric(projectStore.state,2.25).text'), 'Kaynak sözü')
        self.page.evaluate('audioEngine.seekProjectTime(2.25)')
        self.page.evaluate('audioEngine.play()')
        wait_for_browser(self.page, 'audioEngine.wsMain.isPlaying() && audioEngine.getProjectTime()>2.3')
        self.page.evaluate('audioEngine.pause()')
        self.page.locator('.main-copy').click()
        self.page.evaluate('audioEngine.seekProjectTime(0)')
        self.page.locator('.main-paste').click()
        wait_for_browser(self.page, 'projectStore.state.mainClips.length===3 && !audioEngine.mainMontage.pending')
        self.assertEqual(self.page.evaluate('projectDuration(projectStore.state)'), 4)
        self.assertEqual(self.page.evaluate('activeLyric(projectStore.state,.25).text'), 'Kaynak sözü')
        self.page.locator('#undoBtn').click()
        wait_for_browser(self.page, 'projectStore.state.mainClips.length===2 && !audioEngine.mainMontage.pending')
        self.page.locator('#redoBtn').click()
        wait_for_browser(self.page, 'projectStore.state.mainClips.length===3 && !audioEngine.mainMontage.pending')
        self.page.evaluate('''async()=>{
          const project=copyProject(projectStore.state),file=audioEngine.files.main;
          audioEngine.disconnectTrack('main');openStudioProject(project,{checkpoint:false});
          await audioEngine.loadAudio('main',file);await audioEngine.mainMontage.ready();
        }''')
        self.assertEqual(self.page.evaluate('projectDuration(projectStore.state)'), 4)
        self.assertAlmostEqual(self.page.evaluate('audioEngine.wsMain.getDuration()'), 4, places=3)
        self.page.locator('.main-reset').click()
        wait_for_browser(self.page, 'projectStore.state.mainClips===null && !audioEngine.mainMontage.pending')
        self.assertTrue(self.page.locator('#main-start').is_enabled())
        self.assertEqual(self.page.evaluate('projectDuration(projectStore.state)'), 2)

    def test_main_montage_drag_cancel_and_superseded_builds(self):
        self.load_audio()
        self.page.evaluate('''() => {
          projectStore.update(p=>{p.effects.speed=1;p.mainClips=[{id:'a',start:0,end:.5,offset:0},{id:'b',start:1,end:2,offset:1}];});
        }''')
        wait_for_browser(self.page, '!audioEngine.mainMontage.pending')
        for width in [375,1440]:
            self.page.set_viewport_size({'width':width,'height':900})
            wave=self.page.locator('.track-main .timeline-lane').bounding_box()
            montage=self.page.locator('.main-edit-lane').bounding_box()
            self.assertAlmostEqual(wave['x'], montage['x'], places=2)
            self.assertAlmostEqual(wave['width'], montage['width'], places=2)
        body=self.page.locator('[data-main-clip="b"] .clip-body')
        box=body.bounding_box()
        self.page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
        self.page.mouse.down()
        self.page.mouse.move(box['x']+box['width']/2-60,box['y']+box['height']/2,steps=5)
        self.page.keyboard.press('Escape')
        self.page.mouse.up()
        self.assertEqual(self.page.evaluate('projectStore.state.mainClips[1].offset'), 1)
        body=self.page.locator('[data-main-clip="b"] .clip-body');box=body.bounding_box()
        before=self.page.evaluate('projectStore.past.length')
        self.page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
        self.page.mouse.down();self.page.mouse.move(box['x']+box['width']/2-60,box['y']+box['height']/2,steps=5);self.page.mouse.up()
        wait_for_browser(self.page, '!audioEngine.mainMontage.pending')
        self.assertLess(self.page.evaluate('projectStore.state.mainClips[1].offset'), 1)
        self.assertEqual(self.page.evaluate('projectStore.past.length'), before+1)
        self.page.evaluate('''async()=>{
          for(let i=0;i<8;i++)projectStore.update(p=>{p.mainClips[1].offset=1+i/24;});
          audioEngine.seekProjectTime(1.5);
          const playing=audioEngine.play();audioEngine.pause();await playing;
        }''')
        wait_for_browser(self.page, '!audioEngine.mainMontage.pending')
        self.assertFalse(self.page.evaluate('audioEngine.wsMain.isPlaying()'))
        self.assertAlmostEqual(self.page.evaluate('audioEngine.getProjectTime()'), 1.5, places=3)
        self.assertAlmostEqual(self.page.evaluate('audioEngine.wsMain.getDuration()'), 2+7/24, places=3)

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

    def test_extra_channel_is_audible_after_graph_initialization(self):
        self.load_audio()
        self.page.locator('#playBtn').click()
        wait_for_browser(self.page, 'audioEngine.graphReady')
        self.page.locator('.add-track-btn').click()
        kind = self.page.evaluate('Object.keys(projectStore.state.tracks).find(id => id.startsWith("track_"))')
        self.page.locator('#' + kind + 'Upload').set_input_files(str(self.audio))
        wait_for_browser(self.page, '(kind) => !!audioEngine.files[kind]', arg=kind)
        self.page.evaluate('''kind => {
            projectStore.update(p => {
                p.tracks.main.muted = true;
                Object.assign(p.tracks[kind], {fadeIn:0,fadeOut:0,volume:100});
            });
            const analyser = audioEngine.audioCtx.createAnalyser();
            analyser.fftSize=2048;
            audioEngine.trackNodes[kind].pan.connect(analyser);
            window.testLayerAnalyser=analyser;
        }''', kind)
        self.page.locator('#playBtn').click()
        wait_for_browser(self.page, '''() => {
            const samples = new Float32Array(testLayerAnalyser.fftSize);
            testLayerAnalyser.getFloatTimeDomainData(samples);
            return samples.some(value => Math.abs(value) > .02);
        }''')
        self.assertTrue(self.page.evaluate('(kind) => !!audioEngine.ambientSources[kind]', kind))
        self.page.locator('#playBtn').click()
        wait_for_browser(self.page, 'Object.keys(audioEngine.ambientSources).length === 0')

    def automation_coordinates(self, time, value):
        return self.page.evaluate('''([time,value])=>{const editor=AutomationEditors.main;
          editor.geometry();const [x,y]=editor.position(time,value),rect=editor.canvas.getBoundingClientRect();
          return [rect.left+x,rect.top+y];}''', [time, value])

    def open_large_automation(self):
        self.load_audio()
        self.page.evaluate('''projectStore.update(p=>{p.effects.speed=1;
          p.tracks.main.automation.volume=[[0,20],[.5,40,{type:'smooth'}],[1.5,140,{type:'hold'}],[2.5,50]];});''')
        panel = self.page.locator('#inspect-main .automation-editor')
        panel.locator(':scope > summary').click()
        panel.locator('.automation-expand').click()
        dialog = self.page.locator('.automation-dialog[open]')
        self.assertTrue(dialog.is_visible())
        dialog.locator('.automation-curve').evaluate('(el)=>el.scrollIntoView({block:"center"})')
        return dialog

    def test_advanced_automation_box_group_move_clipboard_and_cancel(self):
        dialog = self.open_large_automation()
        dialog.locator('.automation-tool').select_option('select')
        dialog.locator('.automation-curve').evaluate('(el)=>el.scrollIntoView({block:"center"})')
        start, end = self.automation_coordinates(.2,20), self.automation_coordinates(1.8,160)
        history = self.page.evaluate('projectStore.past.length')
        self.page.mouse.move(*start); self.page.mouse.down(); self.page.mouse.move(*end, steps=6); self.page.mouse.up()
        self.assertEqual(self.page.evaluate('[...AutomationEditors.main.tools.selection]'), [1,2])
        self.assertEqual(self.page.evaluate('projectStore.past.length'), history)
        original = self.page.evaluate('projectStore.state.tracks.main.automation.volume')
        start, end = self.automation_coordinates(.5,40), self.automation_coordinates(.7,60)
        self.page.mouse.move(*start); self.page.mouse.down(); self.page.mouse.move(*end, steps=6)
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.automation.volume'), original)
        self.page.mouse.up()
        moved = self.page.evaluate('projectStore.state.tracks.main.automation.volume')
        self.assertAlmostEqual(moved[1][0], .7, places=3)
        self.assertAlmostEqual(moved[2][0], 1.7, places=3)
        self.assertAlmostEqual(moved[1][1], 60, places=2)
        self.assertEqual(moved[1][2]['type'], 'smooth')
        self.assertEqual(moved[2][2]['type'], 'hold')
        self.assertEqual(self.page.evaluate('projectStore.past.length'), history+1)
        start, end = self.automation_coordinates(.7,60), self.automation_coordinates(.9,80)
        self.page.mouse.move(*start); self.page.mouse.down(); self.page.mouse.move(*end)
        self.page.keyboard.press('Escape'); self.page.mouse.up()
        self.assertTrue(dialog.is_visible())
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.automation.volume'), moved)
        self.assertEqual(self.page.evaluate('projectStore.past.length'), history+1)
        dialog.locator('.automation-copy').click()
        self.page.evaluate('audioEngine.seekProjectTime(1)')
        dialog.locator('.automation-paste').click()
        pasted = self.page.evaluate('projectStore.state.tracks.main.automation.volume')
        self.assertEqual(len(pasted), 6)
        self.assertEqual(pasted[2][2]['type'], 'smooth')
        self.assertEqual(pasted[4][2]['type'], 'hold')
        self.page.evaluate('projectStore.undo()')
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.automation.volume'), moved)
        dialog.locator('.automation-point').select_option('1')
        dialog.locator('.automation-bulk-settings summary').click()
        dialog.locator('.automation-delta-time').fill('100')
        dialog.locator('.automation-delta-value').fill('200')
        dialog.locator('.automation-move-selection').click()
        bounded = self.page.evaluate('projectStore.state.tracks.main.automation.volume')
        self.assertLess(bounded[1][0], bounded[2][0])
        self.assertEqual(bounded[1][1], 200)
        dialog.locator('header button').click()
        self.assertEqual(self.page.locator('.automation-dialog[open]').count(), 0)
        self.assertTrue(self.page.locator('#inspect-main .automation-editor .automation-content').is_visible())

    def test_advanced_automation_pencil_snap_zoom_undo_and_reopen(self):
        dialog = self.open_large_automation()
        history = self.page.evaluate('projectStore.past.length')
        dialog.locator('.automation-low').fill('20'); dialog.locator('.automation-low').dispatch_event('change')
        dialog.locator('.automation-high').fill('160'); dialog.locator('.automation-high').dispatch_event('change')
        self.assertEqual(self.page.evaluate('projectStore.past.length'), history)
        dialog.locator('.automation-time-zoom').fill('1')
        self.assertEqual(self.page.evaluate('timelineView.zoom'), 2)
        self.assertEqual(self.page.evaluate('[AutomationEditors.main.tools.low,AutomationEditors.main.tools.high]'), [20,160])
        dialog.locator('.automation-time-zoom').fill('0')
        dialog.locator('.automation-tool').select_option('draw')
        dialog.locator('.automation-snap').select_option('beat')
        dialog.locator('.automation-bpm').fill('120'); dialog.locator('.automation-bpm').dispatch_event('change')
        dialog.locator('.automation-division').select_option('2')
        history = self.page.evaluate('projectStore.past.length')  # Project rhythm is now an undoable setting.
        dialog.locator('.automation-curve').evaluate('(el)=>el.scrollIntoView({block:"center"})')
        original = self.page.evaluate('projectStore.state.tracks.main.automation.volume')
        self.page.mouse.move(*self.automation_coordinates(.61,50)); self.page.mouse.down()
        for t,v in [(.8,90),(1.05,150),(1.3,100),(1.55,60)]:
            self.page.mouse.move(*self.automation_coordinates(t,v), steps=4)
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.automation.volume'), original)
        self.page.mouse.up()
        drawn = self.page.evaluate('projectStore.state.tracks.main.automation.volume')
        self.assertEqual(self.page.evaluate('projectStore.past.length'), history+1)
        self.assertTrue(self.page.evaluate('''projectStore.state.tracks.main.automation.volume
          .filter(p=>p[0]>=.5&&p[0]<=1.5).every(p=>Math.abs(p[0]*4-Math.round(p[0]*4))<1e-8)'''))
        self.assertNotEqual(drawn, original)
        self.page.evaluate('projectStore.undo()')
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.automation.volume'), original)
        self.page.evaluate('projectStore.redo()')
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.automation.volume'), drawn)
        self.page.mouse.move(*self.automation_coordinates(.75,60)); self.page.mouse.down()
        self.page.mouse.move(*self.automation_coordinates(1.25,90)); self.page.keyboard.press('Escape'); self.page.mouse.up()
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.automation.volume'), drawn)
        dialog.locator('.automation-tool').select_option('point')
        dialog.locator('.automation-snap').select_option('frame')
        dialog.locator('.automation-curve').evaluate('(el)=>el.scrollIntoView({block:"center"})')
        self.page.mouse.click(*self.automation_coordinates(2.13,100))
        self.assertTrue(self.page.evaluate('projectStore.state.tracks.main.automation.volume.some(p=>Math.abs(p[0]-Math.round(2.13*24)/24)<1e-8)'))
        self.page.evaluate('projectStore.update(p=>{p.markers=[{id:"snap",time:2.3,name:"Hedef"}]})')
        dialog.locator('.automation-snap').select_option('marker')
        self.page.mouse.click(*self.automation_coordinates(2.32,130))
        self.assertTrue(self.page.evaluate('projectStore.state.tracks.main.automation.volume.some(p=>p[0]===2.3)'))
        saved = self.page.evaluate('JSON.parse(JSON.stringify(projectStore.state))')
        self.page.evaluate('p=>openStudioProject(p,{checkpoint:false})', saved)
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.automation.volume'), saved['tracks']['main']['automation']['volume'])

    def test_advanced_automation_keyboard_list_cross_track_and_empty_box(self):
        dialog = self.open_large_automation()
        dialog.locator('.automation-bulk-settings summary').click()
        dialog.locator('.automation-selection-list').select_option(['1','2'])
        self.assertEqual(self.page.evaluate('[...AutomationEditors.main.tools.selection]'), [1,2])
        dialog.locator('.automation-curve').focus()
        self.page.keyboard.press('Control+c')
        self.page.keyboard.press('ArrowUp')
        values = self.page.evaluate('projectStore.state.tracks.main.automation.volume.map(p=>p[1])')
        self.assertEqual(values, [20,41,141,50])
        self.page.keyboard.press('Delete')
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.automation.volume.length'), 2)
        self.page.keyboard.press('Escape')
        self.assertFalse(dialog.is_visible())
        self.page.evaluate('window.selectSidebarTab("rain")')
        rain = self.page.locator('#inspect-rain .automation-editor')
        rain.locator(':scope > summary').click()
        self.page.evaluate('audioEngine.seekProjectTime(0)')
        rain.locator('.automation-paste').click()
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.rain.automation.volume'),
                         [[0,40,{'type':'smooth'}],[1,140,{'type':'hold'}]])
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.automation.volume.length'), 2)
        self.page.evaluate('window.selectSidebarTab("main")')
        self.page.locator('#inspect-main .automation-expand').click()
        dialog = self.page.locator('.automation-dialog[open]')
        dialog.locator('.automation-tool').select_option('select')
        dialog.locator('.automation-curve').evaluate('(el)=>el.scrollIntoView({block:"center"})')
        self.page.mouse.move(*self.automation_coordinates(.6,160)); self.page.mouse.down()
        self.page.mouse.move(*self.automation_coordinates(1,180)); self.page.mouse.up()
        self.assertEqual(self.page.evaluate('[...AutomationEditors.main.tools.selection]'), [])
        self.assertTrue(dialog.locator('.automation-copy').is_disabled())
        dialog.locator('.automation-curve').focus(); self.page.keyboard.press('Control+a')
        self.assertEqual(self.page.evaluate('AutomationEditors.main.tools.selection.size'), 2)
        history = self.page.evaluate('projectStore.past.length')
        self.page.mouse.click(*self.automation_coordinates(.6,180))
        self.assertEqual(self.page.evaluate('AutomationEditors.main.tools.selection.size'), 0)
        self.assertEqual(self.page.evaluate('projectStore.past.length'), history)

    def test_volume_automation_edit_drag_undo_and_responsive_layout(self):
        self.load_audio()
        panel = self.page.locator('#inspect-main .automation-editor')
        panel.locator(':scope > summary').click()
        panel.locator('.automation-preset').select_option('swell')
        panel.locator('.automation-apply').click()
        points = self.page.evaluate('projectStore.state.tracks.main.automation.volume')
        self.assertEqual([point[1] for point in points], [0,100,0])
        self.assertEqual(points[0][0], 0)
        self.assertAlmostEqual(points[1][0] * 2, points[2][0])
        self.assertAlmostEqual(points[2][0], self.page.evaluate('projectDuration(projectStore.state)'))
        panel.locator('.automation-point').select_option('1')
        panel.locator('.automation-value').fill('65')
        panel.locator('.automation-value').press('Tab')
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.automation.volume[1][1]'), 65)
        original = self.page.evaluate('projectStore.state.tracks.main.automation.volume')
        history = self.page.evaluate('projectStore.past.length')
        curve = panel.locator('.automation-curve')
        curve.scroll_into_view_if_needed()
        box = curve.bounding_box()
        self.page.mouse.move(box['x'] + box['width']/2, box['y'] + 12 + (1-65/200)*128)
        self.page.mouse.down()
        self.page.mouse.move(box['x'] + box['width']*.75, box['y'] + 44, steps=12)
        self.page.mouse.up()
        self.assertEqual(self.page.evaluate('projectStore.past.length'), history + 1)
        self.page.evaluate('projectStore.undo()')
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.automation.volume'), original)
        curve.focus()
        self.page.keyboard.press('ArrowUp')
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.automation.volume[1][1]'), 66)
        self.page.keyboard.press('Delete')
        self.assertEqual(len(self.page.evaluate('projectStore.state.tracks.main.automation.volume')), 2)
        for theme in ['light','dark']:
            self.page.emulate_media(color_scheme=theme)
            for width in [320,375,768,1024,1440]:
                self.page.set_viewport_size({'width':width,'height':900})
                self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
                self.assertGreater(curve.bounding_box()['width'], 0)
        panel.locator('.automation-clear').click()
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.automation.volume'), [])

    def test_added_channel_automation_mounts_and_preserves_other_parameters(self):
        self.load_audio()
        self.page.locator('.add-track-btn').click()
        kind = self.page.evaluate('Object.keys(projectStore.state.tracks).find(id => id.startsWith("track_"))')
        panel = self.page.locator('#inspect-' + kind + ' .automation-editor')
        self.page.evaluate('kind => projectStore.update(p => { p.tracks[kind].automation.pan=[[0,-1],[2,1]]; })', kind)
        panel.locator(':scope > summary').click()
        panel.locator('.automation-add').click()
        self.assertEqual(self.page.evaluate('kind => projectStore.state.tracks[kind].automation.volume', kind), [[0,100]])
        panel.locator('.automation-value').fill('40')
        panel.locator('.automation-value').press('Tab')
        self.assertEqual(self.page.evaluate('kind => projectStore.state.tracks[kind].automation.pan', kind), [[0,-1],[2,1]])
        self.assertEqual(self.page.evaluate('kind => projectStore.state.tracks[kind].automation.volume', kind), [[0,40]])
        panel.locator('.automation-expand').click()
        self.assertTrue(self.page.locator('.automation-dialog[open]').is_visible())
        self.page.evaluate('kind=>projectStore.update(p=>{delete p.tracks[kind]})', kind)
        wait_for_browser(self.page, '!document.querySelector(".automation-dialog[open]")')
        self.page.evaluate('document.dispatchEvent(new CustomEvent("project-time",{detail:{time:1}}))')
        self.page.evaluate('projectStore.undo()')
        self.assertEqual(self.page.evaluate('kind=>projectStore.state.tracks[kind].automation.volume', kind), [[0,40]])

    def test_saved_dynamic_channel_reconnects_with_automation(self):
        self.load_audio()
        self.page.evaluate('''() => {
            const saved = JSON.parse(JSON.stringify(projectStore.state));
            saved.tracks.restored = {...saved.tracks.main, offset:.25,
                automation:{volume:[[0,25],[2,75]]}};
            openStudioProject(saved, {checkpoint:false});
        }''')
        self.assertEqual(self.page.locator('#inspect-restored .automation-editor').count(), 1)
        self.page.locator('#restoredUpload').set_input_files(str(self.audio))
        wait_for_browser(self.page, '!!audioEngine.files.restored')
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.restored.automation.volume'), [[0,25],[2,75]])
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.restored.offset'), .25)

    def test_real_audio_param_curves_match_fades_and_end_gate(self):
        # OfflineAudioContext exercises the browser's actual AudioParam event
        # ordering, including ramp + gate events at the same timestamp.
        errors = self.page.evaluate('''async () => {
            const errors=[];
            for (const scenario of ['constant','sparse','seek','overlap','ease-in','ease-out','smooth','hold','bezier','bezier-seek']) {
                projectStore.update(p=>{
                    p.effects.speed=1;
                    Object.assign(p.tracks.main, {start:0,end:2,offset:0,
                      source:{name:'constant.wav',size:100,lastModified:0,duration:2},
                      fadeIn:scenario==='overlap'?2:scenario==='constant'?0:.5,
                      fadeOut:scenario==='overlap'?2:scenario==='constant'?0:.5,
                      volume:100, automation:scenario==='constant'?{}:{volume:[[0,20],[3,170]]}});
                    if(PROJECT_SCHEMA.curveTypes.includes(scenario)||scenario==='bezier-seek'){
                      const type=scenario==='bezier-seek'?'bezier':scenario;
                      p.tracks.main.automation.volume=[[0,20,{type,...(type==='bezier'?{control:[0,1,0,1]}:{})}],[1,170,{type:'hold'}],[2,50]];
                    }
                });
                const seek=scenario==='seek'||scenario==='bezier-seek'?.7:0;
                const ctx=new OfflineAudioContext(2,Math.round(2.25*44100),44100);
                const engine=Object.create(Object.getPrototypeOf(audioEngine));engine.routing={schedule(){},scheduleEffects(){}};
                engine.graphReady=true;engine.audioCtx=ctx;
                engine.wsMap={main:{getCurrentTime:()=>seek,isPlaying:()=>true}};
                engine.trackNodes={};
                for(const kind of Object.keys(projectStore.state.tracks))
                    engine.trackNodes[kind]={gain:ctx.createGain(),pan:ctx.createStereoPanner()};
                const source=ctx.createConstantSource();
                source.connect(engine.trackNodes.main.gain).connect(ctx.destination);
                engine.scheduleEnvelopes();source.start();
                const buffer=await ctx.startRendering(),data=buffer.getChannelData(0);
                for(const elapsed of [.1,.25,.5,.75,1,1.25,1.49,1.75,1.99,2.1]) {
                    const index=Math.round(elapsed*44100),time=seek+index/44100;
                    const timing=trackTiming(projectStore.state,'main',time);
                    const expected=timing.envelope*automationValue(projectStore.state.tracks.main.automation.volume,time,100)/100;
                    if(Math.abs(data[index]-expected)>.0006)errors.push({scenario,time,actual:data[index],expected});
                }
            }
            return errors;
        }''')
        self.assertEqual(errors, [])

    def test_real_audio_pan_transition_characters(self):
        errors = self.page.evaluate('''async () => {
          const errors=[];
          for(const type of PROJECT_SCHEMA.curveTypes){
            projectStore.update(p=>{p.effects.speed=1;Object.assign(p.tracks.main,{start:0,end:2,offset:0,
              source:{name:'test',size:1,lastModified:0,duration:2},fadeIn:0,fadeOut:0,volume:100,
              automation:{pan:[[0,-1,{type,...(type==='bezier'?{control:[.9,0,.1,1]}:{})}],[1,1],[2,0]]}});});
            const ctx=new OfflineAudioContext(2,Math.round(2.1*44100),44100),engine=Object.create(Object.getPrototypeOf(audioEngine));engine.routing={schedule(){},scheduleEffects(){}};
            engine.graphReady=true;engine.audioCtx=ctx;engine.wsMap={main:{getCurrentTime:()=>0,isPlaying:()=>true}};engine.trackNodes={};
            for(const kind of Object.keys(projectStore.state.tracks))engine.trackNodes[kind]={gain:ctx.createGain(),pan:ctx.createStereoPanner()};
            const source=ctx.createBufferSource();source.buffer=ctx.createBuffer(2,2*44100,44100);
            for(let c=0;c<2;c++)source.buffer.getChannelData(c).fill(1);
            source.connect(engine.trackNodes.main.gain).connect(engine.trackNodes.main.pan).connect(ctx.destination);
            engine.scheduleEnvelopes();source.start();const buffer=await ctx.startRendering();
            for(const t of [.1,.25,.49,.5,.75,.99,1,1.5,1.99,2.05]){
              const index=Math.round(t*44100),time=index/44100,pan=automationValue(projectStore.state.tracks.main.automation.pan,time,0);
              const expected=time>=2?[0,0]:pan<=0?[1+Math.cos((pan+1)*Math.PI/2),Math.sin((pan+1)*Math.PI/2)]:[Math.cos(pan*Math.PI/2),1+Math.sin(pan*Math.PI/2)];
              for(let c=0;c<2;c++)if(Math.abs(buffer.getChannelData(c)[index]-expected[c])>.001)errors.push({type,time,channel:c,actual:buffer.getChannelData(c)[index],expected:expected[c]});
            }
          }return errors;
        }''')
        self.assertEqual(errors, [])

    def open_word_editor(self):
        self.load_audio()
        self.page.evaluate('''projectStore.update(p=>{p.effects.speed=1;p.lyrics.animation='none';p.lyrics.lines=[
          {id:'words',text:'İçimde ışık',start:.2,end:2.7,words:[{text:'İçimde',start:.3,end:.9},{text:'ışık',start:1.5,end:2.5}]},
          {id:'next',text:'Son söz',start:2.7,end:3}];});''')
        self.select('lyrics')
        editor = self.page.locator('#lyricWordEditor')
        editor.locator('summary').click()
        return editor

    def test_word_timing_numbers_keyboard_stamps_save_and_reopen(self):
        editor = self.open_word_editor()
        field = editor.locator('.word-field').first.locator('[data-edge=end]')
        history = self.page.evaluate('projectStore.past.length')
        field.fill('0.850');field.press('Tab')
        self.assertEqual(self.page.evaluate('projectStore.state.lyrics.lines[0].words[0].end'), .85)
        self.assertEqual(self.page.evaluate('projectStore.past.length'), history+1)
        handle = editor.locator('.word-block[data-index="0"] .word-end')
        handle.focus();handle.press('ArrowRight');handle.press('Alt+ArrowRight')
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.lyrics.lines[0].words[0].end'), .861)
        self.assertEqual(self.page.evaluate('document.activeElement.dataset.part'), 'end')
        self.page.evaluate('audioEngine.seekProjectTime(.55)')
        editor.locator('.word-start-now').click()
        self.assertEqual(self.page.evaluate('projectStore.state.lyrics.lines[0].words[0].start'), .55)
        boundary=editor.locator('.word-field').first.locator('[data-edge=end]')
        boundary.fill('1.5');boundary.press('Tab')
        boundary.fill('1.8');boundary.press('Tab')
        self.assertEqual(boundary.input_value(), '1.500')
        self.page.evaluate('projectStore.undo()')
        self.page.get_by_text('Tipografi, Renk & Görünüm', exact=True).click()
        self.page.get_by_label('Kelime girişi', exact=True).select_option('typewriter')
        self.page.get_by_label('Kelime giriş süresi · proje sn', exact=True).fill('0.24')
        self.page.get_by_label('Kelime giriş süresi · proje sn', exact=True).press('Tab')
        with self.page.expect_download() as download:
            self.page.locator('#saveProjectBtn').click()
        saved = json.loads(Path(download.value.path()).read_text(encoding='utf-8'))
        self.assertEqual(saved['lyrics']['wordAnimation'], 'typewriter')
        self.assertEqual(saved['lyrics']['lines'][0]['words'][0]['start'], .55)
        self.page.evaluate('p=>projectStore.replace(p)', saved)
        self.assertAlmostEqual(float(editor.locator('.word-field').first.locator('[data-edge=end]').input_value()), .861)
        editor.locator('.word-reset').click()
        self.assertFalse(self.page.evaluate('Object.hasOwn(projectStore.state.lyrics.lines[0],"words")'))
        self.page.evaluate('projectStore.undo()')
        self.assertEqual(self.page.evaluate('projectStore.state.lyrics.lines[0].words[0].start'), .55)

    def test_word_timeline_drag_preview_single_undo_cancel_and_selection(self):
        editor = self.open_word_editor()
        handle = editor.locator('.word-block[data-index="0"] .word-end')
        handle.scroll_into_view_if_needed();box=handle.bounding_box()
        history = self.page.evaluate('projectStore.past.length')
        before = self.page.evaluate('projectStore.snapshot()')
        self.page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
        self.page.mouse.down();self.page.mouse.move(box['x']-40,box['y']+box['height']/2,steps=5)
        self.assertTrue(self.page.evaluate('!!lyricWordTimingEditor.draft'))
        self.assertEqual(self.page.evaluate('projectStore.snapshot()'), before)
        self.assertLess(self.page.evaluate('lyricWordTimingEditor.draft.words[0].end'), .9)
        self.page.mouse.up()
        self.assertEqual(self.page.evaluate('projectStore.past.length'), history+1)
        self.assertLess(self.page.evaluate('projectStore.state.lyrics.lines[0].words[0].end'), .9)
        self.page.evaluate('projectStore.undo()')
        self.assertEqual(self.page.evaluate('projectStore.snapshot()'), before)
        handle.scroll_into_view_if_needed();box=handle.bounding_box()
        self.page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
        self.page.mouse.down();self.page.mouse.move(box['x']+30,box['y']+box['height']/2,steps=4)
        self.page.keyboard.press('Escape');self.page.mouse.up()
        self.assertFalse(self.page.evaluate('!!lyricWordTimingEditor.draft'))
        self.assertEqual(self.page.evaluate('projectStore.snapshot()'), before)
        handle.scroll_into_view_if_needed();box=handle.bounding_box()
        self.page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
        self.page.mouse.down();self.page.mouse.move(box['x']+30,box['y']+box['height']/2,steps=4)
        self.assertTrue(self.page.evaluate('!!lyricWordTimingEditor.draft'))
        self.page.locator('.lyric-row[data-id=next] textarea').focus()
        self.assertFalse(self.page.evaluate('!!lyricWordTimingEditor.draft'))
        self.page.mouse.up()
        self.assertEqual(self.page.evaluate('projectStore.snapshot()'), before)
        self.assertEqual(editor.locator('.word-field').count(), 2)
        self.assertIn('Tahmini', editor.locator('.word-summary').inner_text())
        editor.locator('.word-distribute').click()
        self.assertEqual(self.page.evaluate('projectStore.state.lyrics.lines[1].words.length'), 2)

    def test_word_karaoke_and_typewriter_pixels_respect_actual_pauses(self):
        self.load_audio()
        counts = self.page.evaluate('''async()=>{
          await document.fonts.ready;
          const p=copyProject(projectStore.state),c=document.createElement('canvas');c.width=640;c.height=360;
          p.effects.speed=1;Object.assign(p.lyrics,{animation:'none',template:'karaoke',font:'Arial',fontSize:64,
            outline:0,glowIntensity:0,bassEffects:[],bassEffect:'none',color:'#ffffff',glowColor:'#ff0000',x:50,y:30,
            lines:[{id:'a',text:'Aa BBBB',start:0,end:3,words:[{text:'Aa',start:.25,end:.75},{text:'BBBB',start:1.75,end:2.75}]}]});
          const metrics=JSON.parse(document.getElementById('lyricFontMetrics').textContent),result={};
          for(const mode of ['none','typewriter','fade','pop','slide']){
            p.lyrics.wordAnimation=mode;if(mode!=='none')p.lyrics.template='default';
            result[mode]=[.125,.5,.9,1.25,2.25,2.9].map(time=>{
              drawLyricLayer(c,p,time,metrics);const a=c.getContext('2d').getImageData(0,0,640,360).data;
              let red=0,alpha=0;for(let i=0;i<a.length;i+=4){if(a[i+3]>5)alpha++;if(a[i]>150&&a[i+1]<40&&a[i+3]>100)red++;}
              return {red,alpha};
            });
          }return result;
        }''')
        karaoke = counts['none']
        self.assertEqual(karaoke[0]['red'], 0)
        self.assertGreater(karaoke[1]['red'], 0)
        self.assertGreater(karaoke[2]['red'], karaoke[1]['red'])
        self.assertEqual(karaoke[2]['red'], karaoke[3]['red'])
        self.assertGreater(karaoke[4]['red'], karaoke[3]['red'])
        for mode in ['typewriter','fade','pop','slide']:
            with self.subTest(mode=mode):
                values=counts[mode]
                self.assertEqual(values[0]['alpha'], 0)
                self.assertGreater(values[1]['alpha'], 0)
                self.assertEqual(values[2]['alpha'], values[3]['alpha'])
                self.assertGreater(values[4]['alpha'], values[3]['alpha'])

    def test_lyric_presets_replace_previous_beat_effects_and_box_choices_roundtrip(self):
        self.select('lyrics')
        self.page.get_by_text('Tipografi, Renk & Görünüm', exact=True).click()
        for preset, expected in [('🔥 Phonk Trap', ['bounce', 'glow']),
                                 ('☕ Lo-Fi Vintage', ['pulse']),
                                 ('🌅 Romantic Sunset', ['pulse', 'glow']),
                                 ('⚡ Cyberpunk Neon', ['glow'])]:
            self.page.get_by_role('button', name=preset, exact=True).click()
            self.assertEqual(self.page.evaluate('projectStore.state.lyrics.bassEffects'), expected)
        box = self.page.get_by_label('Kutu stili', exact=True)
        for value, label in [('none', 'Kapalı'), ('box', 'Kare Kutu'), ('pill', 'Yuvarlak Hap')]:
            box.select_option(value)
            self.assertEqual(box.locator('option:checked').inner_text(), label)
            self.assertEqual(self.page.evaluate('projectStore.snapshot().lyrics.boxStyle'), value)
            self.page.evaluate('projectStore.replace(projectStore.snapshot())')
            self.assertEqual(box.input_value(), value)

    def test_lyric_file_import_does_not_overwrite_edits_made_while_reading(self):
        self.load_audio()
        self.select('lyrics')
        self.page.evaluate('''() => {
          projectStore.update(p=>{p.effects.speed=1;p.lyrics.lines=[{id:'original',text:'Önceki',start:0,end:1}];});
          document.getElementById('lyricsTimebase').value='project';
          window.importErrors=[];
          document.addEventListener('studio-error',event=>importErrors.push(event.detail));
          const input=document.getElementById('lyricsImport');
          Object.defineProperty(input,'files',{configurable:true,value:[{name:'lyrics.srt',size:50,
            text:()=>new Promise(resolve=>window.finishLyricImport=resolve)}]});
          input.dispatchEvent(new Event('change'));
        }''')
        # The audio file identity remains identical, but project-to-source conversion changes.
        self.page.evaluate("projectStore.update(p=>{p.effects.speed=.5;p.lyrics.lines[0].text='Düzenlenen';})")
        before = self.page.evaluate('projectStore.snapshot()')
        history = self.page.evaluate('projectStore.past.length')
        self.page.evaluate("finishLyricImport('1\\n00:00:00,100 --> 00:00:00,500\\nYeni söz')")
        wait_for_browser(self.page, 'importErrors.length>0')
        self.assertEqual(self.page.evaluate('projectStore.snapshot()'), before)
        self.assertEqual(self.page.evaluate('projectStore.past.length'), history)
        self.assertIn('yeniden', self.page.evaluate('importErrors[0]'))

    def test_latest_lyric_file_import_wins_and_keeps_project_time_conversion(self):
        self.load_audio()
        self.select('lyrics')
        self.page.evaluate('''() => {
          projectStore.update(p=>{p.effects.speed=.5;p.tracks.main.start=.5;p.tracks.main.end=2.5;p.lyrics.offset=.1;});
          document.getElementById('lyricsTimebase').value='project';
          window.importErrors=[];
          document.addEventListener('studio-error',event=>importErrors.push(event.detail));
          const input=document.getElementById('lyricsImport');
          for(const name of ['first','last']) {
            Object.defineProperty(input,'files',{configurable:true,value:[{name:name+'.srt',size:50,
              text:()=>new Promise(resolve=>window['finish_'+name]=resolve)}]});
            input.dispatchEvent(new Event('change'));
          }
        }''')
        self.page.evaluate("finish_first('1\\n00:00:00,200 --> 00:00:00,600\\nEski istek')")
        self.assertEqual(self.page.evaluate('projectStore.state.lyrics.lines'), [])
        self.page.evaluate("finish_last('1\\n00:00:00,200 --> 00:00:00,600\\nSon istek')")
        wait_for_browser(self.page, 'projectStore.state.lyrics.lines.length===1')
        lyrics = self.page.evaluate('projectStore.snapshot().lyrics')
        self.assertEqual(lyrics['lines'][0]['text'], 'Son istek')
        self.assertAlmostEqual(lyrics['lines'][0]['start'], .6)
        self.assertAlmostEqual(lyrics['lines'][0]['end'], .8)
        self.assertEqual(lyrics['offset'], 0)
        self.assertEqual(self.page.evaluate('importErrors'), [])

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

    def test_split_fades_remain_continuous_in_real_audio_params(self):
        errors = self.page.evaluate('''async () => {
            projectStore.update(p=>{
                p.effects.speed=1;
                p.tracks.main.source={name:'constant.wav',size:100,lastModified:0,duration:3};
                Object.assign(p.tracks.rain,{source:{...p.tracks.main.source},offset:0,
                    fadeIn:1.2,fadeOut:1.5,automation:{volume:[[0,20],[3,170]]}});
            });
            const original=copyProject(projectStore.state);
            let right;projectStore.update(p=>{right=editAudioLayer(p,'rain','split',.7);});
            const ctx=new OfflineAudioContext(2,Math.round(3.25*44100),44100);
            const engine=Object.create(Object.getPrototypeOf(audioEngine));engine.routing={schedule(){},scheduleEffects(){}};
            engine.graphReady=true;engine.audioCtx=ctx;engine.getProjectTime=()=>0;
            engine.wsMap={main:{isPlaying:()=>true}};engine.trackNodes={};
            for(const kind of Object.keys(projectStore.state.tracks))
                engine.trackNodes[kind]={gain:ctx.createGain(),pan:ctx.createStereoPanner()};
            for(const kind of ['rain',right]){
                const source=ctx.createConstantSource();source.connect(engine.trackNodes[kind].gain).connect(ctx.destination);source.start();
            }
            engine.scheduleEnvelopes();
            const data=(await ctx.startRendering()).getChannelData(0),errors=[];
            for(const time of [.1,.5,.699,.7,.701,1,1.49,1.75,2.25,2.99,3.1]){
                const index=Math.round(time*44100),t=index/44100;
                const expected=trackTiming(original,'rain',t).envelope*automationValue(original.tracks.rain.automation.volume,t,100)/100;
                if(Math.abs(data[index]-expected)>.0006)errors.push({time,expected,actual:data[index]});
            }
            return errors;
        }''')
        self.assertEqual(errors, [])

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

    def test_shared_viewport_frames_timecode_and_db(self):
        self.load_audio()
        self.page.locator('#frameNext').click()
        fps = self.page.evaluate('Number(projectStore.state.output.fps)')
        self.assertAlmostEqual(self.page.evaluate('audioEngine.getProjectTime()'), 1/fps, places=4)
        self.page.locator('#frameTimecode').fill('00:00:01:15')
        self.page.locator('#frameTimecode').press('Enter')
        self.assertAlmostEqual(self.page.evaluate('audioEngine.getProjectTime()'), 1+15/fps, places=4)
        self.page.locator('#timelineZoom').fill('2')
        self.assertEqual(self.page.evaluate('timelineView.zoom'), 4)
        self.page.locator('#timelinePan').fill('1')
        self.assertEqual(self.page.evaluate('timelineView.start'), 1)
        curve = self.page.locator('#inspect-main .automation-editor')
        curve.locator(':scope > summary').click()
        self.assertEqual(curve.locator('.automation-axis span').first.inner_text(), '1.00 sn')
        self.page.locator('#timelineAutomation').click()
        self.assertEqual(self.page.locator('#timelineAutomation').get_attribute('aria-pressed'), 'true')
        self.page.locator('#timelineFit').click()
        self.assertEqual(self.page.evaluate('timelineView.zoom'), 1)
        self.page.locator('#inspect-main .level-unit-controls select').select_option('dB')
        db = self.page.locator('#inspect-main [aria-label="Ses seviyesi dB"]')
        db.fill('-6')
        db.press('Tab')
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.main.volume'), 100*10**(-6/20))

    def test_aux_split_duplicate_undo_and_library_audio(self):
        self.load_audio()
        self.page.locator('.add-track-btn').click()
        kind = self.page.evaluate('Object.keys(projectStore.state.tracks).find(id=>id.startsWith("track_"))')
        self.page.locator('#'+kind+'Upload').set_input_files(str(self.audio))
        wait_for_browser(self.page, 'kind=>!!audioEngine.files[kind]', arg=kind)
        self.page.evaluate('window.seekProjectTime(1.25)')
        self.page.locator('#inspect-'+kind+' [data-audio-operation="split"]').click()
        wait_for_browser(self.page, 'Object.keys(audioEngine.files).length===3')
        right = self.page.evaluate('(kind)=>Object.keys(projectStore.state.tracks).find(id=>id.startsWith("track_")&&id!==kind)', kind)
        self.assertAlmostEqual(self.page.evaluate('id=>projectStore.state.tracks[id].phase', right), 1.25)
        self.assertTrue(self.page.locator('#inspect-'+right+' [data-edit-key="offset"]').is_visible())
        self.page.locator('#undoBtn').click()
        self.assertFalse(self.page.evaluate('id=>!!projectStore.state.tracks[id]', right))
        self.page.locator('#redoBtn').click()
        self.assertTrue(self.page.evaluate('id=>!!audioEngine.files[id] && !!projectStore.state.tracks[id]', right))
        self.page.evaluate('window.selectSidebarTab("video");mediaLibrary.panel.open=true')
        self.page.locator('.library-filter').select_option('audio')
        self.page.locator('.library-search').fill('uzun-bir-kaynak')
        self.assertEqual(self.page.locator('.library-item').count(), 1)
        self.page.locator('.library-item').drag_to(self.page.locator('.track-main .timeline-lane'))
        wait_for_browser(self.page, 'Object.keys(projectStore.state.tracks).length===6')

    def test_frame_units_keep_seconds_exact_and_follow_output_fps(self):
        self.load_audio()
        self.page.locator('#inspect-main .trim-header').click()
        group = self.page.locator('#main-start').locator('..')
        self.page.locator('#main-start').fill('0.1')
        self.page.locator('#main-start').press('Tab')
        group.locator('select').select_option('frames')
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.main.start'), .1)
        frame = group.locator('input').nth(1)
        frame.fill('1')
        frame.press('Tab')
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.main.start'), 1/24)
        self.page.locator('#undoBtn').click()
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.main.start'), .1)
        self.assertEqual(frame.input_value(), '2')
        self.page.evaluate("projectStore.update(p=>{p.output.fps='60'})")
        self.assertEqual(frame.input_value(), '6')
        frame.fill('12')
        frame.press('Tab')
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.main.start'), .2)
        group.locator('select').select_option('seconds')
        self.assertAlmostEqual(float(self.page.locator('#main-start').input_value()), .2)

    def test_audio_clipboard_pastes_after_source_layer_deleted(self):
        self.load_audio()
        self.page.locator('.add-track-btn').click()
        kind = self.page.evaluate('Object.keys(projectStore.state.tracks).find(id=>id.startsWith("track_"))')
        self.page.locator('#'+kind+'Upload').set_input_files(str(self.audio))
        wait_for_browser(self.page, 'id=>!!audioEngine.files[id]', arg=kind)
        self.page.evaluate("id=>projectStore.update(p=>{Object.assign(p.tracks[id],{pan:-.4,volume:75,start:.5,end:2,loop:false,automation:{volume:[[0,20],[3,100]]}})})", kind)
        inspector = self.page.locator('#inspect-'+kind)
        inspector.locator('[data-audio-operation="copy"]').click()
        inspector.locator('[data-audio-operation="delete"]').click()
        self.page.evaluate('window.seekProjectTime(.5)')
        self.page.locator('.audio-paste').click()
        wait_for_browser(self.page, 'Object.keys(audioEngine.files).length===2')
        pasted = self.page.evaluate('Object.keys(projectStore.state.tracks).find(id=>id.startsWith("track_"))')
        self.assertNotEqual(pasted, kind)
        self.assertAlmostEqual(self.page.evaluate('id=>projectStore.state.tracks[id].pan', pasted), -.4)
        self.assertEqual(self.page.evaluate('id=>projectStore.state.tracks[id].until', pasted), 2)
        self.assertTrue(self.page.evaluate('id=>!!audioEngine.ws(id).getDecodedData()', pasted))
        self.page.locator('#undoBtn').click()
        self.assertFalse(self.page.evaluate('id=>!!projectStore.state.tracks[id]', pasted))
        self.page.locator('#redoBtn').click()
        self.assertTrue(self.page.evaluate('id=>!!audioEngine.files[id]', pasted))

    def test_frame_units_in_automation_lyrics_and_nullable_video_end(self):
        self.load_audio()
        curve = self.page.locator('#inspect-main .automation-editor')
        curve.locator(':scope > summary').click()
        curve.locator('.automation-add').click()
        group = curve.locator('.automation-time').locator('..')
        group.locator('select').select_option('frames')
        group.locator('input').nth(1).fill('2')
        group.locator('input').nth(1).press('Tab')
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.main.automation.volume[0][0]'), 2/24)
        self.page.evaluate("projectStore.update(p=>{p.lyrics.lines=[{id:'row',text:'Deneme',start:.5,end:2}]})")
        self.select('lyrics')
        group = self.page.locator('.lyric-row .time-unit-control').first
        group.locator('select').select_option('frames')
        group.locator('input').nth(1).fill('6')
        group.locator('input').nth(1).press('Tab')
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.lyrics.lines[0].start'), .25)
        self.assertEqual(group.locator('select').input_value(), 'frames')
        with self.open_transition_editor():
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id);window.selectSidebarTab("video")')
            group = self.page.locator('#video-end').locator('..')
            group.locator('select').select_option('frames')
            group.locator('input').nth(1).fill('24')
            group.locator('input').nth(1).press('Tab')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].end'), 1)
            group.locator('input').nth(1).fill('')
            group.locator('input').nth(1).press('Tab')
            self.assertIsNone(self.page.evaluate('projectStore.state.videoClips[0].end'))

    def test_rotation_and_mirrors_move_source_pixels(self):
        result = self.page.evaluate('''() => {
          const source=document.createElement('canvas');source.width=source.height=2;
          const ctx=source.getContext('2d');
          ['#ff0000','#00ff00','#0000ff','#ffffff'].forEach((color,i)=>{ctx.fillStyle=color;ctx.fillRect(i%2,Math.floor(i/2),1,1)});
          const output=document.createElement('canvas');output.width=output.height=4;
          const target=output.getContext('2d');target.imageSmoothingEnabled=false;
          return [{mirrorX:true},{mirrorY:true},{rotation:90},{cropLeft:50,cropTop:50},{translateX:50}].map(transform=>{
            target.clearRect(0,0,4,4);
            drawVideoSource(target,source,{width:2,height:2},{width:4,height:4},{...projectStore.state.video,...transform});
            return [[1,1],[3,1],[1,3],[3,3]].map(([x,y])=>Array.from(target.getImageData(x,y,1,1).data).slice(0,3));
          });
        }''')
        red, green, blue, white = [255,0,0], [0,255,0], [0,0,255], [255,255,255]
        black = [0,0,0]
        self.assertEqual(result, [[green,red,white,blue],[blue,white,red,green],[blue,red,white,green],
                                  [white,white,white,white],[black,red,black,blue]])

    def load_keyframe_media(self):
        from PIL import Image
        media = Path(self.temporary.name) / 'keyframe.gif'
        Image.new('RGB', (64, 32), '#627255').save(media, save_all=True,
            append_images=[Image.new('RGB', (64, 32), '#a08060')], duration=500, loop=0)
        self.load_audio()
        self.page.evaluate('projectStore.update(p=>{p.effects.speed=1;p.output.fps="30";p.video.fadeIn=p.video.fadeOut=0})')
        self.page.locator('#backgroundUpload').set_input_files(str(media))
        wait_for_browser(self.page, 'videoPreview.ready && !videoPreview.busy')
        self.page.evaluate('window.selectSidebarTab("video");audioEngine.seekProjectTime(0)')

    def test_segment_curve_authoring_handles_insert_and_reopen(self):
        import media_assets
        with patch.object(media_assets, 'ASSET_DIR', Path(self.temporary.name) / 'segment-curve-assets'):
            self.load_keyframe_media()
            self.page.evaluate('''projectStore.update(p=>{p.video.keyframes.zoom=[[0,.7],[1.5,1.2],[3,.8]];
              p.tracks.main.automation.volume=[[0,20],[1.5,120],[3,30]];});''')
            self.page.locator('.keyframe-parameter').select_option('zoom')
            video = self.page.locator('.keyframe-editor .segment-curve-editor')
            video.locator('.segment-curve-type').select_option('ease-in')
            self.assertEqual(self.page.evaluate('projectStore.state.video.keyframes.zoom[0][2].type'), 'ease-in')
            self.page.evaluate('audioEngine.seekProjectTime(.75)')
            self.assertEqual(self.page.locator('.keyframe-value').input_value(), '0.825')
            video.locator('.segment-curve-type').select_option('hold')
            self.assertEqual(self.page.locator('.keyframe-value').input_value(), '0.7')
            self.page.evaluate('audioEngine.seekProjectTime(1.5)')
            video.locator('.segment-curve-type').select_option('ease-out')
            self.assertEqual(self.page.evaluate('projectStore.state.video.keyframes.zoom[0][2].type'), 'hold')
            self.assertEqual(self.page.evaluate('projectStore.state.video.keyframes.zoom[1][2].type'), 'ease-out')
            self.page.evaluate('audioEngine.seekProjectTime(0)')
            video.locator('.segment-curve-type').select_option('bezier')
            inputs = video.locator('.segment-bezier-fields input')
            inputs.nth(0).fill('0.812345')
            inputs.nth(0).dispatch_event('change')
            inputs.nth(1).fill('0.2')
            inputs.nth(1).dispatch_event('change')
            self.assertEqual(self.page.evaluate('projectStore.state.video.keyframes.zoom[0][2].control[0]'), .812345)
            inputs.nth(0).fill('0.8')
            inputs.nth(0).dispatch_event('change')
            self.assertEqual(self.page.evaluate('projectStore.state.video.keyframes.zoom[0][2].control[0]'), .8)
            video.locator('svg').scroll_into_view_if_needed()
            handle = video.locator('[data-handle="0"]')
            box = handle.bounding_box()
            before = self.page.evaluate('projectStore.past.length')
            descriptor = self.page.evaluate('projectStore.state.video.keyframes.zoom[0][2]')
            self.page.mouse.move(box['x']+box['width']/2, box['y']+box['height']/2)
            self.page.mouse.down()
            self.page.mouse.move(box['x']-25, box['y']-20, steps=4)
            self.page.keyboard.press('Escape')
            self.page.mouse.up()
            self.assertEqual(self.page.evaluate('projectStore.state.video.keyframes.zoom[0][2]'), descriptor)
            self.assertEqual(self.page.evaluate('projectStore.past.length'), before)
            box = handle.bounding_box()
            self.page.mouse.move(box['x']+box['width']/2, box['y']+box['height']/2)
            self.page.mouse.down()
            self.page.mouse.move(box['x']-25, box['y']-20, steps=4)
            self.page.mouse.up()
            self.assertEqual(self.page.evaluate('projectStore.past.length'), before+1)
            self.assertNotEqual(self.page.evaluate('projectStore.state.video.keyframes.zoom[0][2]'), descriptor)
            self.page.locator('#undoBtn').click()
            self.assertEqual(self.page.evaluate('projectStore.state.video.keyframes.zoom[0][2]'), descriptor)
            handle.focus()
            self.page.keyboard.press('ArrowRight')
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.video.keyframes.zoom[0][2].control[0]'), .81)
            self.page.evaluate('window.selectSidebarTab("main")')
            automation = self.page.locator('#inspect-main .automation-editor')
            automation.locator(':scope > summary').click()
            automation.locator('.automation-point').select_option('0')
            automation.locator('.segment-curve-type').select_option('smooth')
            automation.locator('.automation-point').select_option('1')
            automation.locator('.segment-curve-type').select_option('hold')
            self.page.evaluate('audioEngine.seekProjectTime(.75)')
            before_values = self.page.evaluate('Array.from({length:31},(_,i)=>automationValue(projectStore.state.tracks.main.automation.volume,i/10,0))')
            automation.locator('.automation-add').click()
            self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.automation.volume.length'), 4)
            after_values = self.page.evaluate('Array.from({length:31},(_,i)=>automationValue(projectStore.state.tracks.main.automation.volume,i/10,0))')
            for before_value, after_value in zip(before_values, after_values):
                self.assertAlmostEqual(before_value, after_value)
            automation.locator('.automation-time').fill('0.8')
            automation.locator('.automation-time').dispatch_event('change')
            self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.automation.volume[1][2].type'), 'smooth')
            saved = self.page.evaluate('JSON.parse(JSON.stringify(projectStore.state))')
            self.page.evaluate('p=>openStudioProject(p,{checkpoint:false})', saved)
            self.assertEqual(self.page.evaluate('projectStore.state.video.keyframes'), saved['video']['keyframes'])
            self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.automation'), saved['tracks']['main']['automation'])

    def test_video_keyframes_inspector_units_precision_and_reopen(self):
        import media_assets
        with patch.object(media_assets, 'ASSET_DIR', Path(self.temporary.name) / 'keyframe-assets'):
            self.load_keyframe_media()
            self.page.locator('[data-keyframe-key="zoom"]').click()
            self.page.evaluate('audioEngine.seekProjectTime(1)')
            self.page.locator('#video-zoom').fill('1.6')
            self.page.locator('#video-zoom').dispatch_event('change')
            self.assertEqual(self.page.evaluate('projectStore.state.video.keyframes.zoom'), [[0, 1], [1, 1.6]])
            self.page.locator('#video-zoom').press('Tab')
            self.page.evaluate('audioEngine.seekProjectTime(.5)')
            self.assertEqual(self.page.locator('#video-zoom').input_value(), '1.3')
            self.page.locator('.keyframe-next').click()
            self.assertAlmostEqual(self.page.evaluate('audioEngine.getProjectTime()'), 1)
            self.page.locator('.keyframe-prev').click()
            self.assertAlmostEqual(self.page.evaluate('audioEngine.getProjectTime()'), 0)
            self.page.locator('.keyframe-next').click()
            group = self.page.locator('.keyframe-time').locator('..')
            group.locator('select').select_option('frames')
            frames = group.locator('input').nth(1)
            frames.fill('45')
            frames.dispatch_event('change')
            self.assertEqual(self.page.evaluate('projectStore.state.video.keyframes.zoom[1][0]'), 1.5)
            self.page.locator('.precision-parameter').select_option('zoom')
            self.page.locator('.precision-value').fill('180')
            self.page.locator('.precision-value').dispatch_event('change')
            self.assertEqual(self.page.evaluate('projectStore.state.video.keyframes.zoom[1][1]'), 1.8)
            self.page.evaluate('audioEngine.seekProjectTime(0)')
            self.page.locator('[data-keyframe-key="opacity"]').click()
            self.page.evaluate('audioEngine.seekProjectTime(1)')
            self.page.locator('.keyframe-value').fill('0')
            self.page.locator('.keyframe-value').dispatch_event('change')
            self.assertEqual(self.page.evaluate('projectStore.state.video.keyframes.opacity'), [[0, 100], [1, 0]])
            self.assertTrue(self.page.evaluate('''() => {videoPreview.draw();const c=document.getElementById('previewCanvas');
              return c.getContext('2d').getImageData(0,0,c.width,c.height).data.every((v,i)=>i%4===3||v===0);}'''))
            saved = self.page.evaluate('JSON.parse(JSON.stringify(projectStore.state))')
            self.page.evaluate('p=>openStudioProject(p)', saved)
            self.assertEqual(self.page.evaluate('projectStore.state.video.keyframes'), saved['video']['keyframes'])
            self.page.evaluate('audioEngine.seekProjectTime(.5)')
            self.page.locator('.keyframe-clear').click()
            self.assertEqual(self.page.evaluate('projectStore.state.video.opacity'), 50)
            self.assertFalse(self.page.evaluate('!!projectStore.state.video.keyframes.opacity'))
            self.page.locator('#undoBtn').click()
            self.assertEqual(self.page.evaluate('projectStore.state.video.keyframes.opacity'), [[0, 100], [1, 0]])
            self.assertEqual(self.page.locator('label button.keyframe-field-toggle').count(), 0)

    def test_video_keyframe_lane_drag_cancel_keyboard_and_collision(self):
        import media_assets
        with patch.object(media_assets, 'ASSET_DIR', Path(self.temporary.name) / 'keyframe-lane-assets'):
            self.load_keyframe_media()
            self.page.evaluate('projectStore.update(p=>{p.video.keyframes.translateX=[[.5,0],[2,30]]})')
            lane = self.page.locator('.keyframe-lane')
            lane.scroll_into_view_if_needed()
            diamond = lane.locator('[data-key-time="0.5"]')
            bounds, key = lane.bounding_box(), diamond.bounding_box()
            before = self.page.evaluate('projectStore.past.length')
            self.page.mouse.move(key['x']+key['width']/2, key['y']+key['height']/2)
            self.page.mouse.down()
            self.page.mouse.move(key['x']+key['width']/2+bounds['width']/6, key['y']+key['height']/2, steps=5)
            self.page.keyboard.press('Escape')
            self.page.mouse.up()
            self.assertEqual(self.page.evaluate('projectStore.state.video.keyframes.translateX[0][0]'), .5)
            self.assertEqual(self.page.evaluate('projectStore.past.length'), before)
            key = diamond.bounding_box()
            self.page.mouse.move(key['x']+key['width']/2, key['y']+key['height']/2)
            self.page.mouse.down()
            self.page.mouse.move(key['x']+key['width']/2+bounds['width']/6, key['y']+key['height']/2, steps=5)
            self.page.mouse.up()
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.video.keyframes.translateX[0][0]'), 1, places=3)
            self.assertEqual(self.page.evaluate('projectStore.past.length'), before+1)
            self.page.locator('#undoBtn').click()
            lane.locator('[data-key-time="0.5"]').focus()
            self.page.keyboard.press('ArrowRight')
            self.page.keyboard.press('ArrowRight')
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.video.keyframes.translateX[0][0]'), .5+2/30)
            self.assertTrue(self.page.locator('.keyframe-time').is_enabled(), self.page.evaluate('({time:audioEngine.getProjectTime(),points:videoKeyframeEditor.points,current:videoKeyframeEditor.current(),parameter:videoKeyframeEditor.parameter.value})'))
            self.page.locator('.keyframe-time').fill('2')
            self.page.locator('.keyframe-time').dispatch_event('change')
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.video.keyframes.translateX[0][0]'), .5+2/30)
            lane.locator('.keyframe-diamond').first.focus()
            self.page.keyboard.press('Delete')
            self.assertEqual(self.page.evaluate('projectStore.state.video.keyframes.translateX'), [[2, 30]])
            self.page.set_viewport_size({'width':320,'height':900})
            self.assertGreaterEqual(self.page.locator('.tracks-container').bounding_box()['height'], 192)
            self.assertGreaterEqual(self.page.locator('.keyframe-lane').bounding_box()['height'], 32)

    def test_video_keyframes_canvas_edit_and_cancel_retain_curves(self):
        import media_assets
        with patch.object(media_assets, 'ASSET_DIR', Path(self.temporary.name) / 'keyframe-canvas-assets'):
            self.load_keyframe_media()
            self.page.evaluate('''projectStore.update(p=>{p.video.zoom=.7;p.video.fit='contain';
                p.video.keyframes.translateX=[[0,0],[2,20]]});audioEngine.seekProjectTime(1);''')
            root = self.page.locator('.canvas-editor')
            root.scroll_into_view_if_needed()
            bounds = root.bounding_box()
            x, y = bounds['x']+bounds['width']/2, bounds['y']+bounds['height']/2
            before = self.page.evaluate('projectStore.past.length')
            self.page.mouse.move(x, y)
            self.page.mouse.down()
            self.page.mouse.move(x+bounds['width']*.1, y, steps=5)
            self.assertEqual(len(self.page.evaluate('projectStore.state.video.keyframes.translateX')), 3)
            self.page.keyboard.press('Escape')
            self.page.mouse.up()
            self.assertEqual(self.page.evaluate('projectStore.state.video.keyframes.translateX'), [[0, 0], [2, 20]])
            self.assertEqual(self.page.evaluate('projectStore.past.length'), before)
            self.page.mouse.move(x, y)
            self.page.mouse.down()
            self.page.mouse.move(x+bounds['width']*.1, y, steps=5)
            self.page.mouse.up()
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.video.keyframes.translateX[1][1]'), 20, delta=.5)
            self.assertEqual(self.page.evaluate('projectStore.past.length'), before+1)
            self.assertEqual(self.page.evaluate('projectStore.state.video.translateX'), 0)
            self.page.locator('#undoBtn').click()
            self.page.mouse.move(x, y)
            self.page.mouse.down()
            self.page.mouse.move(x+bounds['width']*.1, y, steps=5)
            self.page.evaluate('audioEngine.seekProjectTime(.5)')
            self.page.mouse.up()
            self.assertEqual(self.page.evaluate('projectStore.state.video.keyframes.translateX'), [[0, 0], [2, 20]])

    def test_canvas_transform_drag_scale_cancel_and_keyboard(self):
        from PIL import Image
        import media_assets
        media = Path(self.temporary.name) / 'tuval-denemesi.gif'
        Image.new('RGB', (64, 32), '#627255').save(media, save_all=True,
            append_images=[Image.new('RGB', (64, 32), '#a08060')], duration=500, loop=0)
        self.load_audio()
        with patch.object(media_assets, 'ASSET_DIR', Path(self.temporary.name) / 'transform-assets'):
            self.page.locator('#backgroundUpload').set_input_files(str(media))
            wait_for_browser(self.page, 'videoPreview.ready && !videoPreview.busy')
            self.page.evaluate('window.selectSidebarTab("video");projectStore.update(p=>{p.video.fit="contain";p.video.zoom=.7})')
            root = self.page.locator('.canvas-editor')
            self.assertTrue(root.is_visible())
            bounds = root.bounding_box()
            before = self.page.evaluate('projectStore.past.length')
            self.page.mouse.move(bounds['x']+bounds['width']/2, bounds['y']+bounds['height']/2)
            self.page.mouse.down()
            self.page.mouse.move(bounds['x']+bounds['width']*.6, bounds['y']+bounds['height']*.6, steps=8)
            self.page.mouse.up()
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.video.translateX'), 10, delta=.5)
            self.assertEqual(self.page.evaluate('projectStore.past.length'), before+1)
            self.page.locator('#undoBtn').click()
            self.assertEqual(self.page.evaluate('projectStore.state.video.translateX'), 0)
            handle = self.page.locator('[data-transform-handle="se"]')
            box = handle.bounding_box()
            self.page.mouse.move(box['x']+box['width']/2, box['y']+box['height']/2)
            self.page.mouse.down()
            self.page.mouse.move(box['x']+45, box['y']+30, steps=8)
            self.page.mouse.up()
            self.assertGreater(self.page.evaluate('projectStore.state.video.zoom'), .7)
            self.page.locator('#undoBtn').click()
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.video.zoom'), .7)
            box = handle.bounding_box()
            before = self.page.evaluate('projectStore.past.length')
            self.page.mouse.move(box['x']+box['width']/2, box['y']+box['height']/2)
            self.page.mouse.down()
            self.page.mouse.move(box['x']+45, box['y']+30, steps=8)
            self.page.keyboard.press('Escape')
            self.page.mouse.up()
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.video.zoom'), .7)
            self.assertEqual(self.page.evaluate('projectStore.past.length'), before)
            rotate = self.page.locator('[data-transform-handle="rotate"]')
            rotate.focus()
            rotate.press('Shift+ArrowRight')
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.video.rotation'), .1)
            root.focus()
            root.press('ArrowRight')
            self.assertGreater(self.page.evaluate('projectStore.state.video.translateX'), 0)
            self.page.locator('.transform-center').click()
            self.assertEqual(self.page.evaluate('projectStore.state.video.translateX'), 0)
            self.page.set_viewport_size({'width':375,'height':900})
            touch = self.context.new_cdp_session(self.page)
            touch.send('Emulation.setTouchEmulationEnabled', {'enabled':True,'maxTouchPoints':1})
            root.scroll_into_view_if_needed()
            bounds = root.bounding_box()
            x, y = bounds['x']+bounds['width']/2, bounds['y']+bounds['height']/2
            touch.send('Input.dispatchTouchEvent', {'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
            touch.send('Input.dispatchTouchEvent', {'type':'touchMove','touchPoints':[{'x':x+20,'y':y+10}]})
            touch.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
            self.assertGreater(self.page.evaluate('projectStore.state.video.translateX'), 1)
            self.page.locator('#previewCanvas').dblclick()
            self.assertEqual(self.page.evaluate('projectStore.state.video.translateX'), 0)
            self.assertEqual(self.page.evaluate('projectStore.state.video.zoom'), 1)

    def test_canvas_crop_handles_aspect_guides_and_small_screens(self):
        from PIL import Image
        import media_assets
        media = Path(self.temporary.name) / 'kirpma-denemesi.gif'
        Image.new('RGB', (64, 32), '#627255').save(media, save_all=True,
            append_images=[Image.new('RGB', (64, 32), '#a08060')], duration=500, loop=0)
        self.load_audio()
        with patch.object(media_assets, 'ASSET_DIR', Path(self.temporary.name) / 'crop-assets'):
            self.page.locator('#backgroundUpload').set_input_files(str(media))
            wait_for_browser(self.page, 'videoPreview.ready && !videoPreview.busy')
            self.page.evaluate('window.selectSidebarTab("video")')
            original = self.page.locator('#previewCanvas').evaluate('(c)=>c.toDataURL()')
            self.page.locator('.transform-guides').select_option('all')
            self.assertEqual(self.page.locator('#previewCanvas').evaluate('(c)=>c.toDataURL()'), original)
            self.assertEqual(self.page.locator('.canvas-editor .safe-guide').count(), 2)
            self.page.locator('.crop-mode').click()
            self.assertTrue(self.page.locator('.crop-source').is_visible())
            handle = self.page.locator('[data-transform-handle="nw"]')
            box = handle.bounding_box()
            self.page.mouse.move(box['x']+box['width']/2+2, box['y']+box['height']/2+2)
            self.page.mouse.down()
            self.page.mouse.move(box['x']+60, box['y']+35, steps=8)
            self.page.mouse.up()
            self.assertGreater(self.page.evaluate('projectStore.state.video.cropLeft'), 0)
            self.assertGreater(self.page.evaluate('projectStore.state.video.cropTop'), 0)
            self.page.locator('.crop-ratio').select_option('1:1')
            ratio = self.page.evaluate('''() => {const c=videoCrop(videoPreview.info,projectStore.state.video);return c.width/c.height}''')
            self.assertAlmostEqual(ratio, 1)
            self.assertFalse(self.page.locator('[data-transform-handle="e"]').is_visible())
            handle.focus()
            handle.press('ArrowRight')
            ratio = self.page.evaluate('''() => {const c=videoCrop(videoPreview.info,projectStore.state.video);return c.width/c.height}''')
            self.assertAlmostEqual(ratio, 1)
            for width in [320, 375, 768, 1024, 1440]:
                self.page.set_viewport_size({'width':width,'height':900})
                self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.page.locator('.crop-reset').click()
            self.assertEqual(self.page.evaluate('VIDEO_CROP_KEYS.map(k=>projectStore.state.video[k])'), [0,0,0,0])
            self.page.locator('.transform-mode').click()
            self.assertFalse(self.page.locator('.crop-source').is_visible())

    def test_visual_video_split_trim_gap_and_library(self):
        from PIL import Image
        import media_assets
        media = Path(self.temporary.name) / 'montaj-denemesi.gif'
        Image.new('RGB', (64, 64), '#627255').save(media, save_all=True,
            append_images=[Image.new('RGB', (64, 64), '#a08060')], duration=500, loop=0)
        self.load_audio()
        with patch.object(media_assets, 'ASSET_DIR', Path(self.temporary.name) / 'editing-assets'):
            self.page.locator('#backgroundUpload').set_input_files(str(media))
            wait_for_browser(self.page, 'videoPreview.ready && !videoPreview.busy')
            self.page.evaluate('projectStore.update(p=>{p.video.linkSpeed=false});window.selectSidebarTab("video");mediaLibrary.panel.open=true;mediaLibrary.refresh()')
            self.page.locator('.library-filter').select_option('video')
            self.page.locator('.library-search').fill('montaj-denemesi')
            wait_for_browser(self.page, 'document.querySelectorAll(".library-item").length===1')
            self.page.locator('.library-item button').click()
            wait_for_browser(self.page, 'projectStore.state.videoClips.length===2 && videoPreview.ready')
            self.assertEqual(self.page.locator('.track-video .clip-block').count(), 2)
            first = self.page.evaluate('projectStore.state.videoClips[0].id')
            self.page.evaluate('id=>{videoClipEditor.select(id);window.seekProjectTime(.5)}', first)
            self.page.locator('.clip-actions [data-operation="split"]').click()
            wait_for_browser(self.page, 'projectStore.state.videoClips.length===3 && videoPreview.ready')
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[1].start'), .5)
            self.page.locator('.clip-end').fill('0.1')
            self.page.locator('.clip-end').press('Tab')
            self.assertEqual(float(self.page.locator('.clip-end').input_value()), 1)
            self.page.evaluate('id=>videoClipEditor.select(id)', first)
            handle = self.page.locator(f'.clip-block[data-clip="{first}"] .trimEnd')
            handle.scroll_into_view_if_needed()
            box = handle.bounding_box()
            self.page.mouse.move(box['x']+box['width']/2, box['y']+box['height']/2)
            self.page.mouse.down()
            self.page.mouse.move(box['x']-25, box['y']+box['height']/2, steps=8)
            self.page.mouse.up()
            self.assertLess(self.page.evaluate('projectStore.state.videoClips[0].end'), .5)
            self.page.locator('#undoBtn').click()
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[0].end'), .5)
            self.page.evaluate('id=>videoClipEditor.select(id)', first)
            self.page.locator('.clip-actions [data-operation="delete"]').click()
            wait_for_browser(self.page, 'projectStore.state.videoClips.length===2 && videoPreview.ready')
            self.assertEqual(self.page.evaluate('clipFrame(projectStore.state,videoClipEditor.timeline(),.25).index'), None)
            # Extending the earlier clip would overlap its successor. Exercise
            # source precision on the final clip, which has room to change length.
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips.at(-1).id)')
            self.page.locator('.precision-parameter').select_option('start')
            self.page.locator('.precision-unit').select_option('frames')
            selected = self.page.evaluate('videoClipEditor.selected')
            global_start = self.page.evaluate('projectStore.state.video.start')
            self.page.locator('.precision-value').fill('3')
            self.page.locator('.precision-value').press('Tab')
            fps = self.page.evaluate('Number(projectStore.state.output.fps)')
            self.assertAlmostEqual(self.page.evaluate('id=>projectStore.state.videoClips.find(clip=>clip.id===id).start', selected), 3/fps)
            self.assertEqual(self.page.evaluate('projectStore.state.video.start'), global_start)
            self.page.locator('#backgroundUpload').set_input_files(str(media))
            wait_for_browser(self.page, 'projectStore.state.videoClips.length===3 && videoPreview.ready && !videoPreview.busy')
            self.page.locator('.clip-copy').click()
            self.page.evaluate('window.seekProjectTime(0)')
            self.page.locator('.clip-paste').click()
            wait_for_browser(self.page, 'projectStore.state.videoClips.length===4 && videoPreview.ready')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].offset'), 0)
            self.page.locator('#undoBtn').click()
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips.length'), 3)
            self.page.locator('.precision-parameter').select_option('rotation')
            self.page.locator('.precision-value').fill('37.5')
            self.page.locator('.precision-value').press('Tab')
            self.page.locator('#video-mirrorX').check()
            self.assertEqual(self.page.evaluate('projectStore.state.video.rotation'), 37.5)
            self.assertTrue(self.page.evaluate('projectStore.state.video.mirrorX'))


    def test_rhythm_video_transition_and_clip_drag_actual_grid_times(self):
        from PIL import Image
        import media_assets
        media = Path(self.temporary.name) / 'ritim-video.gif'
        Image.new('RGB',(64,64),'#627255').save(media,save_all=True,
            append_images=[Image.new('RGB',(64,64),'#a08060')],duration=1000,loop=0)
        self.load_audio()
        with patch.object(media_assets,'ASSET_DIR',Path(self.temporary.name)/'rhythm-assets'):
            self.page.locator('#backgroundUpload').set_input_files(str(media))
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')
            self.page.evaluate('mediaLibrary.addVideo(projectStore.state.background.asset)')
            wait_for_browser(self.page,'projectStore.state.videoClips.length===2 && videoPreview.ready')
            self.page.evaluate('''projectStore.update(p=>{p.effects.speed=1;p.video.linkSpeed=false;
              p.videoClips[0].offset=0;const clip=p.videoClips[1];clip.id='rhythm-second';clip.offset=1.65;clip.transitionDuration=1;
              Object.assign(p.rhythm,{bpm:120,offset:.1,visible:true,snap:true});});videoClipEditor.select('rhythm-second');''')
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')
            history = self.page.evaluate('projectStore.past.length')
            self.page.locator('.clip-align-transition').click()
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[1].offset'),1.6)
            self.assertAlmostEqual(self.page.evaluate('videoClipEditor.timeline()[1].transition'),.4)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)

            self.page.evaluate('projectStore.undo()')
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[1].offset'),1.65)
            body = self.page.locator('.clip-block[data-clip="rhythm-second"] .clip-body')
            body.scroll_into_view_if_needed(); box=body.bounding_box()
            lane = self.page.locator('.video-edit-lane').bounding_box()
            span = self.page.evaluate('timelineView.span')
            x=box['x']+min(box['width']/2,30);y=box['y']+box['height']/2
            self.page.mouse.move(x,y);self.page.mouse.down()
            self.page.mouse.move(x+(.455/span)*lane['width'],y,steps=6);self.page.mouse.up()
            # Video commits are quantized to the nearest output frame.
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[1].offset'),round(2.1*24)/24)

    def test_rhythm_shared_controls_tap_grid_automation_undo_and_reopen(self):
        self.load_audio()
        self.page.evaluate('projectStore.update(p=>{p.effects.speed=1;})')
        panel = self.page.locator('.rhythm-editor')
        panel.locator('summary').click()
        for key, value in [('bpm', '127.5'), ('offset', '.17'), ('beatsPerBar', '7')]:
            panel.locator('.rhythm-'+key).fill(value)
            panel.locator('.rhythm-'+key).press('Tab')
        panel.locator('.rhythm-division').select_option('3')
        panel.locator('.rhythm-visible').check()
        panel.locator('.rhythm-snap').check()
        rhythm = self.page.evaluate('copyProject(projectStore.state.rhythm)')
        self.assertEqual(rhythm, dict(bpm=127.5, offset=.17, beatsPerBar=7, division='3', visible=True, snap=True))
        self.assertTrue(self.page.locator('.timeline').evaluate("el=>el.classList.contains('rhythm-grid-visible')"))
        self.page.evaluate('timelineView.set(4,.5)')
        self.assertTrue(self.page.locator('.rhythm-ruler span').count())
        panel.locator('.rhythm-bpm').fill('19'); panel.locator('.rhythm-bpm').press('Tab')
        self.assertEqual(panel.locator('.rhythm-bpm').input_value(), '127.5')
        before = self.page.evaluate('projectStore.past.length')
        self.page.evaluate('rhythmEditor.taps=[];[10,10.5,11,11.5].forEach(t=>rhythmEditor.tap(t))')
        self.assertEqual(self.page.evaluate('projectStore.past.length'), before)
        panel.locator('.rhythm-tap-apply').click()
        self.assertEqual(self.page.evaluate('projectStore.state.rhythm.bpm'), 120)
        self.assertEqual(self.page.evaluate('projectStore.past.length'), before+1)
        self.page.evaluate('projectStore.undo()')
        self.assertEqual(self.page.evaluate('projectStore.state.rhythm'), rhythm)
        self.page.evaluate('rhythmEditor.tap(20)')
        self.assertTrue(panel.locator('.rhythm-tap-apply').is_disabled())
        self.page.evaluate('timelineView.set(1,0)')
        editor = self.page.locator('#inspect-main .automation-editor')
        editor.locator(':scope > summary').click()
        editor.locator('.automation-view-settings summary').click()
        editor.locator('.automation-snap').select_option('beat')
        self.assertEqual(editor.locator('.automation-bpm').input_value(), '127.5')
        self.assertEqual(editor.locator('.automation-division').input_value(), '3')
        self.assertAlmostEqual(self.page.evaluate('AutomationEditors.main.tools.snap(.34)'), .17+60/127.5/3, places=6)
        editor.locator('.automation-bpm').fill('123'); editor.locator('.automation-bpm').press('Tab')
        self.assertEqual(panel.locator('.rhythm-bpm').input_value(), '123')
        saved = self.page.evaluate('projectStore.snapshot()')
        self.page.evaluate('p=>openStudioProject(p,{checkpoint:false})', saved)
        self.assertEqual(self.page.evaluate('projectStore.state.rhythm'), saved['rhythm'])
        for width in [320,375,768,1024,1440]:
            for theme in ['light','dark']:
                self.page.set_viewport_size({'width':width,'height':900}); self.page.emulate_media(color_scheme=theme)
                self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
                self.assertTrue(panel.evaluate('(el)=>el.scrollWidth<=el.clientWidth'))

    def test_rhythm_worker_tempo_suggestion_trim_speed_apply_and_cancel(self):
        audio = Path(self.temporary.name) / 'ritim-120-bpm.wav'
        sample_rate = 8000
        with wave.open(str(audio), 'wb') as out:
            out.setnchannels(1); out.setsampwidth(2); out.setframerate(sample_rate)
            def sample(index):
                phase = (index/sample_rate-.17) % .5
                return int(15000*math.exp(-phase*60)*math.sin(2*math.pi*220*index/sample_rate)) if phase<.06 else 0
            out.writeframes(b''.join(struct.pack('<h',sample(i)) for i in range(sample_rate*16)))
        self.page.locator('#mainUpload').set_input_files(str(audio))
        wait_for_browser(self.page, '!!audioEngine.files.main')
        self.page.evaluate('projectStore.update(p=>{p.effects.speed=1.25;p.tracks.main.start=1;p.tracks.main.end=15;p.tracks.main.fadeIn=0;p.mainClips=[{id:"test",start:1,end:15,offset:0}];})')
        wait_for_browser(self.page, '!audioEngine.mainMontage.pending')
        panel = self.page.locator('.rhythm-editor'); panel.locator('summary').click()
        before = self.page.evaluate('copyProject(projectStore.state.rhythm)')
        panel.locator('.rhythm-analyze').click()
        wait_for_browser(self.page, 'document.querySelectorAll(".rhythm-suggestions button").length>0')
        self.assertEqual(self.page.evaluate('projectStore.state.rhythm'), before)
        candidates = panel.locator('.rhythm-suggestions button').all_text_contents()
        self.assertTrue(any(abs(float(label.split(' ')[0])-150)<1 for label in candidates), candidates)
        button = next(panel.locator('.rhythm-suggestions button').nth(i) for i,label in enumerate(candidates) if abs(float(label.split(' ')[0])-150)<1)
        history = self.page.evaluate('projectStore.past.length')
        button.click()
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.rhythm.bpm'), 150, delta=1)
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.rhythm.offset'), .136, delta=.025)
        self.assertEqual(self.page.evaluate('projectStore.past.length'), history+1)
        self.page.evaluate('projectStore.undo()')
        self.assertEqual(self.page.evaluate('projectStore.state.rhythm'), before)
        # Start then cancel before extraction has completed; stale workers cannot apply results.
        self.page.evaluate('rhythmEditor.analyze();rhythmEditor.cancel();rhythmEditor.status("İptal edildi.")')
        self.assertEqual(panel.locator('.rhythm-suggestions button').count(), 0)
        self.assertIsNone(self.page.evaluate('rhythmEditor.worker'))
        self.page.evaluate('audioEngine.seekProjectTime(projectDuration(projectStore.state)-2)')
        panel.locator('.rhythm-analyze').click()
        self.assertIn('en az 4 saniye', panel.locator('.rhythm-status').inner_text())

    def test_rhythm_main_drag_and_added_layer_alignment_preserve_curves(self):
        self.load_audio()
        self.page.evaluate('''projectStore.update(p=>{p.effects.speed=1;p.mainClips=[{id:'a',start:0,end:.5,offset:0},{id:'b',start:1,end:2,offset:1}];
          Object.assign(p.rhythm,{bpm:120,offset:.1,visible:true,snap:true});});''')
        wait_for_browser(self.page, '!audioEngine.mainMontage.pending')
        body = self.page.locator('[data-main-clip="b"] .clip-body')
        body.scroll_into_view_if_needed(); box=body.bounding_box()
        lane = self.page.locator('.main-edit-lane').bounding_box()
        span = self.page.evaluate('timelineView.span')
        self.page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2)
        self.page.mouse.down()
        self.page.mouse.move(box['x']+box['width']/2+(.105/span)*lane['width'],box['y']+box['height']/2,steps=6)
        self.page.mouse.up()
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.mainClips[1].offset'),1.1)
        self.page.evaluate('projectStore.undo()')
        self.assertEqual(self.page.evaluate('projectStore.state.mainClips[1].offset'),1)
        self.page.evaluate('''async()=>{projectStore.update(p=>{p.tracks.track_rhythm={...copyProject(p.tracks.rain),offset:.63,until:1.63,
          fadeOffset:.63,fadeEnd:1.63,automation:{volume:[[.63,30],[1.63,70]],pan:[],cutoff:[],reverb:[]}};});
          await audioEngine.loadAudio('track_rhythm',audioEngine.files.main,{preserveHistory:true});
          projectStore.update(p=>{Object.assign(p.tracks.track_rhythm,{until:1.63,fadeOffset:.63,fadeEnd:1.63});});window.selectSidebarTab('track_rhythm');}''')
        history = self.page.evaluate('projectStore.past.length')
        self.page.locator('#inspect-track_rhythm [data-audio-operation="align"]').click()
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.track_rhythm.offset'), .6)
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.track_rhythm.automation.volume[0][0]'), .6)
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.track_rhythm.fadeOffset'), .6)
        self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)


    @contextmanager
    def open_transition_editor(self):
        from PIL import Image
        import media_assets
        media = Path(self.temporary.name) / 'transition-video.gif'
        Image.new('RGB',(64,64),'#526c79').save(media,save_all=True,
            append_images=[Image.new('RGB',(64,64),'#b88352')],duration=1000,loop=0)
        self.load_audio()
        with patch.object(media_assets,'ASSET_DIR',Path(self.temporary.name)/'transition-assets'):
            self.page.locator('#backgroundUpload').set_input_files(str(media))
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')
            self.page.evaluate('mediaLibrary.addVideo(projectStore.state.background.asset)')
            wait_for_browser(self.page,'projectStore.state.videoClips.length===2 && videoPreview.ready')
            self.page.evaluate("""projectStore.update(p=>{p.effects.speed=1;p.video.linkSpeed=false;p.tracks.main.loop=false;
              p.videoClips[0].offset=0;Object.assign(p.videoClips[1],{id:'transition-second',offset:1.5,transitionDuration:.5});
            });videoClipEditor.select('transition-second');videoClipEditor.transitions.panel.open=true;""")
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')
            yield self.page.locator('.transition-editor')

    @contextmanager
    def open_visual_layers(self):
        from PIL import Image
        self.visual_image=Path(self.temporary.name)/'saydam-katman.png'
        Image.new('RGBA',(64,32),(220,50,30,128)).save(self.visual_image)
        with self.open_transition_editor():
            self.page.evaluate('visualLayerEditor.panel.open=true;audioEngine.seekProjectTime(0)')
            self.page.locator('.visual-library').select_option(self.page.evaluate('projectStore.state.background.asset'))
            yield self.page.locator('.visual-layer-editor')

    def test_mask_inspector_animation_polygon_undo_and_project_reopen(self):
        with self.open_transition_editor():
            self.page.evaluate("videoClipEditor.select(projectStore.state.videoClips[0].id);videoClipEditor.mask.panel.open=true;audioEngine.seekProjectTime(0)")
            panel=self.page.locator('.clip-editor .mask-editor')
            panel.locator('.mask-enabled').check()
            panel.locator('.mask-shape').select_option('rectangle')
            panel.locator('.mask-key-add').click()
            self.page.evaluate('audioEngine.seekProjectTime(.5)')
            panel.locator('[data-mask-field=x]').fill('75')
            panel.locator('[data-mask-field=x]').dispatch_event('change')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].mask.keyframes.x'),[[0,50],[.5,75]])
            panel.locator('.mask-key-row select').first.select_option('smooth')
            self.page.evaluate('audioEngine.seekProjectTime(.25)')
            wait_for_browser(self.page,"Number(videoClipEditor.mask.fields.get('x').value)===62.5")
            self.assertAlmostEqual(float(panel.locator('[data-mask-field=x]').input_value()),62.5,places=3)
            panel.locator('.mask-shape').select_option('polygon')
            history=self.page.evaluate('projectStore.past.length')
            panel.locator('.mask-point-add').click()
            self.assertEqual(panel.locator('.mask-point-row').count(),5)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.page.evaluate('projectStore.undo()')
            self.assertEqual(panel.locator('.mask-point-row').count(),4)
            panel.locator('.mask-mode').select_option('blur')
            panel.locator('.mask-invert').check()
            panel.locator('[data-mask-field=feather]').fill('2')
            panel.locator('[data-mask-field=feather]').dispatch_event('change')
            saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())')
            self.page.evaluate('saved=>projectStore.replace(JSON.parse(saved))',saved)
            self.assertTrue(panel.locator('.mask-invert').is_checked())
            self.assertEqual(panel.locator('.mask-mode').input_value(),'blur')
            panel.locator('.mask-key-clear').click()
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].mask.keyframes'),{})
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[0].mask.x'),62.5,places=3)

    def test_mask_canvas_pointer_draft_cancel_keyboard_snapshot_and_layer_locks(self):
        with self.open_visual_layers() as layers:
            layers.locator('.visual-add-text').click()
            self.page.evaluate("visualLayerEditor.mask.panel.open=true")
            panel=self.page.locator('.visual-layer-editor .mask-editor')
            panel.locator('.mask-enabled').check()
            panel.locator('.mask-edit').click()
            self.page.locator('#canvasStage').scroll_into_view_if_needed()
            self.page.evaluate('projectStore.update(p=>p.video.zoom=.73)')
            self.page.locator('.mask-canvas:not([hidden]) .mask-outline').dispatch_event('dblclick')
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.video.zoom'),.73)
            handle=self.page.locator('.mask-canvas:not([hidden]) button[data-mask-handle=move]')
            box=handle.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
            history=self.page.evaluate('projectStore.past.length')
            self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+20,y+10,steps=4)
            self.assertEqual(self.page.evaluate('visualLayerEditor.target().mask.x'),50)
            self.assertTrue(self.page.evaluate('!!videoPreview.maskDraft'))
            self.page.keyboard.press('Escape');self.page.mouse.up()
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            self.assertIsNone(self.page.evaluate('videoPreview.maskDraft'))
            box=handle.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
            self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+20,y,steps=4);self.page.mouse.up()
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            value=self.page.evaluate('visualLayerEditor.target().mask.x');self.assertGreater(value,50)
            handle.press('ArrowRight')
            self.assertGreater(self.page.evaluate('visualLayerEditor.target().mask.x'),value)
            panel.locator('.mask-shape').select_option('polygon')
            self.page.locator('#canvasStage').scroll_into_view_if_needed()
            vertex=self.page.locator('.mask-canvas:not([hidden]) [data-mask-handle="point-0"]')
            vertex.press('Shift+ArrowRight')
            self.assertGreater(self.page.evaluate('visualLayerEditor.target().mask.points[0][0]'),0)
            vertex.press('Delete');self.assertEqual(self.page.evaluate('visualLayerEditor.target().mask.points.length'),3)
            self.page.evaluate("projectStore.update(p=>p.visualLayers[0].locked=true)")
            self.assertTrue(panel.locator('.mask-enabled').is_disabled())
            self.assertEqual(self.page.locator('.mask-canvas:not([hidden])').count(),0)
            self.page.evaluate("projectStore.update(p=>{p.visualLayers[0].locked=false;p.visualLayers[0].offset=1;})")
            self.assertEqual(self.page.locator('.mask-canvas:not([hidden])').count(),0)
            self.page.evaluate('audioEngine.seekProjectTime(1.25)')
            wait_for_browser(self.page,'!visualLayerEditor.mask.canvas.root.hidden')

    def test_mask_pixels_shape_inversion_feather_blur_and_alpha_composition(self):
        self.load_audio()
        result=self.page.evaluate('''() => {
          const canvas=document.createElement('canvas');canvas.width=canvas.height=100;const ctx=canvas.getContext('2d'),renderer=new MaskRenderer();
          ctx.fillStyle='#ff0000';ctx.fillRect(0,0,100,100);
          const mask=validateVisualMask({enabled:true,shape:'rectangle',width:50,height:50});
          const pixel=(source,x,y)=>Array.from(source.getContext('2d').getImageData(x,y,1,1).data);
          let image=renderer.apply(canvas,mask,0),inside=pixel(image,50,50),outside=pixel(image,10,10);
          image=renderer.apply(canvas,{...mask,invert:true},0);const inverseInside=pixel(image,50,50),inverseOutside=pixel(image,10,10);
          image=renderer.apply(canvas,{...mask,shape:'ellipse'},0);const ellipseCorner=pixel(image,26,26),ellipseCenter=pixel(image,50,50);
          image=renderer.apply(canvas,{...mask,shape:'polygon',points:[[0,0],[100,0],[50,100]]},0);const triangleBottom=pixel(image,28,70),triangleCenter=pixel(image,50,45);
          image=renderer.apply(canvas,{...mask,feather:8},0);const soft=pixel(image,25,50),softOutside=pixel(image,20,50);
          ctx.fillStyle='#00ff00';ctx.fillRect(50,0,50,100);
          image=renderer.apply(canvas,{...mask,mode:'blur',blur:10},0);const blur=pixel(image,49,50),untouched=pixel(image,49,10);
          ctx.clearRect(0,0,100,100);ctx.fillStyle='rgba(255,0,0,.5)';ctx.fillRect(0,0,100,100);
          image=renderer.apply(canvas,{...mask,mode:'blur',blur:10,feather:8},0);const alpha=pixel(image,25,50);
          ctx.clearRect(0,0,100,100);ctx.fillStyle='#ff0000';ctx.fillRect(0,0,100,100);
          const output=document.createElement('canvas');output.width=output.height=100;const mixed=output.getContext('2d');mixed.fillStyle='#0000ff';mixed.fillRect(0,0,100,100);
          const project=validateProject({version:1,tracks:{main:{source:{name:'audio',size:1,lastModified:0,duration:3}}},
            visualLayers:[{id:'red',type:'image',asset:'a'.repeat(64),width:100,opacity:50,mask:{enabled:true,shape:'rectangle',width:50,height:50}}]});
          new VisualLayerRenderer().draw(mixed,project,0,new Map([['red',{source:canvas}]]));
          const combinedInside=pixel(output,50,50),combinedOutside=pixel(output,10,10);
          return {inside,outside,inverseInside,inverseOutside,ellipseCorner,ellipseCenter,triangleBottom,triangleCenter,soft,softOutside,blur,untouched,alpha,combinedInside,combinedOutside};
        }''')
        self.assertEqual(result['inside'],[255,0,0,255]);self.assertEqual(result['outside'][3],0)
        self.assertEqual(result['inverseInside'][3],0);self.assertEqual(result['inverseOutside'],[255,0,0,255])
        self.assertEqual(result['ellipseCorner'][3],0);self.assertEqual(result['ellipseCenter'][3],255)
        self.assertEqual(result['triangleBottom'][3],0);self.assertEqual(result['triangleCenter'][3],255)
        self.assertTrue(50<result['soft'][3]<220);self.assertTrue(0<result['softOutside'][3]<result['soft'][3])
        self.assertTrue(40<result['blur'][1]<180);self.assertEqual(result['untouched'],[255,0,0,255])
        self.assertAlmostEqual(result['alpha'][3],128,delta=2);self.assertEqual(result['alpha'][:3],[255,0,0])
        for actual,expected in zip(result['combinedInside'],[128,0,127,255]):self.assertAlmostEqual(actual,expected,delta=1)
        self.assertEqual(result['combinedOutside'],[0,0,255,255])

    @contextmanager
    def open_slip_editor(self):
        with self.open_transition_editor():
            self.page.evaluate("""projectStore.update(p=>{Object.assign(p.videoClips[0],{start:.25,end:.75});
              p.videoClips[1].offset=1.5;p.videoClips[1].transitionDuration=0;});
              videoClipEditor.select(projectStore.state.videoClips[0].id);videoClipEditor.slip.panel.open=true;""")
            wait_for_browser(self.page,"document.querySelector('.slip-status').textContent==='Kaynak kareleri hazır.'")
            yield self.page.locator('.video-slip-editor')
            self.page.evaluate('videoClipEditor.slip.panel.open=false')
            wait_for_browser(self.page,'!videoClipEditor.slip.preview.video')

    def test_slip_draft_comparison_pixels_apply_undo_and_reopen(self):
        with self.open_slip_editor() as panel:
            before=self.page.evaluate('JSON.stringify(projectStore.snapshot())')
            history=self.page.evaluate('projectStore.past.length')
            timing=self.page.evaluate('videoClipEditor.timeline().map(({offset,end,transition})=>({offset,end,transition}))')
            self.page.evaluate('audioEngine.seekProjectTime(.125)')
            panel.locator('.slip-delta').fill('1')
            wait_for_browser(self.page,"document.querySelector('.slip-status').textContent==='Kaynak kareleri hazır.'")
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before)
            self.assertAlmostEqual(self.page.evaluate('audioEngine.getProjectTime()'),.125)
            pixels=self.page.evaluate("[...document.querySelectorAll('.slip-frames canvas')].map(c=>[...c.getContext('2d').getImageData(160,90,1,1).data].slice(0,3))")
            self.assertLess(pixels[0][0],pixels[0][2]);self.assertGreater(pixels[1][0],pixels[1][2])
            self.assertEqual(pixels[0],pixels[2]);self.assertEqual(pixels[1],pixels[3])
            self.page.locator('.video-slip-editor').screenshot(path=str(Path(__file__).resolve().parents[1]/'.local/slip-desktop.png'))
            panel.locator('.slip-apply').click()
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].start'),1.25)
            self.assertEqual(self.page.evaluate('videoClipEditor.timeline().map(({offset,end,transition})=>({offset,end,transition}))'),timing)
            saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())')
            self.page.evaluate('projectStore.undo()')
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before)
            self.page.evaluate('projectStore.redo()')
            self.page.evaluate('value=>projectStore.replace(JSON.parse(value))',saved)
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            wait_for_browser(self.page,"document.querySelector('.slip-status').textContent==='Kaynak kareleri hazır.'")

    def test_slip_bounds_cancel_selection_ramp_freeze_and_responsive_panel(self):
        with self.open_slip_editor() as panel:
            history=self.page.evaluate('projectStore.past.length')
            panel.locator('[data-slip-step="1"]').click()
            self.assertAlmostEqual(float(panel.locator('.slip-delta').input_value()),1/self.page.evaluate('videoClipEditor.slip.item.info.fps'),places=8)
            panel.locator('.slip-delta').press('Escape')
            self.assertEqual(panel.locator('.slip-delta').input_value(),'0')
            panel.locator('.slip-delta').fill('99')
            self.assertTrue(panel.locator('.slip-apply').is_disabled())
            self.assertEqual(panel.locator('.slip-delta').get_attribute('aria-invalid'),'true')
            panel.locator('.slip-reset').click()
            panel.locator('.slip-delta').fill('.5')
            panel.locator('.slip-range').dispatch_event('pointerdown')
            panel.locator('.slip-range').evaluate("e=>{e.value='.75';e.dispatchEvent(new Event('input',{bubbles:true}));}")
            panel.locator('.slip-range').dispatch_event('pointercancel')
            self.assertEqual(panel.locator('.slip-delta').input_value(),'0.5')
            panel.locator('summary').click();panel.locator('summary').click()
            self.assertEqual(panel.locator('.slip-delta').input_value(),'0')
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            self.page.evaluate("""projectStore.update(p=>{p.videoClips[0].timeRemap=validateVideoTimeRemap({reverse:true,
              ramp:[[.25,.75,'smooth'],[.75,1.5,'hold']]});});""")
            timing=self.page.evaluate('videoClipEditor.timeline().map(i=>[i.offset,i.end])')
            panel.locator('.slip-delta').fill('.5');panel.locator('.slip-apply').click()
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].timeRemap.ramp[0][0]'),.75)
            self.assertEqual(self.page.evaluate('videoClipEditor.timeline().map(i=>[i.offset,i.end])'),timing)
            self.page.evaluate("projectStore.update(p=>{p.videoClips[0].timeRemap=validateVideoTimeRemap({freezeAt:1,freezeDuration:1,smoothing:'blend'});})")
            panel.locator('.slip-delta').fill('.125');panel.locator('.slip-apply').click()
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].timeRemap.freezeAt'),1.125)
            panel.locator('.slip-delta').fill('.1')
            self.page.evaluate("videoClipEditor.select('transition-second')")
            self.assertEqual(panel.locator('.slip-delta').input_value(),'0')
            self.assertTrue(panel.locator('.slip-delta').is_disabled())
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id)')
            for width in [320,375,768,1024,1440]:
                self.page.set_viewport_size({'width':width,'height':900})
                self.assertTrue(panel.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'))
                self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.page.set_viewport_size({'width':375,'height':900});self.page.emulate_media(color_scheme='light',reduced_motion='reduce')
            wait_for_browser(self.page,"document.querySelector('.slip-status').textContent==='Kaynak kareleri hazır.'")
            panel.locator('.slip-delta').fill('.125')
            panel.locator('.slip-apply').click()
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].timeRemap.freezeAt'),1.25)
            wait_for_browser(self.page,"document.querySelector('.slip-status').textContent==='Kaynak kareleri hazır.'")
            # A tall viewport lets the artifact show the complete scrollable inspector.
            self.page.set_viewport_size({'width':375,'height':1600})
            panel.screenshot(path=str(Path(__file__).resolve().parents[1]/'.local/slip-mobile.png'))

    def test_slip_preview_failure_retry_latest_draft_and_release(self):
        with self.open_slip_editor() as panel:
            history=self.page.evaluate('projectStore.past.length')
            pattern='**/api/media/*/preview'
            self.page.route(pattern,lambda route:route.fulfill(status=404,body='missing'))
            self.page.evaluate('videoClipEditor.slip.preview.clear();videoClipEditor.slip.draw()')
            wait_for_browser(self.page,"!document.querySelector('.slip-retry').hidden")
            self.assertIn('okunamadı',panel.locator('.slip-status').inner_text())
            self.page.unroute(pattern)
            panel.locator('.slip-retry').click()
            wait_for_browser(self.page,"document.querySelector('.slip-status').textContent==='Kaynak kareleri hazır.'")
            panel.locator('.slip-delta').fill('.25');panel.locator('.slip-delta').fill('1')
            wait_for_browser(self.page,"document.querySelector('.slip-status').textContent==='Kaynak kareleri hazır.'")
            self.assertIn('1.250',panel.locator('figcaption').nth(1).inner_text())
            pixel=panel.locator('canvas').nth(1).evaluate("c=>[...c.getContext('2d').getImageData(160,90,1,1).data]")
            self.assertGreater(pixel[0],pixel[2])
            panel.locator('summary').click()
            self.assertTrue(self.page.evaluate('!videoClipEditor.slip.preview.video && !videoClipEditor.slip.preview.pending'))
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)

    @contextmanager
    def open_slide_editor(self):
        with self.open_transition_editor():
            self.page.evaluate("""projectStore.update(p=>{
              const first=p.videoClips[0];Object.assign(first,{id:'slide-left',start:.25,end:1.25,offset:0,transitionDuration:0});
              Object.assign(p.videoClips[1],{id:'slide-middle',start:.5,end:1,offset:1,transitionDuration:0});
              p.videoClips.push({...copyProject(first),id:'slide-right',start:.5,end:1.5,offset:1.5});
            });videoClipEditor.select('slide-middle');videoClipEditor.slide.panel.open=true;""")
            wait_for_browser(self.page,'projectStore.state.videoClips.length===3 && videoPreview.ready && !videoPreview.busy')
            yield self.page.locator('.video-slide-editor')
            self.page.evaluate('videoClipEditor.slide.panel.open=false')

    def test_slide_draft_neighbors_apply_single_undo_and_reopen(self):
        with self.open_slide_editor() as panel:
            before=self.page.evaluate('JSON.stringify(projectStore.snapshot())')
            history=self.page.evaluate('projectStore.past.length')
            self.page.evaluate('audioEngine.seekProjectTime(.125)')
            panel.locator('.slide-delta').fill('.25')
            panel.locator('.slide-comparison-details > summary').click()
            self.assertEqual(panel.locator('.slide-row').count(),3)
            self.assertIn('1.000–1.500 → 1.250–1.750',panel.locator('.slide-row').nth(1).inner_text())
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            self.assertAlmostEqual(self.page.evaluate('audioEngine.getProjectTime()'),.125)
            panel.locator('.slide-comparison-details > summary').click()
            panel.locator(':scope > summary').scroll_into_view_if_needed()
            panel.screenshot(path=str(Path(__file__).resolve().parents[1]/'.local/slide-desktop.png'))
            panel.locator('.slide-apply').click()
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips.map(c=>[c.start,c.end,c.offset])'),[[.25,1.5,0],[.5,1,1.25],[.75,1.5,1.75]])
            self.assertEqual(self.page.evaluate('videoClipEditor.timeline().at(-1).end'),2.5)
            saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())')
            self.page.evaluate('projectStore.undo()')
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before)
            self.page.evaluate('projectStore.redo()')
            self.page.evaluate('value=>projectStore.replace(JSON.parse(value))',saved)
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')

    def test_slide_steps_rounding_bounds_cancel_selection_lock_and_responsive_controls(self):
        with self.open_slide_editor() as panel:
            history=self.page.evaluate('projectStore.past.length')
            panel.locator('[data-slide-step="1"]').click()
            self.assertAlmostEqual(float(panel.locator('.slide-delta').input_value()),1/24,places=8)
            panel.locator('.slide-delta').fill('.1')
            self.assertAlmostEqual(self.page.evaluate('videoClipEditor.slide.delta'),2/24)
            panel.locator('.slide-delta').press('Escape')
            self.assertEqual(panel.locator('.slide-delta').input_value(),'0')
            panel.locator('.slide-delta').fill('99')
            self.assertTrue(panel.locator('.slide-apply').is_disabled())
            self.assertEqual(panel.locator('.slide-delta').get_attribute('aria-invalid'),'true')
            panel.locator('.slide-reset').click()
            panel.locator('.slide-delta').fill('.25')
            panel.locator('.slide-range').dispatch_event('pointerdown')
            panel.locator('.slide-range').evaluate("e=>{e.value='.5';e.dispatchEvent(new Event('input',{bubbles:true}));}")
            panel.locator('.slide-range').dispatch_event('pointercancel')
            self.assertEqual(panel.locator('.slide-delta').input_value(),'0.25')
            panel.locator(':scope > summary').click();panel.locator(':scope > summary').click()
            self.assertEqual(panel.locator('.slide-delta').input_value(),'0')
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            self.page.evaluate("videoClipEditor.select('slide-left')")
            self.assertTrue(panel.locator('.slide-delta').is_disabled())
            self.assertIn('iki yanında',panel.locator('.slide-status').inner_text())
            self.page.evaluate("videoClipEditor.select('slide-middle');projectStore.update(p=>{p.video.groupLocked=true;})")
            self.assertTrue(panel.locator('.slide-delta').is_disabled())
            self.assertIn('kilidini',panel.locator('.slide-status').inner_text())
            self.page.evaluate('projectStore.update(p=>{p.video.groupLocked=false;})')
            self.page.evaluate("projectStore.update(p=>{p.videoClips[0].name='Uzun video adı '.repeat(20);})")
            panel.locator('.slide-comparison-details > summary').click()
            for scheme in ['dark','light']:
                self.page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size({'width':width,'height':900})
                    self.assertTrue(panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1'))
                    self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            panel.locator('.slide-comparison-details > summary').click()
            self.page.set_viewport_size({'width':375,'height':900})
            panel.locator('[data-slide-step="1"]').click();panel.locator('.slide-apply').click()
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[1].offset'),1+1/24)
            self.page.set_viewport_size({'width':375,'height':1600})
            panel.screenshot(path=str(Path(__file__).resolve().parents[1]/'.local/slide-mobile.png'))

    def test_slide_overlaps_reverse_ramp_and_frozen_neighbors_keep_outer_clock(self):
        with self.open_slide_editor() as panel:
            self.page.evaluate("""projectStore.update(p=>{
              for(const index of [0,2])p.videoClips[index].timeRemap=validateVideoTimeRemap({reverse:true,ramp:[[0,.75,'smooth'],[2,1.5,'hold']]});
              p.videoClips[1].offset=null;p.videoClips[2].offset=null;
              p.videoClips[1].transitionDuration=.25;p.videoClips[2].transitionDuration=.25;
            });""")
            before=self.page.evaluate('videoClipEditor.timeline().map(i=>[i.offset,i.end,i.transition])')
            panel.locator('.slide-delta').fill('.125');panel.locator('.slide-apply').click()
            after=self.page.evaluate('videoClipEditor.timeline().map(i=>[i.offset,i.end,i.transition])')
            self.assertEqual(after[0][0],before[0][0]);self.assertEqual(after[2][1],before[2][1])
            self.assertEqual([i[2] for i in after],[i[2] for i in before])
            self.assertAlmostEqual(after[1][0]-before[1][0],.125)
            self.page.evaluate("""projectStore.update(p=>{
              for(const index of [0,2])p.videoClips[index].timeRemap=validateVideoTimeRemap({freezeAt:1,freezeDuration:1});
              p.videoClips[0].start=.25;p.videoClips[0].end=1.5;p.videoClips[2].start=.5;p.videoClips[2].end=1.5;
              p.videoClips[1].offset=null;p.videoClips[2].offset=null;
            });""")
            end=self.page.evaluate('videoClipEditor.timeline().at(-1).end')
            panel.locator('.slide-delta').fill('.25');panel.locator('.slide-apply').click()
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips.filter((c,i)=>i!==1).map(c=>c.timeRemap.freezeDuration)'),[1.25,.75])
            self.assertEqual(self.page.evaluate('videoClipEditor.timeline().at(-1).end'),end)
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')

    @contextmanager
    def open_rolling_editor(self):
        with self.open_transition_editor():
            self.page.evaluate("""projectStore.update(p=>{
              Object.assign(p.videoClips[0],{id:'roll-left',start:0,end:1,offset:0,transitionDuration:0});
              Object.assign(p.videoClips[1],{id:'roll-right',start:1,end:2,offset:1,transitionDuration:0});
            });videoClipEditor.transitions.panel.open=false;videoClipEditor.select('roll-left');videoClipEditor.rolling.panel.open=true;""")
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy && !!document.querySelector(".rolling-handle")')
            yield self.page.locator('.rolling-editor')
            self.page.evaluate('videoClipEditor.rolling.panel.open=false')
            wait_for_browser(self.page,'!videoClipEditor.rolling.preview.video')
            self.page.wait_for_load_state('networkidle')

    def test_rolling_draft_cut_frames_apply_single_undo_and_reopen(self):
        with self.open_rolling_editor() as panel:
            before=self.page.evaluate('JSON.stringify(projectStore.snapshot())');history=self.page.evaluate('projectStore.past.length')
            self.assertTrue(self.page.evaluate('!videoClipEditor.rolling.preview.video'))
            self.page.evaluate('audioEngine.seekProjectTime(.125)')
            panel.locator('.rolling-delta').fill('.25')
            panel.locator('.rolling-comparison > summary').click()
            wait_for_browser(self.page,"document.querySelector('.rolling-frame-status').textContent==='Kaynak kareleri hazır.'")
            pixels=self.page.evaluate("[...document.querySelectorAll('.rolling-frames canvas')].map(c=>[...c.getContext('2d').getImageData(160,90,1,1).data].slice(0,3))")
            self.assertLess(pixels[0][0],pixels[0][2]);self.assertGreater(pixels[1][0],pixels[1][2])
            self.assertEqual(pixels[2],pixels[3]);self.assertEqual(pixels[1],pixels[3])
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            self.assertAlmostEqual(self.page.evaluate('audioEngine.getProjectTime()'),.125)
            panel.locator('.rolling-comparison > summary').click()
            self.assertTrue(self.page.evaluate('!videoClipEditor.rolling.preview.video'))
            panel.locator(':scope > summary').scroll_into_view_if_needed()
            panel.screenshot(path=str(Path(__file__).resolve().parents[1]/'.local/rolling-desktop.png'))
            panel.locator('.rolling-apply').click()
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips.map(c=>[c.start,c.end,c.offset])'),[[0,1.25,0],[1.25,2,1.25]])
            self.assertEqual(self.page.evaluate('videoClipEditor.timeline().at(-1).end'),2)
            saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())')
            self.page.evaluate('projectStore.undo()');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before)
            self.page.evaluate('projectStore.redo()');self.page.evaluate('value=>projectStore.replace(JSON.parse(value))',saved)
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')

    def test_rolling_handle_drag_cancel_keyboard_touch_and_single_undo(self):
        with self.open_rolling_editor() as panel:
            self.page.evaluate('timelineView.focus(0,2)')
            handle=self.page.locator('.rolling-handle');lane=self.page.locator('.video-edit-lane')
            handle.scroll_into_view_if_needed();box=handle.bounding_box();bounds=lane.bounding_box()
            x=box['x']+box['width']/2;y=box['y']+box['height']/2
            dx=bounds['width']*.25/self.page.evaluate('timelineView.span')
            history=self.page.evaluate('projectStore.past.length')
            for cancel in ['escape','pointercancel','blur']:
                self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+dx,y,steps=5)
                self.assertGreater(self.page.evaluate('videoClipEditor.rolling.delta'),0)
                self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].end'),1)
                self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
                if cancel=='escape':self.page.keyboard.press('Escape')
                elif cancel=='pointercancel':handle.dispatch_event('pointercancel')
                else:self.page.evaluate("window.dispatchEvent(new Event('blur'))")
                self.page.mouse.up();self.assertEqual(self.page.evaluate('videoClipEditor.rolling.delta'),0)
                self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+dx,y,steps=5);self.page.mouse.up()
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[0].end'),1.25)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.page.evaluate('projectStore.undo()');handle.focus();handle.press('Shift+ArrowRight')
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[0].end'),1+10/24)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.page.evaluate('projectStore.undo()')
            self.page.set_viewport_size({'width':375,'height':900})
            touch=self.context.new_cdp_session(self.page);touch.send('Emulation.setTouchEmulationEnabled',{'enabled':True,'maxTouchPoints':1})
            handle.scroll_into_view_if_needed();box=handle.bounding_box();bounds=lane.bounding_box()
            x=box['x']+box['width']/2;y=box['y']+box['height']/2
            dx=bounds['width']*.25/self.page.evaluate('timelineView.span')
            for kind,points in [('touchStart',[dict(x=x,y=y)]),('touchMove',[dict(x=x+dx,y=y)]),('touchEnd',[])]:
                touch.send('Input.dispatchTouchEvent',dict(type=kind,touchPoints=points))
            wait_for_browser(self.page,'!videoClipEditor.rolling.drag')
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[0].end'),1.25)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')

    def test_rolling_steps_bounds_edge_selection_gap_lock_and_responsive_controls(self):
        with self.open_rolling_editor() as panel:
            panel.locator('[data-roll-step="1"]').click()
            self.assertAlmostEqual(float(panel.locator('.rolling-delta').input_value()),1/24,places=8)
            panel.locator('.rolling-delta').fill('.1');self.assertAlmostEqual(self.page.evaluate('videoClipEditor.rolling.delta'),2/24)
            panel.locator('.rolling-delta').press('Escape');self.assertEqual(panel.locator('.rolling-delta').input_value(),'0')
            panel.locator('.rolling-delta').fill('99');self.assertTrue(panel.locator('.rolling-apply').is_disabled())
            self.assertEqual(panel.locator('.rolling-delta').get_attribute('aria-invalid'),'true')
            panel.locator('.rolling-reset').click();panel.locator('.rolling-delta').fill('.25')
            panel.locator('.rolling-range').dispatch_event('pointerdown')
            panel.locator('.rolling-range').evaluate("e=>{e.value='.5';e.dispatchEvent(new Event('input',{bubbles:true}));}")
            panel.locator('.rolling-range').dispatch_event('pointercancel')
            self.assertEqual(panel.locator('.rolling-delta').input_value(),'0.25')
            self.page.evaluate("videoClipEditor.select('roll-right')")
            self.assertEqual(panel.locator('.rolling-edge').input_value(),'before');self.assertEqual(panel.locator('.rolling-delta').input_value(),'0')
            self.page.evaluate('projectStore.update(p=>{p.videoClips[1].offset=1.25})')
            self.assertTrue(panel.locator('.rolling-delta').is_disabled());self.assertIn('boşluğu',panel.locator('.rolling-status').inner_text())
            self.page.evaluate('projectStore.update(p=>{p.videoClips[1].offset=1;p.video.groupLocked=true;})')
            self.assertTrue(panel.locator('.rolling-delta').is_disabled());self.assertIn('kilidini',panel.locator('.rolling-status').inner_text())
            self.page.evaluate("projectStore.update(p=>{p.video.groupLocked=false;p.videoClips[0].name='Uzun video adı '.repeat(20);})")
            panel.locator('.rolling-comparison > summary').click()
            wait_for_browser(self.page,"document.querySelector('.rolling-frame-status').textContent==='Kaynak kareleri hazır.'")
            for scheme in ['dark','light']:
                self.page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size({'width':width,'height':900})
                    self.assertTrue(panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1'))
                    self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            panel.locator('.rolling-comparison > summary').click()
            self.page.set_viewport_size({'width':375,'height':900})
            panel.locator('[data-roll-step="1"]').click();panel.locator('.rolling-apply').click()
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[0].end'),1+1/24)
            self.page.set_viewport_size({'width':375,'height':1600})
            panel.screenshot(path=str(Path(__file__).resolve().parents[1]/'.local/rolling-mobile.png'))
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')

    def test_rolling_preview_distinct_assets_retry_latest_and_release(self):
        from PIL import Image
        import media_assets
        import engine
        media=Path(self.temporary.name)/'rolling-other.gif'
        Image.new('RGB',(64,64),'#a83625').save(media,save_all=True,
            append_images=[Image.new('RGB',(64,64),'#368c25')],duration=1000,loop=0)
        with self.open_rolling_editor() as panel:
            # Keep the source asset directory of the outer context alive until all decoders settle.
            info=media_assets.prepare_asset(media,media.name,engine._ffmpeg_bin())
            self.page.evaluate("""info=>{mediaLibrary.videos.set(info.asset,info);projectStore.update(p=>{p.videoClips[1].asset=info.asset;});}""",info)
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')
            urls=self.page.evaluate('projectStore.state.videoClips.map(c=>videoClipEditor.infos.get(c.asset).preview_url)')
            self.page.route('**'+urls[1],lambda route:route.abort('failed'))
            panel.locator('.rolling-comparison > summary').click()
            wait_for_browser(self.page,"!document.querySelector('.rolling-retry').hidden")
            self.page.unroute('**'+urls[1]);panel.locator('.rolling-retry').click()
            wait_for_browser(self.page,"document.querySelector('.rolling-frame-status').textContent==='Kaynak kareleri hazır.'")
            panel.locator('.rolling-delta').fill('.25');panel.locator('.rolling-delta').fill('-.25')
            wait_for_browser(self.page,"document.querySelector('.rolling-frame-status').textContent==='Kaynak kareleri hazır.'")
            pixels=self.page.evaluate("[...document.querySelectorAll('.rolling-frames canvas')].map(c=>[...c.getContext('2d').getImageData(160,90,1,1).data].slice(0,3))")
            self.assertLess(pixels[0][0],pixels[0][2]);self.assertEqual(pixels[0],pixels[1])
            self.assertGreater(pixels[2][1],pixels[2][0]);self.assertGreater(pixels[3][0],pixels[3][1])
            self.assertIn('.750',panel.locator('figcaption').nth(3).inner_text())
            panel.locator(':scope > summary').click()
            self.assertTrue(self.page.evaluate('!videoClipEditor.rolling.preview.video && !videoClipEditor.rolling.preview.pending'))

    @contextmanager
    def open_video_audio_editor(self):
        import subprocess
        import engine
        import media_assets
        media=Path(self.temporary.name)/'sesli-kaynak.mp4'
        if not media.exists():
            subprocess.run([engine._ffmpeg_bin(),'-v','error','-f','lavfi','-i','testsrc2=s=64x64:r=24:d=2',
                '-f','lavfi','-i','sine=frequency=440:sample_rate=44100:duration=2',
                '-c:v','libx264','-c:a','aac','-shortest',str(media)],check=True)
        self.load_audio()
        with patch.object(media_assets,'ASSET_DIR',Path(self.temporary.name)/'video-audio-assets'):
            self.page.locator('#backgroundUpload').set_input_files(str(media))
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')
            self.page.evaluate('mediaLibrary.addVideo(projectStore.state.background.asset)')
            wait_for_browser(self.page,'projectStore.state.videoClips.length===2 && videoPreview.ready')
            self.page.evaluate("""projectStore.update(p=>{p.effects.speed=1;p.video.linkSpeed=false;p.tracks.main.loop=false;
              Object.assign(p.videoClips[0],{id:'audio-video',start:.25,end:1.25,offset:.25,transitionDuration:0});
              Object.assign(p.videoClips[1],{id:'audio-next',start:0,end:.5,offset:2.25,transitionDuration:0});
            });videoClipEditor.select('audio-video');videoClipEditor.audio.panel.open=true;""")
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')
            self.page.locator('.extract-audio-handles').uncheck()
            yield self.page.locator('.video-audio-editor')
            self.page.wait_for_load_state('networkidle')

    def extract_video_audio(self,panel):
        panel.locator('.extract-video-audio').click()
        wait_for_browser(self.page,'projectStore.state.clipLinks.length===1 && !!audioEngine.files[projectStore.state.clipLinks[0].audio] && !videoClipEditor.audio.busy')
        return self.page.evaluate('projectStore.state.clipLinks[0].audio')

    def test_video_audio_extraction_waveform_playback_wav_undo_and_reopen(self):
        with self.open_video_audio_editor() as panel:
            before=self.page.evaluate('JSON.stringify(projectStore.snapshot())');history=self.page.evaluate('projectStore.past.length')
            kind=self.extract_video_audio(panel)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertEqual(self.page.evaluate('projectStore.state.tracks[projectStore.state.clipLinks[0].audio].offset'),.25)
            rms=self.page.evaluate("id=>{const a=audioEngine.sourceBuffer(id).getChannelData(0);return Math.sqrt(a.reduce((sum,v)=>sum+v*v,0)/a.length);}",kind)
            self.assertGreater(rms,.03)
            audio_panel=self.page.locator('#inspect-'+kind+' .linked-audio-inspector')
            self.assertTrue(audio_panel.is_visible())
            with self.page.expect_download() as download:
                audio_panel.locator('.clip-link-download').click()
            path=Path(download.value.path());self.assertTrue(path.read_bytes().startswith(b'RIFF'))
            saved_wav=Path(self.temporary.name)/download.value.suggested_filename;download.value.save_as(str(saved_wav))
            self.page.evaluate("id=>{projectStore.update(p=>{p.tracks[id].solo=true;});audioEngine.seekProjectTime(.4);audioEngine.play();}",kind)
            wait_for_browser(self.page,'audioEngine.getProjectTime()>.6')
            self.assertTrue(self.page.evaluate('id=>!!audioEngine.ambientSources[id]',kind))
            self.page.evaluate('audioEngine.pause();projectStore.undo()')
            saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())')
            self.page.evaluate('projectStore.undo()');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before)
            self.page.evaluate('projectStore.redo()');self.page.evaluate('value=>openStudioProject(JSON.parse(value))',saved)
            self.assertEqual(self.page.evaluate('projectStore.state.clipLinks.length'),1)
            self.assertTrue(self.page.evaluate('id=>!!audioEngine.files[id]',kind))
            self.page.locator('#'+kind+'Upload').set_input_files(str(saved_wav))
            wait_for_browser(self.page,'id=>!!audioEngine.files[id]',arg=kind)
            self.assertEqual(self.page.evaluate('projectStore.state.clipLinks.length'),1)
            self.assertEqual(self.page.evaluate('id=>audioEngine.files[id].lastModified',kind),0)
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')

    def test_video_audio_linked_moves_numeric_drag_unlink_align_bounds_and_lock(self):
        with self.open_video_audio_editor() as panel:
            kind=self.extract_video_audio(panel)
            audio_panel=self.page.locator('#inspect-'+kind+' .linked-audio-inspector')
            field=self.page.locator('#inspect-'+kind+' [data-edit-key="offset"]')
            field.fill('.5');field.press('Tab')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].offset'),.5)
            audio_panel.locator('.clip-link-enabled').uncheck()
            field.fill('.75');field.press('Tab')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].offset'),.5)
            audio_panel.locator('.clip-link-enabled').check()
            audio_panel.locator('.clip-link-align').click()
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].offset'),.5)
            self.assertEqual(self.page.evaluate('id=>projectStore.state.tracks[id].offset',kind),.5)
            history=self.page.evaluate('projectStore.past.length')
            field.fill('1.5');field.press('Tab')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].offset'),.5)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            self.page.evaluate('id=>projectStore.update(p=>{p.tracks[id].groupLocked=true;})',kind)
            self.page.evaluate("videoClipEditor.select('audio-video')")
            self.page.locator('.clip-offset').fill('.75');self.page.locator('.clip-offset').press('Tab')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].offset'),.5)
            self.page.evaluate("id=>{projectStore.update(p=>{p.tracks[id].groupLocked=false;});timelineSelection.set([{type:'video',id:'audio-video'}]);}",kind)
            self.assertEqual(self.page.evaluate('timelineSelection.refs.length'),2)
            block=self.page.locator('.video-edit-lane [data-clip="audio-video"] .clip-body');block.scroll_into_view_if_needed()
            bounds=block.bounding_box();lane=self.page.locator('.video-edit-lane').bounding_box()
            x=bounds['x']+bounds['width']/2;y=bounds['y']+bounds['height']/2
            dx=lane['width']*.25/self.page.evaluate('timelineView.span')
            self.page.evaluate('window.snapEnabled=false');history=self.page.evaluate('projectStore.past.length')
            self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+dx,y,steps=6)
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].offset'),.5)
            self.assertTrue(self.page.locator('[data-audio-clip="'+kind+'"]').evaluate("el=>!!el.style.transform"))
            self.page.keyboard.press('Escape');self.page.mouse.up()
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+dx,y,steps=6);self.page.mouse.up()
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[0].offset'),.75)
            self.assertAlmostEqual(self.page.evaluate('id=>projectStore.state.tracks[id].offset',kind),.75)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.page.evaluate('projectStore.undo()')
            self.page.set_viewport_size(dict(width=375,height=900))
            touch=self.context.new_cdp_session(self.page)
            touch.send('Emulation.setTouchEmulationEnabled',dict(enabled=True,maxTouchPoints=1))
            block.scroll_into_view_if_needed();bounds=block.bounding_box();lane=self.page.locator('.video-edit-lane').bounding_box()
            x=bounds['x']+bounds['width']/2;y=bounds['y']+bounds['height']/2
            dx=lane['width']*.25/self.page.evaluate('timelineView.span')
            for event,points in [('touchStart',[dict(x=x,y=y)]),('touchMove',[dict(x=x+dx,y=y)]),('touchEnd',[])]:
                touch.send('Input.dispatchTouchEvent',dict(type=event,touchPoints=points))
            wait_for_browser(self.page,'!timelineSelection.drag')
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[0].offset'),.75)
            self.assertAlmostEqual(self.page.evaluate('id=>projectStore.state.tracks[id].offset',kind),.75)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')

    def test_video_audio_cancel_failed_request_retry_and_stale_project_leave_no_layer(self):
        with self.open_video_audio_editor() as panel:
            history=self.page.evaluate('projectStore.past.length')
            self.page.route('**/api/media/extract-audio',lambda route:route.fulfill(status=400,content_type='application/json',body='{"message":"Kontrollü ses hatası"}'))
            panel.locator('.extract-video-audio').click()
            wait_for_browser(self.page,"document.querySelector('.video-audio-status').textContent.includes('Kontrollü')")
            self.assertEqual(self.page.evaluate('projectStore.state.clipLinks.length'),0)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            self.page.unroute('**/api/media/extract-audio')
            # Hold the request so cancellation and selection changes happen before publication.
            pending=[];self.page.route('**/api/media/extract-audio',lambda route:pending.append(route))
            panel.locator('.extract-video-audio').click()
            wait_for_browser(self.page,'videoClipEditor.audio.busy')
            panel.locator('.cancel-video-audio').click()
            for route in pending:route.abort()
            pending.clear()
            self.assertEqual(self.page.evaluate('projectStore.state.clipLinks.length'),0)
            panel.locator('.extract-video-audio').click()
            wait_for_browser(self.page,'videoClipEditor.audio.busy')
            self.page.evaluate("videoClipEditor.select('audio-next')")
            self.assertFalse(self.page.evaluate('videoClipEditor.audio.busy'))
            for route in pending:route.abort()
            self.page.unroute('**/api/media/extract-audio')
            self.page.evaluate("videoClipEditor.select('audio-video')")
            self.extract_video_audio(panel)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)

    def test_video_audio_reverse_ramp_duration_responsive_controls_and_package_roundtrip(self):
        with self.open_video_audio_editor() as panel:
            panel.locator('.extract-audio-handles').check()
            self.page.evaluate("""projectStore.update(p=>{p.videoClips[0].name='Uzun görüntü adı '.repeat(15);
              p.videoClips[0].timeRemap=validateVideoTimeRemap({reverse:true,ramp:[[0,.75,'smooth'],[2,1.5,'hold']]});});""")
            span=self.page.evaluate('videoClipEditor.timeline()[0].span')
            kind=self.extract_video_audio(panel)
            self.assertGreater(self.page.evaluate('id=>audioEngine.sourceBuffer(id).duration',kind),span)
            self.assertGreater(self.page.evaluate('projectStore.state.clipLinks[0].audioAnchor'),0)
            self.assertAlmostEqual(self.page.evaluate('id=>projectStore.state.tracks[id].until-projectStore.state.tracks[id].offset',kind),span,delta=1/44100)
            audio_panel=self.page.locator('#inspect-'+kind+' .linked-audio-inspector')
            for scheme in ['dark','light']:
                self.page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900))
                    self.assertTrue(audio_panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1'))
                    self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.page.set_viewport_size(dict(width=375,height=1600))
            audio_panel.screenshot(path=str(ROOT/'.local/video-audio-mobile.png'))
            self.page.evaluate("videoClipEditor.select('audio-video');projectStore.update(p=>{p.videoClips[0].speed=1.25;});")
            self.assertIn('Kaynak veya hız değişti',panel.locator('.clip-link-status').inner_text())
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')
            saved=self.page.evaluate('projectStore.snapshot()')
            self.page.evaluate("""async()=>{
              const project=projectStore.snapshot(),form=new FormData();form.append('project',JSON.stringify(project));
              for(const [id,file] of Object.entries(audioEngine.files))if(project.tracks[id]?.source)form.append(id,file);
              const exported=await fetch('/api/project/package/export',{method:'POST',body:form});
              if(!exported.ok)throw Error('Package export failed');
              const archive=await exported.blob(),upload=new FormData();upload.append('file',new File([archive],'linked.cozy'));
              openStudioProject({version:1,tracks:{main:{}}});
              const imported=await fetch('/api/project/package/import',{method:'POST',body:upload}),body=await imported.json();
              if(!imported.ok)throw Error(body.message);
              try{
                const files={};for(const [id,source] of Object.entries(body.project.tracks).map(([id,track])=>[id,track.source]))if(source){
                  const response=await fetch(body.audio[id]);if(!response.ok)throw Error('Package audio missing');
                  files[id]=new File([await response.blob()],source.name,{lastModified:source.lastModified});
                }
                await applyProjectPackage(body.project,files);
              }finally{await fetch('/api/project/package/'+body.token,{method:'DELETE'});}
            }""")
            wait_for_browser(self.page,'projectStore.state.clipLinks.length===1 && !!audioEngine.files[projectStore.state.clipLinks[0].audio] && videoPreview.ready && !videoPreview.busy')
            self.assertEqual(self.page.evaluate('projectStore.state.clipLinks'),saved['clipLinks'])
            self.assertEqual(self.page.evaluate('projectStore.state.tracks[projectStore.state.clipLinks[0].audio]'),saved['tracks'][kind])

    def test_split_cut_handles_draft_apply_playback_single_undo_and_reopen(self):
        with self.open_video_audio_editor() as panel:
            panel.locator('.extract-audio-handles').check()
            kind=self.extract_video_audio(panel)
            self.assertAlmostEqual(self.page.evaluate('id=>projectStore.state.tracks[id].start',kind),.25)
            split=self.page.locator('#inspect-'+kind+' .split-cut-editor');split.locator('summary').click()
            before=self.page.evaluate('JSON.stringify(projectStore.snapshot())');history=self.page.evaluate('projectStore.past.length')
            split.locator('.split-cut-start').fill('-.25');split.locator('.split-cut-end').fill('.5')
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].offset'),.25)
            self.assertIn('J-cut 0.250',split.locator('.split-cut-status').inner_text())
            split.locator('.split-cut-apply').click()
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].offset'),.25)
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].end'),1.25)
            track=self.page.evaluate('id=>projectStore.state.tracks[id]',kind)
            self.assertEqual((track['offset'],track['until'],track['start'],track['end']),(0,1.75,0,1.75))
            self.assertAlmostEqual(self.page.evaluate('id=>trackTiming(projectStore.state,id,.25).position',kind),.25)
            saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())')
            self.page.evaluate('projectStore.undo()');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before)
            self.page.evaluate('projectStore.redo()');self.page.evaluate('value=>openStudioProject(JSON.parse(value))',saved)
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            self.page.evaluate('id=>{projectStore.update(p=>{p.tracks[id].solo=true;});audioEngine.seekProjectTime(.02);audioEngine.play();}',kind)
            wait_for_browser(self.page,'audioEngine.getProjectTime()>.08')
            self.assertTrue(self.page.evaluate('id=>!!audioEngine.ambientSources[id]',kind))
            self.page.evaluate('audioEngine.pause()')
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')

    def test_split_cut_invalid_cancel_bounds_locks_and_stale_source(self):
        with self.open_video_audio_editor() as panel:
            panel.locator('.extract-audio-handles').check();kind=self.extract_video_audio(panel)
            split=self.page.locator('#inspect-'+kind+' .split-cut-editor');split.locator('summary').click()
            history=self.page.evaluate('projectStore.past.length')
            split.locator('.split-cut-start').fill('-.5')
            self.assertTrue(split.locator('.split-cut-apply').is_disabled())
            split.locator('.split-cut-start').fill('-.25');split.locator('.split-cut-start').press('Escape')
            self.assertEqual(float(split.locator('.split-cut-start').input_value()),0)
            split.locator('[data-split-edge="end"][data-split-step="1"]').click()
            self.assertAlmostEqual(float(split.locator('.split-cut-end').input_value()),1/24,delta=1e-6)
            split.locator('.split-cut-cancel').click()
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            split.locator('.split-cut-end').fill('.25');split.locator('summary').click();split.locator('summary').click()
            self.assertEqual(float(split.locator('.split-cut-end').input_value()),0)
            self.page.evaluate('id=>projectStore.update(p=>{p.tracks[id].groupLocked=true;})',kind)
            self.assertTrue(split.locator('.split-cut-start').is_disabled())
            self.page.evaluate('id=>projectStore.update(p=>{p.tracks[id].groupLocked=false;p.videoClips[0].speed=1.25;})',kind)
            self.assertIn('yeniden ayırın',split.locator('.split-cut-status').inner_text())
            self.assertTrue(split.locator('.split-cut-apply').is_disabled())
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')

    def test_split_cut_responsive_touch_range_cancel_and_group_move(self):
        with self.open_video_audio_editor() as panel:
            panel.locator('.extract-audio-handles').check();kind=self.extract_video_audio(panel)
            split=self.page.locator('#inspect-'+kind+' .split-cut-editor');split.locator('summary').click()
            for scheme in ['dark','light']:
                self.page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900))
                    self.assertTrue(split.evaluate('e=>e.scrollWidth<=e.clientWidth+1'))
                    self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.page.set_viewport_size(dict(width=375,height=1600))
            touch=self.context.new_cdp_session(self.page);touch.send('Emulation.setTouchEmulationEnabled',dict(enabled=True,maxTouchPoints=1))
            slider=split.locator('.split-cut-end-range');slider.scroll_into_view_if_needed();box=slider.bounding_box()
            x=box['x']+box['width']*.75;y=box['y']+box['height']/2
            history=self.page.evaluate('projectStore.past.length')
            touch.send('Input.dispatchTouchEvent',dict(type='touchStart',touchPoints=[dict(x=x,y=y)]))
            touch.send('Input.dispatchTouchEvent',dict(type='touchMove',touchPoints=[dict(x=x+box['width']*.1,y=y)]))
            touch.send('Input.dispatchTouchEvent',dict(type='touchCancel',touchPoints=[]))
            self.assertEqual(float(split.locator('.split-cut-end').input_value()),0)
            touch.send('Input.dispatchTouchEvent',dict(type='touchStart',touchPoints=[dict(x=x,y=y)]))
            touch.send('Input.dispatchTouchEvent',dict(type='touchMove',touchPoints=[dict(x=x+box['width']*.1,y=y)]))
            touch.send('Input.dispatchTouchEvent',dict(type='touchEnd',touchPoints=[]))
            self.assertGreater(float(split.locator('.split-cut-end').input_value()),0)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            split.locator('.split-cut-apply').click()
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            split.screenshot(path=str(ROOT/'.local/split-cuts-mobile.png'))
            self.page.evaluate('projectStore.update(p=>{p.videoClips[0].offset=.5;})')
            self.assertAlmostEqual(self.page.evaluate('id=>projectStore.state.tracks[id].offset',kind),.5)
            self.assertAlmostEqual(self.page.evaluate('id=>trackTiming(projectStore.state,id,.5).position',kind),.25)
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')

    @contextmanager
    def open_multicam_editor(self):
        import subprocess,engine
        with self.open_video_audio_editor():
            other=Path(self.temporary.name)/'kamera-yan.mp4'
            if not other.exists():
                subprocess.run([engine._ffmpeg_bin(),'-v','error','-f','lavfi','-i','color=c=blue:s=64x64:r=24:d=2',
                    '-f','lavfi','-i','sine=frequency=880:sample_rate=44100:duration=2','-c:v','libx264','-c:a','aac','-shortest',str(other)],check=True)
            self.page.locator('.library-files').set_input_files(str(other))
            wait_for_browser(self.page,"[...mediaLibrary.videos.values()].some(info=>info.name==='kamera-yan.mp4') && !mediaLibrary.busy")
            first=self.page.evaluate('projectStore.state.background.asset')
            second=self.page.evaluate("[...mediaLibrary.videos.values()].find(info=>info.name==='kamera-yan.mp4').asset")
            panel=self.page.locator('.multicam-editor');panel.locator('summary').click()
            for asset in [first,second]:
                panel.locator('.camera-library').select_option(asset);panel.locator('.camera-add').click()
            panel.locator('.camera-range-end').fill('1.5');panel.locator('.camera-range-end').press('Tab')
            wait_for_browser(self.page,"[...multicamEditor.media.values()].length===2 && [...multicamEditor.media.values()].every(v=>v.readyState>=2)")
            yield panel,first,second

    def test_multicam_live_angle_draft_apply_colors_undo_and_reopen(self):
        with self.open_multicam_editor() as (panel,first,second):
            before=self.page.evaluate('JSON.stringify(projectStore.snapshot())');history=self.page.evaluate('projectStore.past.length')
            panel.locator('.camera-record').click()
            self.page.evaluate('audioEngine.pause();audioEngine.seekProjectTime(.5)')
            panel.locator('.camera-tile').nth(1).click()
            self.page.evaluate('audioEngine.seekProjectTime(1)')
            self.page.locator('body').click(position=dict(x=5,y=5));self.page.keyboard.press('1')
            self.assertEqual(self.page.evaluate('multicamEditor.draft.cameraCuts.length'),3)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            panel.locator('.camera-stop').click();panel.locator('.camera-apply').click()
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips.map(c=>c.asset)'),[first,second,first])
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')
            self.page.evaluate('audioEngine.seekProjectTime(.75)')
            wait_for_browser(self.page,'!videoPreview.clips.entries[1].video.seeking')
            pixel=self.page.evaluate("(()=>{const v=videoPreview.clips.entries[1].video,c=document.createElement('canvas');c.width=c.height=4;const x=c.getContext('2d');x.drawImage(v,0,0,4,4);return [...x.getImageData(2,2,1,1).data];})()")
            self.assertGreater(pixel[2],200);self.assertLess(pixel[0],20)
            saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())')
            self.page.evaluate('projectStore.undo()');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before)
            self.page.evaluate('projectStore.redo()');self.page.evaluate('value=>openStudioProject(JSON.parse(value))',saved)
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')

    def test_multicam_sync_errors_cancel_locked_edit_and_responsive_controls(self):
        with self.open_multicam_editor() as (panel,first,second):
            self.page.route('**/api/media/align-audio',lambda route:route.fulfill(status=200,content_type='application/json',body='{"offset":0.125,"confidence":0.9,"overlap":1.5}'))
            panel.locator('.camera-sync').nth(1).click()
            wait_for_browser(self.page,'!multicamEditor.request')
            self.assertEqual(self.page.evaluate('projectStore.state.cameraAngles[1].offset'),.125)
            self.page.unroute('**/api/media/align-audio')
            self.page.route('**/api/media/align-audio',lambda route:route.fulfill(status=400,content_type='application/json',body='{"message":"Belirsiz kayıt"}'))
            panel.locator('.camera-sync').nth(1).click()
            wait_for_browser(self.page,"document.querySelector('.camera-status').textContent.includes('Belirsiz') && !multicamEditor.request")
            self.page.unroute('**/api/media/align-audio')
            self.page.evaluate('projectStore.update(p=>{p.video.groupLocked=true;})')
            self.assertTrue(panel.locator('.camera-record').is_disabled())
            self.page.evaluate('projectStore.update(p=>{p.video.groupLocked=false;})')
            panel.locator('.camera-record').click();panel.locator('.camera-stop').click()
            history=self.page.evaluate('projectStore.past.length')
            panel.locator('.camera-cut-time').first.fill('.25');panel.locator('.camera-cut-time').first.press('Tab')
            self.assertTrue(panel.locator('.camera-apply').is_disabled())
            panel.locator('.camera-cancel').click();self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            for scheme in ['dark','light']:
                self.page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900))
                    self.assertTrue(panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1'))
                    self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            panel.locator('summary').click()
            wait_for_browser(self.page,'multicamEditor.media.size===0')
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')

    def test_export_sections_marker_selection_independent_settings_undo_reopen_and_responsive(self):
        with self.open_video_audio_editor():
            self.page.locator('[data-mode="output"]').click();panel=self.page.locator('.export-sections')
            self.page.evaluate("projectStore.update(p=>{p.markers=[{id:'in',name:'Giriş',time:.5},{id:'out',name:'Çıkış',time:1.5}];})")
            panel.locator('.section-marker-start').select_option('in');panel.locator('.section-marker-end').select_option('out');panel.locator('.section-from-markers').click()
            self.assertEqual(panel.locator('.section-start').input_value(),'0.5');self.assertEqual(panel.locator('.section-end').input_value(),'1.5')
            history=self.page.evaluate('projectStore.past.length');panel.locator('.section-name').fill('Giriş Bölümü');panel.locator('.section-add').click()
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertEqual(panel.locator('.saved-section-filename').input_value(),'Giris_Bolumu')
            panel.locator('.section-output-fps').select_option('60');panel.locator('.section-output-aspect').select_option('9:16')
            self.assertEqual(self.page.evaluate('projectStore.state.output.fps'),'24')
            self.assertEqual(self.page.evaluate('projectStore.state.exportSections[0].output.fps'),'60')
            panel.locator('.saved-section-filename').fill('../movie');panel.locator('.saved-section-filename').press('Tab')
            self.assertEqual(panel.locator('.saved-section-filename').input_value(),'Giris_Bolumu')
            saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())');self.page.evaluate('projectStore.undo();projectStore.redo()')
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            self.page.evaluate('value=>openStudioProject(JSON.parse(value))',saved)
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')
            for scheme in ['dark','light']:
                self.page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertTrue(panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1'))
                    self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))

    def test_export_section_queue_uses_frozen_project_and_retains_each_download(self):
        with self.open_video_audio_editor():
            self.page.locator('[data-mode="output"]').click();panel=self.page.locator('.export-sections')
            self.page.evaluate("projectStore.update(p=>{createExportSection(p,'Bir',.5,1);createExportSection(p,'İki',1,1.5);})")
            requests=[];statuses={}
            def submit(route):
                requests.append(route.request.post_data_buffer);job=f'sectionjob{len(requests)}';route.fulfill(json=dict(job_id=job))
            def status(route):
                job=route.request.url.rsplit('/',1)[1];statuses[job]=statuses.get(job,0)+1
                route.fulfill(json=dict(state='running' if statuses[job]==1 else 'done',progress=50,download_url='/download/'+job+'.mp4',message='Test'))
            self.page.route('**/render',submit);self.page.route('**/status/sectionjob*',status)
            panel.locator('.section-export-all').click();wait_for_browser(self.page,'exportSectionEditor.busy && isStudioRendering()')
            self.assertTrue(panel.locator('.section-add').is_disabled())
            self.page.evaluate('projectStore.update(p=>{p.tracks.main.volume=73;})')
            wait_for_browser(self.page,'!exportSectionEditor.busy',timeout=15000)
            self.assertEqual(len(requests),2);self.assertEqual(panel.locator('.section-results a').count(),2)
            for payload in requests:self.assertIn(b'name="sectionId"',payload);self.assertNotIn(b'"volume":73',payload)
            self.assertIn('Bir.mp4',panel.locator('.section-results a').first.inner_text());self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.volume'),73)

    def test_export_section_queue_cancel_and_missing_audio_show_visible_results(self):
        with self.open_video_audio_editor():
            self.page.locator('[data-mode="output"]').click();panel=self.page.locator('.export-sections')
            self.page.evaluate("projectStore.update(p=>{createExportSection(p,'Bir',.5,1);createExportSection(p,'İki',1,1.5);})")
            requests=[];state=['running']
            self.page.route('**/render',lambda route:(requests.append(1),route.fulfill(json=dict(job_id='sectioncancel'))))
            self.page.route('**/status/sectioncancel',lambda route:route.fulfill(json=dict(state=state[0],message='İptal edildi',progress=0)))
            def cancel(route):state[0]='cancelled';route.fulfill(json=dict(state='cancelled'))
            self.page.route('**/cancel/sectioncancel',cancel)
            panel.locator('.section-export-all').click();wait_for_browser(self.page,"document.querySelector('#cancelRenderBtn').classList.contains('hidden')===false")
            panel.locator('.section-cancel').click();wait_for_browser(self.page,'!exportSectionEditor.busy')
            self.assertEqual(len(requests),1);self.assertIn('iptal',panel.locator('.section-status').inner_text());self.assertEqual(panel.locator('.section-results a').count(),0)
            self.page.evaluate('window.sectionTestFile=audioEngine.files.main;delete audioEngine.files.main')
            panel.locator('.section-export-all').click();wait_for_browser(self.page,'!exportSectionEditor.busy')
            self.assertIn('Ana şarkı bağlı değil',panel.locator('.section-status').inner_text())
            self.page.evaluate('audioEngine.files.main=window.sectionTestFile;delete window.sectionTestFile')

    def test_video_time_inspector_ramp_reverse_freeze_ripple_and_undo(self):
        with self.open_transition_editor():
            self.page.evaluate("videoClipEditor.select(projectStore.state.videoClips[0].id);videoClipEditor.time.panel.open=true;audioEngine.seekProjectTime(.5)")
            panel=self.page.locator('.clip-editor .video-time-editor')
            history=self.page.evaluate('projectStore.past.length')
            panel.locator('[data-time-preset="up"]').click()
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertAlmostEqual(self.page.evaluate('videoClipEditor.timeline()[0].span'),2.5)
            self.assertAlmostEqual(self.page.evaluate('videoClipEditor.timeline()[1].offset'),2)
            self.assertEqual(panel.locator('.time-point').count(),2)
            panel.locator('.time-reverse').check()
            self.assertTrue(self.page.evaluate('projectStore.state.videoClips[0].timeRemap.reverse'))
            panel.locator('.time-smoothing').select_option('blend')
            self.page.evaluate('audioEngine.seekProjectTime(.75)')
            wait_for_browser(self.page,'videoPreview.clips.entries[0].sampler.settled()')
            self.assertTrue(self.page.evaluate('videoPreview.clips.entries[0].video.paused'))
            self.assertEqual(self.page.evaluate("projectStore.state.videoClips[0].timeRemap.smoothing"),'blend')
            panel.locator('.time-freeze-duration').fill('1.5')
            panel.locator('.time-freeze').click()
            self.assertAlmostEqual(self.page.evaluate('videoClipEditor.timeline()[0].span'),1.5)
            self.assertAlmostEqual(self.page.evaluate('videoClipEditor.timeline()[1].offset'),1)
            self.assertIsNotNone(self.page.evaluate('projectStore.state.videoClips[0].timeRemap.freezeAt'))
            self.page.evaluate('projectStore.undo()')
            self.assertAlmostEqual(self.page.evaluate('videoClipEditor.timeline()[0].span'),2.5)
            panel.locator('.time-point input[aria-label$="Hız çarpanı · ×"]').first.fill('0.75')
            panel.locator('.time-point input[aria-label$="Hız çarpanı · ×"]').first.press('Tab')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].timeRemap.ramp[0][1]'),.75)
            self.page.evaluate('projectStore.replace(JSON.parse(JSON.stringify(projectStore.snapshot())))')
            self.assertTrue(self.page.evaluate('projectStore.state.videoClips[0].timeRemap.reverse'))
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].timeRemap.ramp[0][1]'),.75)

    def test_video_time_reverse_pixels_blend_freeze_and_live_clock(self):
        with self.open_transition_editor():
            self.page.evaluate("""projectStore.update(p=>{p.videoClips=p.videoClips.slice(0,1);p.video.loop=false;
              p.videoClips[0].timeRemap=validateVideoTimeRemap({reverse:true});});videoClipEditor.select(projectStore.state.videoClips[0].id);videoClipEditor.time.panel.open=true;audioEngine.seekProjectTime(.25);""")
            wait_for_browser(self.page,'videoPreview.ready&&videoPreview.clips.entries[0]?.sampler.settled()')
            pixel="""()=>{videoPreview.draw();const c=document.getElementById('previewCanvas');return [...c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data].slice(0,3);} """
            for actual,expected in zip(self.page.evaluate(pixel),[184,131,82]):self.assertAlmostEqual(actual,expected,delta=5)
            panel=self.page.locator('.clip-editor .video-time-editor')
            panel.locator('.time-smoothing').select_option('blend')
            self.page.evaluate('audioEngine.seekProjectTime(1.5)')
            wait_for_browser(self.page,'videoPreview.clips.entries[0].sampler.settled()')
            for actual,expected in zip(self.page.evaluate(pixel),[133,120,102]):self.assertAlmostEqual(actual,expected,delta=6)
            panel.locator('.time-freeze-duration').fill('2')
            panel.locator('.time-freeze').click()
            self.page.evaluate('audioEngine.seekProjectTime(.25)')
            wait_for_browser(self.page,'videoPreview.clips.entries[0].sampler.settled()')
            frozen=self.page.evaluate(pixel)
            self.page.evaluate('audioEngine.seekProjectTime(1.75)')
            wait_for_browser(self.page,'videoPreview.clips.entries[0].sampler.settled()')
            self.assertEqual(self.page.evaluate(pixel),frozen)
            panel.locator('.time-unfreeze').click()
            self.page.evaluate('audioEngine.seekProjectTime(.25);audioEngine.play()')
            wait_for_browser(self.page,'audioEngine.getProjectTime()>.55')
            self.assertTrue(self.page.evaluate('videoPreview.clips.entries[0].video.paused'))
            self.page.evaluate('audioEngine.pause()')
            wait_for_browser(self.page,'videoPreview.clips.entries[0].sampler.settled()')
            expected=self.page.evaluate('clipFrame(projectStore.state,videoClipEditor.timeline(),audioEngine.getProjectTime()).position')
            actual=self.page.evaluate('videoPreview.clips.entries[0].sampler.targets.get(videoPreview.clips.entries[0].video)')
            self.assertAlmostEqual(actual,math.floor(expected),delta=.05)

    def test_video_time_layer_lock_phase_trim_and_responsive_controls(self):
        with self.open_visual_layers() as layers:
            layers.locator('.visual-add-library').click()
            wait_for_browser(self.page,'videoPreview.visuals.isReady()')
            self.page.evaluate('visualLayerEditor.time.panel.open=true;audioEngine.seekProjectTime(.5)')
            panel=layers.locator('.video-time-editor')
            panel.locator('[data-time-preset="down"]').click()
            panel.locator('.time-reverse').check()
            self.assertTrue(self.page.evaluate('projectStore.state.visualLayers[0].timeRemap.reverse'))
            self.page.evaluate("projectStore.update(p=>editVisualLayer(p,p.visualLayers[0].id,{locked:true}))")
            self.assertTrue(panel.locator('.time-reverse').is_disabled())
            self.page.evaluate("projectStore.update(p=>editVisualLayer(p,p.visualLayers[0].id,{locked:false}));audioEngine.seekProjectTime(1)")
            wait_for_browser(self.page,'[...videoPreview.visuals.entries.values()][0].sampler.settled()')
            before=self.page.evaluate('visualLayerTiming(projectStore.state.visualLayers[0],[...videoPreview.visuals.entries.values()][0].info,1,3).position')
            self.page.evaluate("projectStore.update(p=>trimVisualLayer(p,p.visualLayers[0].id,'offset',.5,[...videoPreview.visuals.entries.values()][0].info))")
            self.assertAlmostEqual(self.page.evaluate('visualLayerTiming(projectStore.state.visualLayers[0],[...videoPreview.visuals.entries.values()][0].info,1,3).position'),before)
            for width in [320,375,768,1024,1440]:
                for theme in ['light','dark']:
                    self.page.set_viewport_size(dict(width=width,height=900));self.page.emulate_media(color_scheme=theme)
                    self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
                    self.assertTrue(panel.evaluate('(el)=>el.scrollWidth<=el.clientWidth'))

    def test_visual_layer_sources_controls_groups_and_reopen(self):
        with self.open_visual_layers() as panel:
            panel.locator('.visual-add-text').click();panel.locator('.visual-add-text').click()
            panel.locator('.visual-files').set_input_files(str(self.visual_image))
            wait_for_browser(self.page,'projectStore.state.visualLayers.length===3&&videoPreview.visuals.isReady()')
            panel.locator('.visual-add-library').click()
            wait_for_browser(self.page,'projectStore.state.visualLayers.length===4&&videoPreview.visuals.isReady()')
            self.assertEqual(self.page.locator('.visual-layer-track').count(),4)
            for key,value in [('opacity','47.5'),('x','25.125'),('rotation','19.5'),('start','.25'),('end','1.5'),('speed','.75')]:
                field=panel.locator(f'[data-visual-field="{key}"]');field.fill(value);field.press('Tab')
            panel.locator('[data-visual-field="blend"]').select_option('screen')
            panel.locator('[data-visual-field="loop"]').uncheck()
            saved=self.page.evaluate('projectStore.snapshot()')
            self.assertEqual(saved['visualLayers'][-1]['x'],25.125)
            self.assertEqual(saved['visualLayers'][-1]['blend'],'screen')
            for layer in saved['visualLayers'][-2:]:panel.locator(f'[data-visual-row="{layer["id"]}"] input[type=checkbox]').check()
            history=self.page.evaluate('projectStore.past.length');panel.locator('.visual-group-create').click()
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertEqual(len(self.page.evaluate('projectStore.state.visualGroups')),1)
            group=panel.locator('.visual-group-row');group.locator('input').fill('Görsel çifti');group.locator('input').press('Tab')
            group.locator('button[aria-label$=" Kilit"]').click()
            self.assertTrue(panel.locator('[data-visual-field="x"]').is_disabled())
            self.assertTrue(self.page.locator(f'[data-visual-layer="{saved["visualLayers"][-1]["id"]}"] .visual-layer-body').is_disabled())
            group.locator('button[aria-label$=" Kilit"]').click()
            group.locator('button[aria-label$=" Gör"]').click()
            self.assertFalse(self.page.evaluate('visualLayerVisible(projectStore.state,projectStore.state.visualLayers.at(-1))'))
            group.locator('button[aria-label$=" Gör"]').click()
            saved=self.page.evaluate('projectStore.snapshot()');self.page.evaluate('p=>projectStore.replace(p)',saved)
            wait_for_browser(self.page,'videoPreview.visuals.isReady()')
            self.assertEqual(self.page.evaluate('projectStore.snapshot()'),saved)
            group.locator('button').last.click();self.assertEqual(self.page.evaluate('projectStore.state.visualGroups'),[])

    def test_visual_layer_timeline_group_drag_cancel_trim_keyboard_and_single_undo(self):
        with self.open_visual_layers() as panel:
            panel.locator('.visual-add-text').click();panel.locator('.visual-add-text').click()
            self.page.evaluate('''projectStore.update(p=>{Object.assign(p.visualLayers[0],{offset:.5,until:1.5});Object.assign(p.visualLayers[1],{offset:1,until:2});groupVisualLayers(p,p.visualLayers.map(l=>l.id));});
              window.snapEnabled=false;timelineView.set(2,.25);visualLayerEditor.select(projectStore.state.visualLayers[0].id);''')
            id=self.page.evaluate('projectStore.state.visualLayers[0].id')
            body=self.page.locator(f'[data-visual-layer="{id}"] .visual-layer-body');body.scroll_into_view_if_needed()
            box=body.bounding_box();lane=self.page.locator(f'[data-visual-layer="{id}"] .visual-layer-lane').bounding_box();span=self.page.evaluate('timelineView.span')
            x=box['x']+box['width']/2;y=box['y']+box['height']/2
            before=self.page.evaluate('projectStore.snapshot()');history=self.page.evaluate('projectStore.past.length')
            self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+.25/span*lane['width'],y)
            self.assertEqual(self.page.evaluate('projectStore.state'),before)
            self.assertAlmostEqual(self.page.evaluate('videoPreview.visualDraft.visualLayers[0].offset'),.75)
            self.page.keyboard.press('Escape');self.page.mouse.up();self.assertEqual(self.page.evaluate('projectStore.state'),before)
            self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+.25/span*lane['width'],y);self.page.mouse.up()
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertEqual(self.page.evaluate('projectStore.state.visualLayers.map(l=>l.offset)'),[.75,1.25])
            body.press('Shift+ArrowRight')
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.visualLayers[0].offset'),.75+10/int(self.page.evaluate('projectStore.state.output.fps')))
            self.page.evaluate('projectStore.undo();projectStore.undo()');self.assertEqual(self.page.evaluate('projectStore.state'),before)
            trim=self.page.locator(f'[data-visual-layer="{id}"] [data-visual-edge="until"]');trim.press('ArrowLeft')
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.visualLayers[0].until'),1.5-1/int(self.page.evaluate('projectStore.state.output.fps')))
            self.assertEqual(self.page.evaluate('projectStore.state.visualLayers[1].until'),2)

    def test_visual_layer_canvas_drafts_move_resize_keyboard_snapshot_and_external_cancel(self):
        with self.open_visual_layers() as panel:
            panel.locator('.visual-files').set_input_files(str(self.visual_image))
            wait_for_browser(self.page,'projectStore.state.visualLayers.length===1&&videoPreview.visuals.isReady()')
            move=self.page.locator('.visual-transform-move');move.scroll_into_view_if_needed();box=move.bounding_box()
            x=box['x']+box['width']/2;y=box['y']+box['height']/2
            before=self.page.evaluate('projectStore.snapshot()');history=self.page.evaluate('projectStore.past.length')
            self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+30,y+15)
            self.assertEqual(self.page.evaluate('projectStore.state'),before)
            self.assertNotEqual(self.page.evaluate('videoPreview.visualDraft.visualLayers[0].x'),50)
            self.page.keyboard.press('Escape');self.page.mouse.up();self.assertIsNone(self.page.evaluate('videoPreview.visualDraft'))
            self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+30,y+15);self.page.mouse.up()
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.page.evaluate('projectStore.undo()');self.assertEqual(self.page.evaluate('projectStore.state'),before)
            move.press('Shift+ArrowRight')
            expected=50+100*10/self.page.evaluate('videoPreview.canvas.width')
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.visualLayers[0].x'),expected)
            self.page.evaluate('projectStore.undo()')
            resize=self.page.locator('.visual-transform-resize');box=resize.bounding_box()
            self.page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);self.page.mouse.down();self.page.mouse.move(box['x']+30,box['y']+30)
            saved=self.page.evaluate('projectStore.snapshot()');self.page.mouse.up()
            self.assertGreater(saved['visualLayers'][0]['width'],50)
            self.page.evaluate('projectStore.undo()');box=move.bounding_box()
            self.page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);self.page.mouse.down();self.page.mouse.move(box['x']+30,box['y']+15)
            self.page.evaluate('projectStore.update(p=>{p.video.rotation=12;})');self.page.mouse.up()
            self.assertIsNone(self.page.evaluate('videoPreview.visualDraft'))
            self.assertEqual(self.page.evaluate('projectStore.state.visualLayers[0].x'),50)

    def test_visual_layer_blend_pixels_alpha_order_time_and_group_visibility(self):
        result=self.page.evaluate('''() => {
          const canvas=document.createElement('canvas');canvas.width=canvas.height=32;const ctx=canvas.getContext('2d');
          const source=document.createElement('canvas');source.width=source.height=32;const s=source.getContext('2d');s.fillStyle='rgba(220,50,30,.5)';s.fillRect(0,0,32,32);
          const p=validateProject({version:1,tracks:{main:{source:{name:'x',size:1,lastModified:0,duration:3}}},effects:{speed:1},visualLayers:[{id:'a',type:'image',asset:'a'.repeat(64),width:100,offset:.5,until:2,opacity:70}],visualGroups:[]});
          const renderer=new VisualLayerRenderer(),resources=new Map([['a',{source}]]),pixel=()=>Array.from(ctx.getImageData(16,16,1,1).data),base=()=>{ctx.fillStyle='#708090';ctx.fillRect(0,0,32,32);};let max=0;
          for(const blend of PROJECT_SCHEMA.visualLayer.blend.values){p.visualLayers[0].blend=blend;base();renderer.draw(ctx,p,1,resources);const actual=pixel();base();ctx.save();ctx.globalAlpha=.7;ctx.globalCompositeOperation=blend;ctx.drawImage(source,0,0);ctx.restore();const expected=pixel();max=Math.max(max,...actual.map((v,i)=>Math.abs(v-expected[i])));}
          base();const empty=pixel();renderer.draw(ctx,p,2,resources);const boundary=JSON.stringify(pixel())===JSON.stringify(empty);
          p.visualGroups=[{id:'g',visible:false,locked:false}];p.visualLayers[0].group='g';base();renderer.draw(ctx,p,1,resources);return {max,boundary,hidden:JSON.stringify(pixel())===JSON.stringify(empty)};
        }''')
        self.assertEqual(result,dict(max=0,boundary=True,hidden=True))

    def test_visual_layer_video_clock_seek_hold_visibility_and_resource_reuse(self):
        with self.open_visual_layers() as panel:
            panel.locator('.visual-add-library').click();wait_for_browser(self.page,'videoPreview.visuals.isReady()')
            self.page.evaluate('''projectStore.update(p=>{Object.assign(p.visualLayers[0],{offset:.4,until:2.8,end:2,speed:.75,loop:false});});
              window.layerSource=videoPreview.visuals.entries.get(projectStore.state.visualLayers[0].id).source;audioEngine.seekProjectTime(.8);''')
            wait_for_browser(self.page,'!layerSource.seeking')
            self.assertAlmostEqual(self.page.evaluate('layerSource.currentTime'),.3,delta=.02)
            panel.locator('[data-visual-field="opacity"]').fill('55');panel.locator('[data-visual-field="opacity"]').press('Tab')
            self.assertTrue(self.page.evaluate('layerSource===videoPreview.visuals.entries.get(projectStore.state.visualLayers[0].id).source'))
            self.page.evaluate('audioEngine.play()');wait_for_browser(self.page,'audioEngine.getProjectTime()>1.2')
            self.assertTrue(self.page.evaluate('!layerSource.paused'))
            difference=self.page.evaluate('layerSource.currentTime-(audioEngine.getProjectTime()-.4)*.75')
            self.assertAlmostEqual(difference,0,delta=.13)
            self.page.evaluate('audioEngine.pause();audioEngine.seekProjectTime(1.8);audioEngine.seekProjectTime(2.5)');wait_for_browser(self.page,'!layerSource.seeking')
            # Chromium may report duration for a held final frame at very low FPS.
            pixel=self.page.evaluate("""() => {const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.drawImage(layerSource,0,0,1,1);return Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3);}""")
            self.assertTrue(all(abs(a-b)<5 for a,b in zip(pixel,[184,131,82])),pixel)
            self.assertTrue(self.page.evaluate('layerSource.paused'))
            self.page.evaluate("window.holdSeeks=0;layerSource.addEventListener('seeking',()=>holdSeeks++);audioEngine.play()")
            wait_for_browser(self.page,'audioEngine.getProjectTime()>2.65')
            self.assertTrue(self.page.evaluate('layerSource.paused'))
            self.assertLessEqual(self.page.evaluate('holdSeeks'),2)
            self.page.evaluate('audioEngine.pause()')
            self.page.evaluate('projectStore.update(p=>{p.visualLayers[0].visible=false;})')
            self.assertTrue(self.page.evaluate('layerSource.paused'))
            self.page.evaluate('projectStore.update(p=>{p.visualLayers[0].end=4;})')
            self.assertFalse(self.page.evaluate('videoPreview.visuals.isReady()'))
            self.assertTrue(self.page.locator('.visual-layer-canvas').is_hidden())
            self.page.evaluate('projectStore.update(p=>{p.visualLayers[0].end=2;})')
            self.assertTrue(self.page.evaluate('videoPreview.visuals.isReady()'))
            self.page.evaluate('projectStore.update(p=>{p.visualLayers=[];})')
            self.assertEqual(self.page.evaluate('videoPreview.visuals.entries.size'),0)
            self.assertFalse(self.page.evaluate('layerSource.hasAttribute("src")'))

    def test_reframe_three_variants_correction_export_snapshot_undo_and_reopen(self):
        with self.open_transition_editor():
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id);reframeEditor.panel.open=true;videoClipEditor.tracking.result={points:[[0,30,50,1],[1,70,50,1]],lostAt:null};videoClipEditor.tracking.context={project:projectStore.state,clipId:projectStore.state.videoClips[0].id}')
            panel=self.page.locator('.reframe-editor');history=self.page.evaluate('projectStore.past.length');panel.locator('.reframe-all').click();self.assertEqual(self.page.evaluate('projectStore.state.reframeVariants.length'),3);self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            ids=self.page.evaluate('projectStore.state.reframeVariants.map(v=>v.id)');panel.locator('.reframe-selector').select_option(ids[2]);panel.locator('.reframe-activate').click();self.assertEqual(self.page.evaluate('projectStore.state.output.aspect'),'9:16')
            self.page.evaluate('projectStore.update(p=>{p.video.keyframes.translateX[0][1]=3.125;})');panel.locator('.reframe-update').click();self.assertEqual(self.page.evaluate('projectStore.state.reframeVariants[2].geometry.keyframes.translateX[0][1]'),3.125)
            saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())');panel.locator('.reframe-selector').select_option(ids[0]);self.page.evaluate('window.savedRender=window.renderStudioProject;window.renderStudioProject=async options=>{window.viewExport=options.project;return {state:"done",download_url:"/api/render/test/file"};};void 0')
            panel.locator('.reframe-export').click();wait_for_browser(self.page,'!reframeEditor.busy && document.querySelectorAll(".reframe-downloads a").length===1');self.assertEqual(self.page.evaluate('viewExport.output.aspect'),'16:9');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved);self.page.evaluate('window.renderStudioProject=window.savedRender;void 0')
            panel.locator('.reframe-remove').click();self.assertEqual(self.page.evaluate('projectStore.state.reframeVariants.length'),2);self.page.evaluate('projectStore.undo()');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            self.page.evaluate('value=>openStudioProject(JSON.parse(value))',saved);wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)

    def test_reframe_missing_tracking_lock_and_responsive(self):
        with self.open_transition_editor():
            self.page.evaluate('reframeEditor.panel.open=true');panel=self.page.locator('.reframe-editor');panel.locator('.reframe-generate').click();self.assertIn('önce bölge takibini',panel.locator('.reframe-status').inner_text());self.assertEqual(self.page.evaluate('projectStore.state.reframeVariants.length'),0)
            panel.locator('.reframe-save').click();self.assertEqual(self.page.evaluate('projectStore.state.reframeVariants.length'),1);self.page.evaluate('projectStore.update(p=>{p.video.groupLocked=true;})');self.assertTrue(panel.locator('.reframe-activate').is_disabled())
            for scheme in ['dark','light']:
                self.page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertTrue(panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1'));self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))

    def test_motion_tracking_analysis_draft_correction_layer_and_mask_keys(self):
        with self.open_visual_layers() as layers:
            layers.locator('.visual-add-text').click();layer=self.page.evaluate('projectStore.state.visualLayers[0].id');self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id);videoClipEditor.tracking.panel.open=true')
            panel=self.page.locator('.motion-tracking-editor');requests=[]
            def result(route):
                requests.append(route.request.post_data_json);route.fulfill(json=dict(points=[[0,25,30,1],[.5,35,40,.9],[1,45,50,.8]],lostAt=None,width=64,height=64))
            self.page.route('**/api/media/track',result);panel.locator('.tracking-run').click();wait_for_browser(self.page,'videoClipEditor.tracking.result!==null && !videoClipEditor.tracking.request')
            self.assertEqual(len(requests),1);self.assertEqual(requests[0]['region'],[40,40,20,20]);self.assertEqual(panel.locator('.tracking-point').count(),3)
            point=panel.locator('.tracking-point').nth(1).locator('[data-tracking-axis="1"]');point.fill('37.125');point.press('Tab');panel.locator('.tracking-target').select_option('layer:'+layer)
            history=self.page.evaluate('projectStore.past.length');panel.locator('.tracking-apply').click();self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertEqual(self.page.evaluate('projectStore.state.visualLayers[0].motionPath.nodes[1][1]'),-12.875);saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())')
            self.page.evaluate('projectStore.undo()');self.assertFalse(self.page.evaluate('projectStore.state.visualLayers[0].motionPath.enabled'))
            panel.locator('.tracking-run').click();wait_for_browser(self.page,'videoClipEditor.tracking.result!==null && !videoClipEditor.tracking.request');panel.locator('.tracking-target').select_option('mask');panel.locator('.tracking-apply').click()
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].mask.keyframes.x'),[[0,25],[.5,35],[1,45]])
            self.page.evaluate('value=>openStudioProject(JSON.parse(value))',saved);wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)

    def test_motion_tracking_flat_region_error_cancel_and_responsive(self):
        with self.open_transition_editor():
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id);videoClipEditor.tracking.panel.open=true');panel=self.page.locator('.motion-tracking-editor');history=self.page.evaluate('projectStore.past.length')
            panel.locator('.tracking-run').click();wait_for_browser(self.page,"!videoClipEditor.tracking.request && document.querySelector('.tracking-status').textContent.includes('ayrıntı')")
            self.assertIsNone(self.page.evaluate('videoClipEditor.tracking.result'));self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            panel.locator('.tracking-cancel').click();self.assertIsNone(self.page.evaluate('videoClipEditor.tracking.result'))
            for scheme in ['dark','light']:
                self.page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertTrue(panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1'));self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            panel.locator('summary').click();wait_for_browser(self.page,'!videoClipEditor.tracking.media.hasAttribute("src")')

    def test_motion_path_cubic_handles_keyboard_snapshot_cancel_and_reopen(self):
        with self.open_transition_editor():
            self.page.evaluate('motionPathEditor.panel.open=true;audioEngine.seekProjectTime(0)');panel=self.page.locator('#videoPanel > .motion-path-editor')
            panel.locator('.motion-add').click();self.page.evaluate('audioEngine.seekProjectTime(1)');panel.locator('.motion-add').click()
            panel.locator('[data-motion-field="1"]').fill('30');panel.locator('[data-motion-field="1"]').press('Tab');panel.locator('.motion-select').select_option('0');panel.locator('.motion-mode').select_option('bezier')
            panel.locator('[data-motion-field="5"]').fill('10.125');panel.locator('[data-motion-field="5"]').press('Tab');panel.locator('[data-motion-field="6"]').fill('-20');panel.locator('[data-motion-field="6"]').press('Tab')
            self.assertEqual(self.page.evaluate('projectStore.state.video.motionPath.nodes[0][5]'),10.125)
            panel.locator('.motion-handle-out').press('ArrowRight');self.assertAlmostEqual(self.page.evaluate('projectStore.state.video.motionPath.nodes[0][5]'),10.225)
            history=self.page.evaluate('projectStore.past.length');self.page.evaluate('var pathDraft=copyProject(projectStore.state.video.motionPath);pathDraft.nodes[0][6]=-30;motionPathEditor.preview(pathDraft)')
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history);saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())');self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.page.evaluate('pathDraft=copyProject(projectStore.state.video.motionPath);pathDraft.nodes[0][6]=-50;motionPathEditor.preview(pathDraft)');panel.locator('.motion-handle-out').press('Escape')
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved);self.assertIsNone(self.page.evaluate('videoPreview.motionDraft'))
            self.page.evaluate('value=>openStudioProject(JSON.parse(value))',saved);wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)

    @contextmanager
    def open_audio_comp(self):
        with self.open_visual_layers():
            for kind in ['rain','fire']:
                self.page.locator('#'+kind+'Upload').set_input_files(str(self.audio));wait_for_browser(self.page,'id=>!!audioEngine.files[id]',arg=kind)
            self.page.evaluate('projectStore.update(p=>{for(const id of ["rain","fire"])Object.assign(p.tracks[id],{offset:0,start:0,end:2,until:2,loop:false,fadeIn:0,fadeOut:0});});selectSidebarTab("main");audioCompEditor.panel.open=true;')
            panel=self.page.locator('.audio-comp-editor')
            for kind in ['rain','fire']:panel.locator('[data-comp-take="'+kind+'"] input[type="checkbox"]').check()
            yield panel

    def test_audio_comp_selection_crossfade_preview_apply_history_reopen_and_regeneration(self):
        with self.open_audio_comp() as panel:
            before=self.page.evaluate('JSON.stringify(projectStore.snapshot())');history=self.page.evaluate('projectStore.past.length');panel.locator('.comp-create').click();panel.locator('.comp-split-time').fill('1');panel.locator('.comp-split').click();panel.locator('[data-comp-take="fire"] .comp-use').click();panel.locator('.comp-crossfade').fill('0.125');panel.locator('.comp-crossfade').press('Tab')
            self.assertEqual(self.page.evaluate('audioCompEditor.draft.segments'),[[0,1,'rain'],[1,2,'fire']]);self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before);panel.locator('.comp-preview').click();wait_for_browser(self.page,'!audioCompEditor.busy && !!audioCompEditor.url');wait_for_browser(self.page,'document.querySelector(".comp-audition").readyState>=1');self.assertAlmostEqual(panel.locator('.comp-audition').evaluate('e=>e.duration'),2,places=3)
            panel.locator('.comp-apply').click();wait_for_browser(self.page,'!audioCompEditor.busy && !audioCompEditor.draft');self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1);p=self.page.evaluate('projectStore.snapshot()');output=p['audioComps'][0]['output'];self.assertTrue(p['tracks']['rain']['muted']);self.assertTrue(p['tracks']['fire']['muted']);self.assertTrue(self.page.evaluate('id=>!!audioEngine.sourceBuffer(id)',output))
            after=self.page.evaluate('JSON.stringify(projectStore.snapshot())');self.page.evaluate('projectStore.undo()');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before);self.page.evaluate('projectStore.redo()');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),after)
            self.page.evaluate('value=>openStudioProject(JSON.parse(value))',after);wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),after)
            self.page.evaluate('id=>projectStore.update(p=>{p.tracks[id].offset=.25;p.tracks[id].until=2.25;})',output);self.page.evaluate('selectSidebarTab("main")');panel.locator('.comp-open').click();panel.locator('[data-comp-take="fire"] .comp-use').click();panel.locator('.comp-apply').click();wait_for_browser(self.page,'!audioCompEditor.busy && !audioCompEditor.draft');new=self.page.evaluate('projectStore.state.audioComps[0].output');self.assertNotEqual(new,output);self.assertAlmostEqual(self.page.evaluate('id=>projectStore.state.tracks[id].offset',new),.25)

    def test_audio_comp_invalid_draft_cancel_dissolve_locks_and_responsive(self):
        with self.open_audio_comp() as panel:
            before=self.page.evaluate('JSON.stringify(projectStore.snapshot())');panel.locator('.comp-create').click();panel.locator('.comp-split-time').fill('1');panel.locator('.comp-split').click();panel.locator('[data-comp-segment="1"] [data-comp-edge="0"]').fill('.5');panel.locator('[data-comp-segment="1"] [data-comp-edge="0"]').press('Tab');self.assertTrue(panel.locator('.comp-apply').is_disabled());self.assertIn('çakışmasız',panel.locator('.comp-status').inner_text());panel.locator('.comp-cancel').click();self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before)
            panel.locator('.comp-create').click()
            for scheme in ['dark','light']:
                self.page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertTrue(panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1'));self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            panel.locator('.comp-apply').click();wait_for_browser(self.page,'!audioCompEditor.busy && !audioCompEditor.draft');self.page.evaluate('selectSidebarTab("main")');panel.locator('.comp-dissolve').click();self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before)
            self.page.evaluate('projectStore.update(p=>{p.tracks.rain.groupLocked=true;})');self.assertTrue(panel.locator('[data-comp-take="rain"] input[type="checkbox"]').is_disabled())

    def test_audio_comp_waveform_mount_failure_restores_sources_mix_and_history(self):
        with self.open_audio_comp() as panel:
            panel.locator('.comp-create').click();before=self.page.evaluate('JSON.stringify(projectStore.snapshot())');history=self.page.evaluate('projectStore.past.length');self.page.evaluate('savedAudioLoader=audioEngine.loadAudio;audioEngine.loadAudio=async()=>{throw new Error("Waveform failure");};void 0');panel.locator('.comp-apply').click();wait_for_browser(self.page,'!audioCompEditor.busy');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before);self.assertEqual(self.page.evaluate('projectStore.past.length'),history);self.assertIn('Waveform failure',panel.locator('.comp-status').inner_text());self.page.evaluate('audioEngine.loadAudio=savedAudioLoader;void 0')

    def test_microphone_pcm_recording_preview_apply_undo_download_and_responsive(self):
        with self.open_visual_layers():
            self.provide_microphone_signal()
            self.context.grant_permissions(['microphone']);self.page.evaluate('selectSidebarTab("main");microphoneEditor.panel.open=true');panel=self.page.locator('.microphone-editor')
            panel.locator('.mic-range').check();panel.locator('.mic-start').fill('0.2');panel.locator('.mic-end').fill('0.8');panel.locator('.mic-count').fill('1');panel.locator('.mic-metronome').check();before=self.page.evaluate('JSON.stringify(projectStore.snapshot())');history=self.page.evaluate('projectStore.past.length');panel.locator('.mic-record').click()
            wait_for_browser(self.page,'!!microphoneEditor.draft || (microphoneEditor.phase==="idle" && !microphoneEditor.session)');self.assertIsNotNone(self.page.evaluate('microphoneEditor.draft?.file.name'),panel.locator('.mic-status').inner_text())
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before);self.assertAlmostEqual(self.page.evaluate('microphoneEditor.draft.buffer.duration'),.6,places=3);self.assertTrue(self.page.evaluate('microphoneEditor.draft.buffer.getChannelData(0).some(v=>Math.abs(v)>.001)'))
            self.assertIsNone(self.page.evaluate('microphoneEditor.session'));self.assertTrue(panel.locator('.mic-draft').is_visible())
            with self.page.expect_download() as download:panel.locator('.mic-download').click()
            self.assertEqual(Path(download.value.path()).read_bytes()[:4],b'RIFF');panel.locator('.mic-apply').click();wait_for_browser(self.page,'microphoneEditor.phase==="idle" && !microphoneEditor.draft')
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1);voice=self.page.evaluate('Object.keys(projectStore.state.tracks).find(k=>k.startsWith("voice_"))');self.assertIsNotNone(voice);self.assertAlmostEqual(self.page.evaluate('id=>projectStore.state.tracks[id].offset',voice),.2);self.assertTrue(self.page.evaluate('id=>!!audioEngine.sourceBuffer(id)',voice))
            after=self.page.evaluate('JSON.stringify(projectStore.snapshot())');self.page.evaluate('projectStore.undo()');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before);self.page.evaluate('projectStore.redo()');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),after)
            self.page.evaluate('selectSidebarTab("main")')
            for scheme in ['dark','light']:
                self.page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertTrue(panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1'));self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))

    def test_microphone_countdown_cancel_and_punch_original_source_preserved(self):
        with self.open_visual_layers():
            self.provide_microphone_signal()
            self.context.grant_permissions(['microphone']);self.page.evaluate('selectSidebarTab("main");microphoneEditor.panel.open=true');panel=self.page.locator('.microphone-editor');panel.locator('.mic-count').fill('8');before=self.page.evaluate('JSON.stringify(projectStore.snapshot())');panel.locator('.mic-record').click();wait_for_browser(self.page,'microphoneEditor.phase==="countdown"');panel.locator('.mic-cancel').click();wait_for_browser(self.page,'!microphoneEditor.session');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before);self.assertIsNone(self.page.evaluate('microphoneEditor.draft'))
            panel.locator('.mic-count').fill('0');panel.locator('.mic-range').check();panel.locator('.mic-start').fill('0');panel.locator('.mic-end').fill('0.5');panel.locator('.mic-record').click();wait_for_browser(self.page,'!!microphoneEditor.draft');panel.locator('.mic-apply').click();wait_for_browser(self.page,'!microphoneEditor.draft && microphoneEditor.phase==="idle"');voice=self.page.evaluate('Object.keys(projectStore.state.tracks).find(k=>k.startsWith("voice_"))');original=self.page.evaluate('id=>copyProject(projectStore.state.tracks[id].source)',voice)
            self.page.evaluate('selectSidebarTab("main")');panel.locator('.mic-target').select_option(voice);panel.locator('.mic-start').fill('0.1');panel.locator('.mic-end').fill('0.4');panel.locator('.mic-record').click();wait_for_browser(self.page,'!!microphoneEditor.draft');history=self.page.evaluate('projectStore.past.length');panel.locator('.mic-apply').click();wait_for_browser(self.page,'!microphoneEditor.draft && microphoneEditor.phase==="idle"');self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1);self.assertEqual(self.page.evaluate('id=>projectStore.state.tracks[id].source',voice),original);self.assertEqual(self.page.evaluate('id=>curveValue(projectStore.state.tracks[id].automation.volume,.25,100)',voice),0)

    def test_subtitle_formats_draft_warnings_styles_word_times_download_reopen_and_responsive(self):
        with self.open_visual_layers():
            self.page.evaluate('selectSidebarTab("lyrics");subtitleFormatEditor.panel.open=true');panel=self.page.locator('.subtitle-format-editor');before=self.page.evaluate('JSON.stringify(projectStore.snapshot())')
            vtt=b'WEBVTT\n\nSTYLE\n::cue(.red) { color: #ff0000; font-family: "Caveat"; font-size: 60px; font-weight: bold; }\n\n00:00:00.000 --> 00:00:01.000 position:25% line:40%,end align:center vertical:rl\n<c.red><00:00:00.000>Hello<00:00:00.400> <00:00:00.600>world<00:00:01.000></c>\n'
            panel.locator('.subtitle-format-file').set_input_files(dict(name='words.vtt',mimeType='text/vtt',buffer=vtt));wait_for_browser(self.page,'!!subtitleFormatEditor.draft')
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before);self.assertIn('vertical',panel.locator('.subtitle-format-warnings').inner_text());history=self.page.evaluate('projectStore.past.length');panel.locator('.subtitle-format-apply').click();self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            row=self.page.evaluate('projectStore.state.lyrics.lines[0]');self.assertEqual(row['cueStyle']['font'],'Caveat');self.assertEqual(row['cueStyle']['anchor'],'bottom');self.assertEqual([(w['start'],w['end']) for w in row['words']],[(0,.4),(.6,1)])
            panel.locator('[data-cue-field="x"]').fill('33.333');panel.locator('[data-cue-field="x"]').press('Tab');self.assertEqual(self.page.evaluate('projectStore.state.lyrics.lines[0].cueStyle.x'),33.333)
            with self.page.expect_download() as download:panel.locator('.subtitle-export-vtt').click()
            text=Path(download.value.path()).read_text(encoding='utf-8');self.assertIn('position:33.333%',text);self.assertIn('<00:00:00.600>world',text)
            with self.page.expect_download() as download:panel.locator('.subtitle-export-ass').click()
            ass=Path(download.value.path()).read_bytes();self.assertIn(b'\\kf40',ass)
            panel.locator('.subtitle-format-file').set_input_files(dict(name='roundtrip.ass',mimeType='text/plain',buffer=ass));wait_for_browser(self.page,'!!subtitleFormatEditor.draft');panel.locator('.subtitle-format-apply').click();self.assertEqual(self.page.evaluate('projectStore.state.lyrics.lines[0].words[1].start'),.6)
            saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())');self.page.evaluate('value=>openStudioProject(JSON.parse(value))',saved);wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            for scheme in ['dark','light']:
                self.page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertTrue(panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1'));self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))

    def test_subtitle_formats_existing_import_cancel_bad_input_and_reset_style(self):
        with self.open_visual_layers():
            self.page.evaluate('selectSidebarTab("lyrics")');self.page.locator('.lyric-tools > summary').filter(has_text='Metin Yapıştır').click();self.page.locator('#lyricsTimebase').select_option('project');panel=self.page.locator('.subtitle-format-editor')
            vtt=b'WEBVTT\n\n00:00.000 --> 00:01.000 position:20%\n<b>Hello</b>\n';before=self.page.evaluate('JSON.stringify(projectStore.snapshot())')
            self.page.locator('#lyricsImport').set_input_files(dict(name='import.vtt',mimeType='text/vtt',buffer=vtt));wait_for_browser(self.page,'!!subtitleFormatEditor.draft');panel.locator('.subtitle-format-cancel').click();self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before)
            panel.locator('.subtitle-format-file').set_input_files(dict(name='bad.vtt',mimeType='text/vtt',buffer=b'WEBVTT\n\n00:00.000 --> 00:01.000\n<00:02.000>Invalid'));wait_for_browser(self.page,'document.querySelector(".subtitle-format-status").textContent.includes("sıralı")');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before)
            panel.locator('.subtitle-format-file').set_input_files(dict(name='import.vtt',mimeType='text/vtt',buffer=vtt));wait_for_browser(self.page,'!!subtitleFormatEditor.draft');panel.locator('.subtitle-format-apply').click();self.assertTrue(self.page.evaluate('projectStore.state.lyrics.lines[0].cueStyle.bold'));panel.locator('.subtitle-style-reset').click();self.assertFalse(self.page.evaluate('Object.hasOwn(projectStore.state.lyrics.lines[0],"cueStyle")'))

    def test_subtitle_languages_translation_comparison_editor_sync_reopen_and_responsive(self):
        with self.open_visual_layers():
            self.page.evaluate('projectStore.update(p=>{p.lyrics.timeBase="project";p.lyrics.lines=[lyricLine("Merhaba dünya",0,1),lyricLine("İkinci satır",1,2)];});selectSidebarTab("lyrics");subtitleTrackEditor.panel.open=true;')
            panel=self.page.locator('.subtitle-track-editor');before=self.page.evaluate('JSON.stringify(projectStore.snapshot())');panel.locator('.subtitle-translate').click()
            panel.locator('[data-translation-row="0"]').fill('Hello world');panel.locator('[data-translation-row="1"]').fill('Second line');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before)
            history=self.page.evaluate('projectStore.past.length');panel.locator('.subtitle-apply').click();self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertEqual(self.page.evaluate('projectStore.state.subtitleTracks.length'),2);self.assertEqual(self.page.evaluate('projectStore.state.lyrics.lines[0].text'),'Hello world')
            original=self.page.evaluate('projectStore.state.subtitleTracks[0].id');english=self.page.evaluate('projectStore.state.subtitles.active');panel.locator('.subtitle-compare').select_option(original);self.assertIn('Merhaba dünya',panel.locator('.subtitle-comparison').inner_text())
            self.page.locator('.lyric-row textarea').first.fill('Hi world');self.page.locator('.lyric-row textarea').first.press('Tab');self.assertEqual(self.page.evaluate('projectStore.state.subtitleTracks[1].lyrics.lines[0].text'),'Hi world')
            panel.locator('.subtitle-active').select_option(original);self.assertEqual(self.page.evaluate('projectStore.state.lyrics.lines[0].text'),'Merhaba dünya');panel.locator('.subtitle-active').select_option(english);self.assertEqual(self.page.evaluate('projectStore.state.lyrics.lines[0].text'),'Hi world')
            saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())');self.page.evaluate('value=>openStudioProject(JSON.parse(value))',saved);wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            for scheme in ['dark','light']:
                self.page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertTrue(panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1'));self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))

    def test_subtitle_languages_ripple_all_languages_and_translation_cancel(self):
        with self.open_ripple_editor() as ripple:
            self.page.evaluate('projectStore.update(p=>{addSubtitleTrack(p,"English","en",{...p.lyrics,lines:p.lyrics.lines.map(r=>({...r,text:"one two three"}))});});')
            ripple.locator('[data-ripple-operation="remove"]').click();wait_for_browser(self.page,'!rippleEditor.busy && projectStore.state.lyrics.timeBase==="project"')
            p=self.page.evaluate('projectStore.snapshot()');self.assertEqual(p['subtitleTracks'][0]['lyrics']['timeBase'],'project');self.assertEqual([r['start'] for r in p['subtitleTracks'][0]['lyrics']['lines']],[0,.5])
            self.page.evaluate('selectSidebarTab("lyrics");subtitleTrackEditor.panel.open=true');panel=self.page.locator('.subtitle-track-editor');before=self.page.evaluate('JSON.stringify(projectStore.snapshot())');panel.locator('.subtitle-translate').click();panel.locator('[data-translation-row="0"]').fill('Draft');panel.locator('.subtitle-discard').click();self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before)

    def test_title_designer_styles_presets_independence_history_reopen_and_responsive(self):
        with self.open_visual_layers() as layers:
            self.page.evaluate('visualLayerEditor.titles.panel.open=true');panel=layers.locator('.title-editor');history=self.page.evaluate('projectStore.past.length');panel.locator('.title-add').click();self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            run=panel.locator('[data-title-row="0"][data-title-run="0"]');run.locator('[data-title-run-field="text"]').fill('İlk başlık');run.locator('[data-title-run-field="text"]').press('Tab')
            panel.locator('.title-run-add').first.click();run=panel.locator('[data-title-row="0"][data-title-run="1"]');run.locator('[data-title-run-field="color"]').fill('#ff0000');run.locator('[data-title-run-field="color"]').dispatch_event('change');run.locator('[data-title-run-field="bold"]').check()
            self.assertEqual(self.page.evaluate('visualLayerEditor.target().title.rows[0][1].color'),'#ff0000');panel.locator('[data-title-field="icon"]').select_option('music');panel.locator('[data-title-field="enter"]').select_option('wipe')
            panel.locator('.title-preset-name').fill('Alt bant A');panel.locator('.title-save').click();self.assertEqual(self.page.evaluate('projectStore.state.titlePresets.length'),1)
            panel.locator('.title-preset-add').click();self.assertEqual(self.page.evaluate('projectStore.state.visualLayers.length'),2)
            run=panel.locator('[data-title-row="0"][data-title-run="0"]');run.locator('[data-title-run-field="text"]').fill('İkinci başlık');run.locator('[data-title-run-field="text"]').press('Tab')
            self.assertEqual(self.page.evaluate('projectStore.state.visualLayers[0].title.rows[0][0].text'),'İlk başlık');self.assertEqual(self.page.evaluate('projectStore.state.titlePresets[0].title.rows[0][0].text'),'İlk başlık')
            panel.locator('.title-preset-update').click();self.assertEqual(self.page.evaluate('projectStore.state.titlePresets[0].title.rows[0][0].text'),'İkinci başlık')
            saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())');self.page.evaluate('projectStore.undo();projectStore.redo()');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            self.page.evaluate('value=>openStudioProject(JSON.parse(value))',saved);wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy && videoPreview.visuals.isReady()');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            for scheme in ['dark','light']:
                self.page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertTrue(panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1'));self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.page.evaluate('projectStore.update(p=>{p.visualLayers.at(-1).locked=true;})');self.assertTrue(panel.locator('.title-row-add').is_disabled())

    def test_particles_presets_editing_seek_pixels_undo_reopen_and_responsive(self):
        with self.open_visual_layers() as layers:
            self.page.evaluate('visualLayerEditor.particles.panel.open=true');panel=layers.locator('.particle-editor')
            for style in ['spark','snow','glow']:
                history=self.page.evaluate('projectStore.past.length');panel.locator('.particle-add-'+style).click();self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
                self.assertEqual(self.page.evaluate('visualLayerEditor.target().particles.style'),style)
            panel.locator('[data-particle-field="band"]').select_option('treble');panel.locator('[data-particle-field="speed"]').fill('22.345');panel.locator('[data-particle-field="speed"]').press('Tab')
            self.assertEqual(self.page.evaluate('visualLayerEditor.target().particles.speed'),22.345)
            pixels=self.page.evaluate('''() => {const r=new ParticleRenderer(),l={id:'p',offset:0,width:100,particles:validateParticles({style:'snow',density:150,reactivity:100,band:'treble'})};const read=(t,signal)=>{const c=r.source(l,320,240,t,signal);return Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data);};const a=read(1,{treble:1});read(5,{treble:.5});const b=read(1,{treble:1}),silent=read(1,{treble:0,bass:1});return [a.every((v,i)=>v===b[i]),a.some(v=>v>0),silent.every(v=>v===0)];}''')
            self.assertEqual(pixels,[True,True,True]);saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())');self.page.evaluate('projectStore.undo();projectStore.redo()');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            self.page.evaluate('value=>openStudioProject(JSON.parse(value))',saved);wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            for scheme in ['dark','light']:
                self.page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertTrue(panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1'));self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.page.evaluate('projectStore.update(p=>{p.visualLayers.at(-1).locked=true;})');self.assertTrue(panel.locator('[data-particle-field="density"]').is_disabled())

    def test_vector_shapes_creation_path_editing_history_reopen_and_responsive(self):
        with self.open_visual_layers() as layers:
            self.page.evaluate('visualLayerEditor.shapes.panel.open=true');panel=layers.locator('.vector-shape-editor')
            for kind in ['rectangle','ellipse','arrow','path']:
                history=self.page.evaluate('projectStore.past.length');panel.locator('.shape-add-'+kind).click()
                self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
                self.assertEqual(self.page.evaluate('visualLayerEditor.shapes.target().item.shape.kind'),kind)
            panel.locator('[data-shape-point="4"]').fill('20');panel.locator('[data-shape-point="4"]').press('Tab')
            panel.locator('[data-shape-point="5"]').fill('-30');panel.locator('[data-shape-point="5"]').press('Tab')
            history=self.page.evaluate('projectStore.past.length');panel.locator('.shape-point-add').click()
            self.assertEqual(self.page.evaluate('visualLayerEditor.shapes.shape().points.length'),3);self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            handle=panel.locator('[data-shape-index="1"][data-shape-handle="node"]');x=self.page.evaluate('visualLayerEditor.shapes.shape().points[1][0]');handle.press('ArrowRight')
            self.assertAlmostEqual(self.page.evaluate('visualLayerEditor.shapes.shape().points[1][0]'),x+.1)
            history=self.page.evaluate('projectStore.past.length');self.page.evaluate('draftShape=copyProject(visualLayerEditor.shapes.shape());draftShape.points[0][0]=22;visualLayerEditor.shapes.preview(draftShape)')
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history);saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())');self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.page.evaluate('draftShape.points[0][0]=30;visualLayerEditor.shapes.preview(draftShape)');panel.locator('.shape-kind').press('Escape');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            self.page.evaluate('value=>openStudioProject(JSON.parse(value))',saved);wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            for scheme in ['dark','light']:
                self.page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertTrue(panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1'));self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.page.evaluate('projectStore.update(p=>{p.visualLayers.at(-1).locked=true;})');self.assertTrue(panel.locator('.shape-point-add').is_disabled())

    def test_vector_shapes_freehand_drag_cancel_and_generated_preview_pixels(self):
        with self.open_visual_layers() as layers:
            self.page.evaluate('visualLayerEditor.shapes.panel.open=true');panel=layers.locator('.vector-shape-editor');panel.locator('.shape-add-path').click();panel.locator('.shape-pencil').click()
            stage=panel.locator('.vector-shape-stage');stage.scroll_into_view_if_needed();rect=stage.bounding_box();history=self.page.evaluate('projectStore.past.length')
            self.page.mouse.move(rect['x']+rect['width']*.15,rect['y']+rect['height']*.4);self.page.mouse.down()
            for x,y in [(.3,.2),(.5,.4),(.7,.7),(.85,.6)]:self.page.mouse.move(rect['x']+rect['width']*x,rect['y']+rect['height']*y,steps=3)
            self.assertIsNotNone(self.page.evaluate('videoPreview.shapeDraft'));self.page.mouse.up();self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertGreater(self.page.evaluate('visualLayerEditor.shapes.shape().points.length'),2);panel.locator('.shape-pencil').click()
            handle=panel.locator('[data-shape-index="0"][data-shape-handle="node"]');handle.scroll_into_view_if_needed();box=handle.bounding_box();saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())')
            self.page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);self.page.mouse.down();self.page.mouse.move(box['x']+30,box['y']+10,steps=3)
            self.assertIsNotNone(self.page.evaluate('videoPreview.shapeDraft'));self.page.keyboard.press('Escape');self.page.mouse.up();self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            pixels=self.page.evaluate('''() => {const r=new VectorShapeRenderer(),l={id:'test',width:50,offset:0,shape:validateShape({drawDuration:1,fillColor:'#ff0000',strokeWidth:20})};const read=t=>{const c=r.source(l,320,240,t),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return Array.from(d).filter((_,i)=>i%4===3&&d[i]>0).length;};return [read(0),read(.5),read(1)];}''')
            self.assertEqual(pixels[0],0);self.assertGreater(pixels[1],50);self.assertGreater(pixels[2],pixels[1]*5)

    def test_motion_path_layer_drag_one_undo_and_responsive_controls(self):
        with self.open_visual_layers() as layers:
            layers.locator('.visual-add-text').click();self.page.evaluate('visualLayerEditor.motion.panel.open=true;audioEngine.seekProjectTime(0)');panel=layers.locator('.motion-path-editor');panel.locator('.motion-add').click()
            handle=panel.locator('.motion-handle-node');handle.scroll_into_view_if_needed();rect=panel.locator('.motion-path-stage').bounding_box();history=self.page.evaluate('projectStore.past.length')
            self.page.mouse.move(rect['x']+rect['width']*.5,rect['y']+rect['height']*.5);self.page.mouse.down();self.page.mouse.move(rect['x']+rect['width']*.7,rect['y']+rect['height']*.4,steps=4)
            self.assertIsNotNone(self.page.evaluate('videoPreview.motionDraft'));self.page.mouse.up();self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.visualLayers[0].motionPath.nodes[0][1]'),20,delta=1)
            self.page.evaluate('projectStore.undo()');self.assertEqual(self.page.evaluate('projectStore.state.visualLayers[0].motionPath.nodes[0][1]'),0)
            for scheme in ['dark','light']:
                self.page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertTrue(panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1'));self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.page.evaluate('projectStore.update(p=>{p.visualLayers[0].locked=true;})');self.assertTrue(panel.locator('.motion-add').is_disabled())

    def test_perspective_gpu_cpu_homography_alpha_and_color_orientation(self):
        result=self.page.evaluate('''() => {
          const source=document.createElement('canvas');source.width=64;source.height=48;const ctx=source.getContext('2d');
          const data=ctx.createImageData(64,48);for(let y=0;y<48;y++)for(let x=0;x<64;x++){const i=(y*64+x)*4;data.data.set([x*4,y*5,50,180],i);}ctx.putImageData(data,0,0);
          const settings=validatePerspective({enabled:true,points:[[20,10],[80,20],[90,90],[10,80]]}),gpu=new PerspectiveRenderer(),cpu=new PerspectiveRenderer({backend:'cpu'});
          gpu.beginFrame();cpu.beginFrame();const read=c=>Array.from(c.getContext('2d').getImageData(0,0,64,48).data),a=read(gpu.source(source,settings,0,0)),b=read(cpu.source(source,settings,0,0));
          return {gpu:!!gpu.gl,max:Math.max(...a.map((v,i)=>Math.abs(v-b[i]))),outside:a[3],center:a.slice((24*64+32)*4,(24*64+32)*4+4),error:gpu.gl?.getError()};
        }''')
        self.assertTrue(result['gpu']);self.assertEqual(result['error'],0);self.assertLessEqual(result['max'],4);self.assertEqual(result['outside'],0)
        self.assertAlmostEqual(result['center'][3],180,delta=2);self.assertGreater(result['center'][0],90);self.assertGreater(result['center'][1],90)

    def test_perspective_clip_handles_keys_snapshot_cancel_lock_and_reopen(self):
        with self.open_transition_editor():
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id);videoClipEditor.perspective.panel.open=true;audioEngine.seekProjectTime(0)')
            panel=self.page.locator('.clip-editor .perspective-editor');panel.locator('.perspective-enabled').check()
            field=panel.locator('input[data-corner="0"][data-axis="0"]');field.fill('12.345');field.press('Tab')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].perspective.points[0][0]'),12.345)
            panel.locator('.perspective-add-key').click();self.page.evaluate('audioEngine.seekProjectTime(.5)');panel.locator('.perspective-add-key').click()
            panel.locator('input[data-corner="1"][data-axis="0"]').fill('75');panel.locator('input[data-corner="1"][data-axis="0"]').press('Tab')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].perspective.keys[1][1][1][0]'),75)
            history=self.page.evaluate('projectStore.past.length');self.page.evaluate('videoClipEditor.perspective.preview([[15,10],[80,10],[90,90],[10,90]])')
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history);self.assertIsNotNone(self.page.evaluate('videoPreview.perspectiveDraft'))
            saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())');self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1);self.assertIsNone(self.page.evaluate('videoPreview.perspectiveDraft'))
            self.page.evaluate('videoClipEditor.perspective.preview([[20,20],[80,20],[80,80],[20,80]])');panel.locator('.perspective-handle').first.press('Escape')
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            handle=panel.locator('.perspective-handle').first;handle.press('ArrowRight');self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[0].perspective.keys[1][1][0][0]'),15.1)
            self.page.evaluate('projectStore.undo()');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            self.page.evaluate('projectStore.update(p=>{p.video.groupLocked=true;})');self.assertTrue(panel.locator('.perspective-add-key').is_disabled())
            self.page.evaluate('value=>openStudioProject(JSON.parse(value))',saved);wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)

    def test_perspective_layer_drag_cancel_and_responsive_geometry(self):
        with self.open_visual_layers() as layers:
            layers.locator('.visual-files').set_input_files(str(self.visual_image));wait_for_browser(self.page,'projectStore.state.visualLayers.length===1 && videoPreview.visuals.isReady()')
            self.page.evaluate('visualLayerEditor.perspective.panel.open=true');panel=layers.locator('.perspective-editor');handle=panel.locator('.perspective-handle').first
            handle.scroll_into_view_if_needed();rect=panel.locator('.perspective-stage').bounding_box();history=self.page.evaluate('projectStore.past.length')
            self.page.mouse.move(rect['x'],rect['y']);self.page.mouse.down();self.page.mouse.move(rect['x']+rect['width']*.2,rect['y']+rect['height']*.2,steps=5)
            self.assertIsNotNone(self.page.evaluate('videoPreview.perspectiveDraft'));self.page.mouse.up();self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.visualLayers[0].perspective.points[0][0]'),20,delta=1)
            for scheme in ['dark','light']:
                self.page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertTrue(panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1'));self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.page.evaluate('projectStore.update(p=>{p.visualLayers[0].locked=true;})');self.assertTrue(panel.locator('.perspective-enabled').is_disabled())

    def test_lut_gpu_cpu_float_interpolation_order_intensity_and_alpha(self):
        result=self.page.evaluate('''() => {
          const source=document.createElement('canvas');source.width=8;source.height=4;const ctx=source.getContext('2d');
          for(let x=0;x<8;x++){ctx.fillStyle=`rgba(${20+x*25},${190-x*12},${40+x*15},${x===7?.5:1})`;ctx.fillRect(x,0,1,4);}
          const table=validateLutTable({id:'inverse',name:'Ters',size:2,domainMin:[-.1,-.1,-.1],domainMax:[1.1,1.1,1.1],data:Array.from({length:8},(_,i)=>[1-i%2,1-Math.floor(i/2)%2,1-Math.floor(i/4)]).flat()});
          const gpu=new ClipColorRenderer(),cpu=new ClipColorRenderer({backend:'cpu'}),color=validateClipColor({gamma:1.7}),read=c=>Array.from(c.getContext('2d').getImageData(0,0,8,4).data);
          let max=0;const outputs=[];
          for(const order of ['before','after'])for(const intensity of [25,100]){gpu.beginFrame();cpu.beginFrame();const lut={table,settings:{enabled:true,table:table.id,intensity,order}},a=read(gpu.source(source,color,0,null,lut)),b=read(cpu.source(source,color,0,null,lut));max=Math.max(max,...a.map((v,i)=>Math.abs(v-b[i])));outputs.push(a[0]);}
          return {max,gpu:!!gpu.gl,float:gpu.floatTextures,orderDifference:Math.abs(outputs[1]-outputs[3])};
        }''')
        self.assertTrue(result['gpu']);self.assertTrue(result['float']);self.assertLessEqual(result['max'],4);self.assertGreater(result['orderDifference'],10)

    def test_lut_import_precision_draft_snapshot_compare_undo_remove_and_reopen(self):
        with self.open_transition_editor():
            path=Path(self.temporary.name)/'inverse.cube';rows=[' '.join(str(1-v) for v in [i%2,(i//2)%2,i//4]) for i in range(8)]
            path.write_text('TITLE "Ters renk"\nLUT_3D_SIZE 2\n'+'\n'.join(rows),encoding='utf8')
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id);videoClipEditor.lut.panel.open=true')
            panel=self.page.locator('.lut-editor');history=self.page.evaluate('projectStore.past.length');panel.locator('.lut-file').set_input_files(str(path))
            wait_for_browser(self.page,'projectStore.state.luts.length===1 && !videoClipEditor.lut.busy')
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertTrue(panel.locator('.lut-enabled').is_checked());panel.locator('.lut-order').select_option('before')
            history=self.page.evaluate('projectStore.past.length')
            panel.locator('.lut-intensity-range').evaluate("e=>{e.value='32.5';e.dispatchEvent(new Event('input',{bubbles:true}));}")
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history);self.assertIsNotNone(self.page.evaluate('videoPreview.lutDraft'))
            saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())');self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].lut.intensity'),32.5)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1);self.assertIsNone(self.page.evaluate('videoPreview.lutDraft'))
            panel.locator('.lut-compare').click();self.assertTrue(self.page.evaluate('videoPreview.colorComparison!==null'));panel.locator('.lut-compare').click()
            panel.locator('.lut-remove').click();self.assertEqual(self.page.evaluate('projectStore.state.luts.length'),0);self.assertFalse(panel.locator('.lut-enabled').is_checked())
            self.page.evaluate('projectStore.undo()');self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            self.page.evaluate('value=>openStudioProject(JSON.parse(value))',saved);wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            panel.locator('.lut-intensity-range').evaluate("e=>{e.value='80';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('pointercancel',{bubbles:true}));}")
            self.assertIsNone(self.page.evaluate('videoPreview.lutDraft'));self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].lut.intensity'),32.5)

    def test_lut_import_errors_lock_and_responsive_controls(self):
        with self.open_transition_editor():
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id);videoClipEditor.lut.panel.open=true')
            panel=self.page.locator('.lut-editor');path=Path(self.temporary.name)/'unsupported.cube';path.write_text('LUT_1D_SIZE 2\n0 0 0\n1 1 1',encoding='utf8')
            panel.locator('.lut-file').set_input_files(str(path));wait_for_browser(self.page,"!videoClipEditor.lut.busy && document.querySelector('.lut-status').textContent.includes('desteklenmiyor')")
            self.assertEqual(self.page.evaluate('projectStore.state.luts.length'),0)
            self.page.evaluate('projectStore.update(p=>{p.video.groupLocked=true;})');self.assertTrue(panel.locator('.lut-import').is_disabled())
            self.page.evaluate('projectStore.update(p=>{p.video.groupLocked=false;})')
            for scheme in ['dark','light']:
                self.page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertTrue(panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1'));self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))

    def test_color_scopes_final_composition_includes_overlay_and_histogram_primaries(self):
        with self.open_transition_editor():
            self.page.locator('[data-mode="videofx"]').click();self.page.evaluate('colorScopeEditor.panel.open=true')
            wait_for_browser(self.page,'colorScopeEditor.measurement!==null')
            history=self.page.evaluate('projectStore.past.length')
            result=self.page.evaluate('''() => {
              colorScopeEditor.frozen=true;colorScopeEditor.cancel();const base=videoPreview.canvas,ctx=base.getContext('2d');ctx.fillStyle='#00ff00';ctx.fillRect(0,0,base.width,base.height);
              const overlay=document.getElementById('overlayCanvas'),paint=overlay.getContext('2d');paint.clearRect(0,0,overlay.width,overlay.height);paint.fillStyle='#ff0000';paint.fillRect(0,0,overlay.width/2,overlay.height);
              const lyrics=document.getElementById('lyricsCanvas');lyrics.getContext('2d').clearRect(0,0,lyrics.width,lyrics.height);colorScopeEditor.measure();const m=colorScopeEditor.measurement;
              return {count:m.count,red:m.histograms[0][255],green:m.histograms[1][255],parade:m.parade.reduce((a,b)=>a+b,0)};
            }''')
            self.assertEqual(result['count'],36864);self.assertEqual(result['parade'],110592)
            # Scaling the small preview antialiases two columns at the color boundary.
            self.assertAlmostEqual(result['red'],18432,delta=288);self.assertAlmostEqual(result['green'],18432,delta=288)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            self.assertEqual(self.page.locator('.scope-grid canvas').count(),4)
            self.page.evaluate('videoPreview.draw()')

    def test_color_scopes_clip_live_seek_freeze_refresh_and_responsive(self):
        with self.open_transition_editor():
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id);audioEngine.seekProjectTime(.25)')
            self.page.locator('[data-mode="videofx"]').click();self.page.evaluate('colorScopeEditor.panel.open=true')
            panel=self.page.locator('.color-scopes');panel.locator('.scope-source').select_option('selected')
            wait_for_browser(self.page,'colorScopeEditor.measurement!==null')
            panel.locator('.scope-refresh').click();before=self.page.evaluate('colorScopeEditor.measurement.mean');history=self.page.evaluate('projectStore.past.length')
            panel.locator('.scope-freeze').click();self.page.evaluate('audioEngine.seekProjectTime(1.25)')
            wait_for_browser(self.page,'!videoPreview.clips.entries[0].video.seeking && videoPreview.clips.entries[0].video.currentTime>1.1')
            self.assertEqual(self.page.evaluate('colorScopeEditor.measurement.mean'),before)
            panel.locator('.scope-refresh').click();wait_for_browser(self.page,f'Math.abs(colorScopeEditor.measurement.mean-{before})>5')
            panel.locator('.scope-log').uncheck();panel.locator('.scope-freeze').click()
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            for scheme in ['dark','light']:
                self.page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertTrue(panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1'));self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            panel.locator('summary').click();wait_for_browser(self.page,'colorScopeEditor.requested===null')

    def test_chroma_key_gpu_cpu_alpha_soft_edges_despill_and_color_bypass(self):
        result=self.page.evaluate('''() => {
          const source=document.createElement('canvas');source.width=8;source.height=2;const ctx=source.getContext('2d');
          const colors=['#00ff00','#00cc00','#ff0000','#0000ff','#b3e6b3','#ffffff','#102030','#406080'];
          colors.forEach((color,i)=>{ctx.fillStyle=color;ctx.fillRect(i,0,1,2);});
          const key=validateChromaKey({enabled:true,tolerance:10,softness:20,despill:100}),color=validateClipColor({});
          const gpu=new ClipColorRenderer(),cpu=new ClipColorRenderer({backend:'cpu'});gpu.beginFrame();cpu.beginFrame();
          const read=canvas=>Array.from(canvas.getContext('2d').getImageData(0,0,8,2).data);
          const a=read(gpu.source(source,color,0,key)),b=read(cpu.source(source,color,0,key));
          const disabled=validateClipColor({enabled:false,exposure:2});gpu.beginFrame();const bypass=read(gpu.source(source,disabled,0,key));
          return {gpu:!!gpu.gl,max:Math.max(...a.map((v,i)=>Math.abs(v-b[i]))),alpha:a[3],softAlpha:a[7],red:a[8],greenSpill:a[17],colorBypass:Math.max(...a.map((v,i)=>Math.abs(v-bypass[i])))};
        }''')
        self.assertTrue(result['gpu']);self.assertLessEqual(result['max'],4);self.assertEqual(result['alpha'],0)
        self.assertAlmostEqual(result['softAlpha'],128,delta=3);self.assertGreater(result['red'],250);self.assertAlmostEqual(result['greenSpill'],179,delta=2);self.assertEqual(result['colorBypass'],0)

    def test_chroma_clip_original_frame_picker_numeric_controls_undo_and_cancel(self):
        with self.open_transition_editor():
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id);videoClipEditor.chroma.panel.open=true')
            panel=self.page.locator('.clip-editor .chroma-key-editor');panel.locator('.chroma-enabled').check()
            history=self.page.evaluate('projectStore.past.length');panel.locator('.chroma-tolerance').fill('12.345');panel.locator('.chroma-tolerance').press('Tab')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].chroma.tolerance'),12.345);self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            panel.locator('.chroma-pick').click();self.assertTrue(panel.locator('.chroma-picker').is_visible())
            self.page.evaluate('videoClipEditor.chroma.canvas.getContext("2d").fillStyle="#19cf27";videoClipEditor.chroma.canvas.getContext("2d").fillRect(0,0,1,1)')
            panel.locator('.chroma-pick-x').fill('0');panel.locator('.chroma-pick-y').fill('0');panel.locator('.chroma-sample').click()
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].chroma.color'),'#19cf27')
            saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())');self.page.evaluate('projectStore.undo();projectStore.redo()')
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),saved)
            panel.locator('.chroma-pick').click();panel.locator('canvas').press('Escape');self.assertTrue(panel.locator('.chroma-picker').is_hidden())
            self.page.evaluate('projectStore.update(p=>{p.video.groupLocked=true;})');self.assertTrue(panel.locator('.chroma-pick').is_disabled())
            self.page.evaluate('value=>openStudioProject(JSON.parse(value))',saved);wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].chroma.color'),'#19cf27')

    def test_chroma_layer_picker_locks_and_responsive_controls(self):
        from PIL import Image
        with self.open_visual_layers() as layers:
            path=Path(self.temporary.name)/'green-key.png';Image.new('RGB',(64,32),'#00ff00').save(path)
            layers.locator('.visual-files').set_input_files(str(path));wait_for_browser(self.page,'projectStore.state.visualLayers.length===1 && videoPreview.visuals.isReady()')
            self.page.evaluate('visualLayerEditor.chroma.panel.open=true');panel=layers.locator('.chroma-key-editor')
            panel.locator('.chroma-pick').click();panel.locator('canvas').click(position=dict(x=10,y=10))
            self.assertEqual(self.page.evaluate('projectStore.state.visualLayers[0].chroma.color'),'#00ff00')
            panel.locator('.chroma-enabled').check();panel.locator('.chroma-despill').fill('77.25');panel.locator('.chroma-despill').press('Tab')
            self.assertEqual(self.page.evaluate('projectStore.state.visualLayers[0].chroma.despill'),77.25)
            for scheme in ['dark','light']:
                self.page.emulate_media(color_scheme=scheme,reduced_motion='reduce')
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertTrue(panel.evaluate('e=>e.scrollWidth<=e.clientWidth+1'));self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'))
            self.page.evaluate('projectStore.update(p=>{p.visualLayers[0].locked=true;})');self.assertTrue(panel.locator('.chroma-enabled').is_disabled())
            layers.locator('.visual-add-text').click();self.assertTrue(panel.locator('.chroma-pick').is_disabled())

    def test_clip_color_gpu_cpu_parity_sharp_curves_and_alpha(self):
        warnings=[]
        self.page.on('console',lambda message:warnings.append(message.text) if message.type=='warning' else None)
        result=self.page.evaluate('''() => {
          const canvas=document.createElement('canvas');canvas.width=257;canvas.height=3;
          const ctx=canvas.getContext('2d'),image=ctx.createImageData(canvas.width,canvas.height);
          for(let i=0;i<image.data.length;i+=4){image.data[i]=(i*13)%256;image.data[i+1]=(i*29+17)%256;image.data[i+2]=(i*43+51)%256;image.data[i+3]=i%12?255:128;}
          ctx.putImageData(image,0,0);
          const gpu=new ClipColorRenderer(),cpu=new ClipColorRenderer({backend:'cpu'});
          const profiles=[{exposure:.43,temperature:34,tint:-19,shadows:18,midtones:-12,highlights:8,gamma:1.7,saturation:.8,contrast:1.2},
            {gamma:.25,exposure:-.6,curves:{rgb:[[0,.1],[.5,.2],[.501,.9],[1,.8]],red:[[0,1],[1,0]],blue:[[0,.1],[.6,.9],[1,1]]}},
            {gamma:3,exposure:2.9,contrast:.2,saturation:2,temperature:-99,tint:98,brightness:-.49},
            {curves:{rgb:Array.from({length:16},(_,i)=>[i/15,Math.sin(i/15*Math.PI)*.8])}}];
          let max=0,alpha=0,cached=true;
          for(const input of profiles) {
            const color=validateClipColor(input);gpu.beginFrame();cpu.beginFrame();
            const a=gpu.source(canvas,color,0),b=cpu.source(canvas,color,0),before=a.toDataURL();
            gpu.source(canvas,validateClipColor({saturation:0}),1);cached&&=a.toDataURL()===before&&gpu.source(canvas,color,0)===a;
            const x=a.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,y=b.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
            for(let i=0;i<x.length;i++){if(i%4===3)alpha=Math.max(alpha,Math.abs(x[i]-y[i]));else max=Math.max(max,Math.abs(x[i]-y[i]));}
          }
          return {gpu:!!gpu.gl,max,alpha,cached,neutral:gpu.source(canvas,validateClipColor({}),3)===canvas};
        }''')
        self.assertTrue(result['gpu'],(result,warnings))
        self.assertLessEqual(result['max'],2,result)
        self.assertLessEqual(result['alpha'],1,result)
        self.assertTrue(result['cached']);self.assertTrue(result['neutral'])

    def test_clip_color_controls_copy_presets_one_undo_snapshot_and_reopen(self):
        with self.open_transition_editor():
            self.page.evaluate('videoClipEditor.color.panel.open=true')
            panel=self.page.locator('.clip-color-editor')
            panel.locator('.color-preset').select_option('warm')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[1].color.temperature'),30)
            before=self.page.evaluate('projectStore.snapshot()');history=self.page.evaluate('projectStore.past.length')
            panel.locator('.color-exposure-range').evaluate('(el)=>{el.value=1.23;el.dispatchEvent(new Event("input"));}')
            self.assertEqual(self.page.evaluate('projectStore.state'),before)
            self.assertEqual(self.page.evaluate('videoPreview.colorDraft.color.exposure'),1.23)
            panel.locator('.color-exposure-range').dispatch_event('change')
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertEqual(panel.locator('.color-exposure-number').input_value(),'1.23')
            self.page.evaluate('projectStore.undo()');self.assertEqual(self.page.evaluate('projectStore.state'),before)
            self.page.evaluate('projectStore.redo()')
            panel.locator('.color-tint-number').fill('-12.3');panel.locator('.color-tint-number').press('Tab')
            expected=self.page.evaluate('copyProject(projectStore.state.videoClips[1].color)')
            panel.locator('.color-enabled').uncheck()
            disabled={**expected,'enabled':False}
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[1].color'),disabled)
            panel.locator('.color-enabled').check()
            panel.locator('.color-copy').click()
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id)')
            panel.locator('.color-paste').click()
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].color'),expected)
            self.page.evaluate('projectStore.undo()')
            self.page.evaluate("videoClipEditor.select('transition-second')")
            history=self.page.evaluate('projectStore.past.length')
            panel.locator('.color-apply-others').click()
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].color'),expected)
            panel.locator('.color-gamma-range').evaluate('(el)=>{el.value=1.45;el.dispatchEvent(new Event("input"));}')
            saved=self.page.evaluate('projectStore.snapshot()')
            self.assertEqual(saved['videoClips'][1]['color']['gamma'],1.45)
            self.assertIsNone(self.page.evaluate('videoPreview.colorDraft'))
            self.page.evaluate('p=>projectStore.replace(p)',saved)
            self.assertEqual(self.page.evaluate('projectStore.snapshot()'),saved)
            self.page.evaluate('videoClipEditor.command("duplicate")')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips.at(-1).color'),saved['videoClips'][1]['color'])

    def test_clip_color_curves_drag_cancel_keyboard_precision_and_snapshot(self):
        with self.open_transition_editor():
            self.page.evaluate('videoClipEditor.color.panel.open=true;videoClipEditor.color.curve.panel.open=true')
            panel=self.page.locator('.color-curves');graph=panel.locator('.color-curve-graph')
            graph.scroll_into_view_if_needed();box=graph.bounding_box()
            x=box['x']+box['width']*.5;y=box['y']+box['height']*.4
            before=self.page.evaluate('projectStore.snapshot()');history=self.page.evaluate('projectStore.past.length')
            self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+10,y-10)
            self.assertEqual(self.page.evaluate('projectStore.state'),before)
            self.assertEqual(self.page.evaluate('videoPreview.colorDraft.color.curves.rgb.length'),3)
            self.page.keyboard.press('Escape');self.page.mouse.up()
            self.assertEqual(self.page.evaluate('projectStore.state'),before)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            self.assertIsNone(self.page.evaluate('videoPreview.colorDraft'))
            self.page.mouse.click(x,y)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            point=panel.locator('[data-color-point="1"]')
            initial=self.page.evaluate('projectStore.state.videoClips[1].color.curves.rgb[1][1]')
            point.press('Alt+ArrowUp')
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[1].color.curves.rgb[1][1]'),initial+.001)
            panel.locator('.color-point-x').fill('50.125');panel.locator('.color-point-x').press('Tab')
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[1].color.curves.rgb[1][0]'),.50125)
            panel.locator('.color-channel').select_option('red')
            panel.locator('[data-color-point="0"]').focus()
            self.assertTrue(panel.locator('.color-point-x').is_disabled())
            panel.locator('.color-point-y').fill('12.5');panel.locator('.color-point-y').press('Tab')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[1].color.curves.red[0]'),[0,.125])
            panel.locator('.color-channel').select_option('rgb')
            panel.locator('[data-color-point="1"]').press('Delete')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[1].color.curves.rgb.length'),2)
            graph.scroll_into_view_if_needed();box=graph.bounding_box()
            self.page.mouse.move(box['x']+box['width']*.5,box['y']+box['height']*.4);self.page.mouse.down()
            saved=self.page.evaluate('projectStore.snapshot()');self.page.mouse.up()
            self.assertEqual(len(saved['videoClips'][1]['color']['curves']['rgb']),3)
            self.assertIsNone(self.page.evaluate('videoPreview.colorDraft'))

    def test_clip_color_comparison_pixels_selected_clip_only_and_no_project_history(self):
        with self.open_transition_editor():
            self.page.evaluate('''projectStore.update(p=>{p.videoClips[0].color=validateClipColor({exposure:.5,temperature:40});
              p.videoClips[1].color=validateClipColor({saturation:0,exposure:-.5});p.video.contrast=1.2;});
              videoClipEditor.color.panel.open=true;audioEngine.seekProjectTime(1.75);''')
            wait_for_browser(self.page,'videoPreview.ready&&!videoPreview.busy&&videoPreview.clips.entries.every(e=>!e.video.seeking)')
            panel=self.page.locator('.clip-color-editor');before=self.page.evaluate('projectStore.snapshot()');history=self.page.evaluate('projectStore.past.length')
            panel.locator('.color-compare').check()
            self.assertTrue(self.page.locator('.color-comparison').is_visible())
            result=self.page.evaluate('''() => {
              const p=copyProject(projectStore.state),entries=videoPreview.clips.entries,time=audioEngine.getProjectTime(),
                signal=audioEngine.visualSignal(),canvas=document.createElement('canvas'),renderer=new SceneRenderer(canvas,{layers:false});
              const read=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
              const draw=project=>{renderer.draw(project,entries.map(e=>e.info),entries.map(e=>e.video),time,null,null,signal);return new Uint8ClampedArray(read(canvas));};
              const after=draw(p);p.videoClips[1].color.enabled=false;const before=draw(p);
              let diff=0,visibleChange=0;
              for(const position of [0,.5,1]) {
                videoClipEditor.color.comparison.set(position);const actual=read(videoPreview.canvas),w=canvas.width,split=Math.round(w*position);
                for(let i=0;i<actual.length;i++){const expected=(Math.floor(i/4)%w<split?before:after)[i];diff=Math.max(diff,Math.abs(actual[i]-expected));visibleChange+=Math.abs(before[i]-after[i]);}
              }return {diff,visibleChange};
            }''')
            self.assertEqual(result['diff'],0,result);self.assertGreater(result['visibleChange'],1000)
            self.page.locator('.color-divider button').press('Home')
            self.assertEqual(self.page.evaluate('videoPreview.colorComparison.position'),0)
            self.page.locator('.color-divider button').press('Shift+ArrowRight')
            self.assertAlmostEqual(self.page.evaluate('videoPreview.colorComparison.position'),.1)
            handle=self.page.locator('.color-divider button');handle.scroll_into_view_if_needed();box=handle.bounding_box()
            self.page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);self.page.mouse.down();self.page.mouse.move(box['x']+80,box['y']+box['height']/2)
            self.page.keyboard.press('Escape');self.page.mouse.up()
            self.assertAlmostEqual(self.page.evaluate('videoPreview.colorComparison.position'),.1)
            self.assertEqual(self.page.evaluate('projectStore.snapshot()'),before)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            self.page.evaluate('window.selectSidebarTab("main")')
            self.assertIsNone(self.page.evaluate('videoPreview.colorComparison'))
            self.assertTrue(self.page.locator('.color-comparison').is_hidden())

    def test_single_background_color_inheritance_and_external_draft_cancellation(self):
        with self.open_transition_editor():
            self.page.evaluate('''projectStore.update(p=>{p.videoClips=[];p.video.color=validateClipColor({temperature:25,curves:{blue:[[0,.1],[1,.9]]}});});
              videoClipEditor.color.panel.open=true;''')
            wait_for_browser(self.page,'videoPreview.ready&&!videoPreview.busy')
            expected=self.page.evaluate('copyProject(projectStore.state.video.color)')
            self.page.locator('.color-exposure-number').fill('.35');self.page.locator('.color-exposure-number').press('Tab')
            expected['exposure']=.35
            self.page.evaluate('mediaLibrary.addVideo(projectStore.state.background.asset)')
            wait_for_browser(self.page,'videoPreview.ready&&!videoPreview.busy')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].color'),expected)
            self.assertTrue(self.page.evaluate('clipColorNeutral(projectStore.state.videoClips[1].color)'))
            self.page.locator('.color-exposure-range').evaluate('(el)=>{el.value=2;el.dispatchEvent(new Event("input"));}')
            self.page.evaluate('projectStore.update(p=>{p.video.rotation=15;})')
            self.assertIsNone(self.page.evaluate('videoPreview.colorDraft'))
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].color'),expected)

    def test_transition_gallery_duration_direction_softness_undo_and_reopen(self):
        with self.open_transition_editor() as panel:
            self.assertEqual(panel.locator('.transition-choice').count(),9)
            panel.locator('[data-transition="zoom"]').click()
            self.assertEqual(self.page.locator('.clip-transition').input_value(),'zoom')
            self.assertEqual(panel.locator('.transition-direction').input_value(),'in')
            panel.locator('.transition-direction').select_option('out')
            panel.locator('.transition-softness').fill('83.5');panel.locator('.transition-softness').press('Tab')
            saved = self.page.evaluate('projectStore.snapshot()')
            self.page.evaluate('projectStore.replace(projectStore.state)')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[1].transitionSoftness'),83.5)
            self.assertEqual(panel.locator('.transition-direction').input_value(),'out')
            history=self.page.evaluate('projectStore.past.length')
            self.page.locator('.clip-transitionDuration').fill('.75');self.page.locator('.clip-transitionDuration').press('Tab')
            self.assertAlmostEqual(self.page.evaluate('videoClipEditor.timeline()[1].transition'),.75)
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[1].offset'),1.25)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.page.evaluate('projectStore.undo()')
            self.assertEqual(self.page.evaluate('copyProject(projectStore.state)'),saved)
            self.page.locator('.clip-transition').select_option('slideleft')
            self.assertEqual(panel.locator('.transition-direction').input_value(),'left')
            self.assertEqual(panel.locator('[data-transition="slideleft"]').get_attribute('aria-pressed'),'true')
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id)')
            self.assertTrue(panel.locator('.transition-choice').first.is_disabled())
            self.assertTrue(self.page.locator('.clip-transitionDuration').is_disabled())

    def test_transition_handle_drag_cancel_keyboard_and_single_undo(self):
        with self.open_transition_editor():
            self.page.evaluate('window.snapEnabled=false;timelineView.set(2,.75)')
            handle=self.page.locator('.transition-band[data-transition-clip="transition-second"] button')
            handle.scroll_into_view_if_needed();box=handle.bounding_box();lane=self.page.locator('.video-edit-lane').bounding_box()
            span=self.page.evaluate('timelineView.span');x=box['x']+box['width']/2;y=box['y']+box['height']/2
            before=self.page.evaluate('JSON.stringify(projectStore.state)');history=self.page.evaluate('projectStore.past.length')
            self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x-.25/span*lane['width'],y,steps=5)
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.state)'),before)
            self.page.keyboard.press('Escape');self.page.mouse.up()
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            box=handle.bounding_box();x=box['x']+box['width']/2;y=box['y']+box['height']/2
            self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x-.25/span*lane['width'],y,steps=5);self.page.mouse.up()
            self.assertAlmostEqual(self.page.evaluate('videoClipEditor.timeline()[1].transition'),.75)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            handle.focus();handle.press('ArrowRight')
            self.assertAlmostEqual(self.page.evaluate('videoClipEditor.timeline()[1].transition'),.75-1/24)
            handle.press('End');self.assertAlmostEqual(self.page.evaluate('videoClipEditor.timeline()[1].transition'),1)
            handle.press('Home');self.assertAlmostEqual(self.page.evaluate('videoClipEditor.timeline()[1].transition'),0)
            handle.press('ArrowLeft');self.assertAlmostEqual(self.page.evaluate('videoClipEditor.timeline()[1].transition'),1/24)

    def test_transition_loop_shared_clock_multiple_cycles_and_stop_actions(self):
        with self.open_transition_editor() as panel:
            self.page.evaluate("""window.loopSeeks=0;document.addEventListener('studio-transport',e=>{
              if(e.detail.action==='seek'&&videoClipEditor.transitions.loop)loopSeeks++;
            });""")
            history=self.page.evaluate('projectStore.past.length')
            panel.locator('.transition-loop').click()
            wait_for_browser(self.page,'videoClipEditor.transitions.loop && loopSeeks>=6')
            self.assertTrue(self.page.evaluate('audioEngine.wsMain.isPlaying()'))
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            time=self.page.evaluate('audioEngine.getProjectTime()');self.assertGreaterEqual(time,1.5);self.assertLess(time,2.05)
            self.page.evaluate('audioEngine.seekProjectTime(.25)')
            self.assertEqual(panel.locator('.transition-loop').get_attribute('aria-pressed'),'false')
            self.assertIsNone(self.page.evaluate('audioEngine.reviewRange'))
            panel.locator('.transition-loop').click();wait_for_browser(self.page,'!!videoClipEditor.transitions.loop')
            self.page.evaluate('audioEngine.pause()')
            self.assertIsNone(self.page.evaluate('videoClipEditor.transitions.loop'))
            panel.locator('.transition-loop').click();wait_for_browser(self.page,'!!videoClipEditor.transitions.loop')
            self.page.evaluate('projectStore.snapshot()')
            self.assertFalse(self.page.evaluate('audioEngine.wsMain.isPlaying()'))
            self.assertIsNone(self.page.evaluate('audioEngine.reviewRange'))
            # The loop also works when a transition ends at the audio project end.
            self.page.evaluate('projectStore.update(p=>{p.tracks.main.end=2;});loopSeeks=0;')
            panel.locator('.transition-loop').click();wait_for_browser(self.page,'videoClipEditor.transitions.loop && loopSeeks>=6')
            self.page.evaluate('projectStore.update(p=>{p.videoClips[1].transitionSoftness=20;})')
            self.assertIsNone(self.page.evaluate('audioEngine.reviewRange'))
            self.assertFalse(self.page.evaluate('audioEngine.wsMain.isPlaying()'))
            self.page.evaluate('''projectStore.update(p=>{p.effects.speed=1.5;p.tracks.main.start=.25;p.tracks.main.end=2.5;
              p.videoClips.forEach(c=>c.end=1);Object.assign(p.videoClips[1],{offset:.75,transitionDuration:.25});});loopSeeks=0;''')
            panel.locator('.transition-loop').click();wait_for_browser(self.page,'videoClipEditor.transitions.loop && loopSeeks>=6')
            time=self.page.evaluate('audioEngine.getProjectTime()');self.assertGreaterEqual(time,.75);self.assertLess(time,1.05)
            panel.locator('.transition-loop').click()

    def test_transition_and_lyric_review_loops_release_each_other(self):
        with self.open_transition_editor() as panel:
            self.page.evaluate("""projectStore.update(p=>{p.lyrics.lines=[{id:'line',text:'Bir satır',start:1.5,end:1.9}];});
              document.getElementById('lyricsReviewListen').click();""")
            wait_for_browser(self.page,'audioEngine.reviewRange && audioEngine.wsMain.isPlaying()')
            self.assertEqual(self.page.locator('#lyricsReviewListen').text_content(),'Dinlemeyi durdur')
            panel.locator('.transition-loop').click()
            wait_for_browser(self.page,'!!videoClipEditor.transitions.loop')
            self.assertEqual(self.page.locator('#lyricsReviewListen').text_content(),'Çevresini dinle')
            self.assertTrue(self.page.evaluate('audioEngine.reviewRange===videoClipEditor.transitions.clockRange'))
            self.page.evaluate("document.getElementById('lyricsReviewListen').click()")
            wait_for_browser(self.page,'audioEngine.reviewRange && !videoClipEditor.transitions.loop')
            self.assertEqual(self.page.locator('#lyricsReviewListen').text_content(),'Dinlemeyi durdur')
            self.assertTrue(self.page.evaluate('audioEngine.wsMain.isPlaying()'))

    def test_transition_canvas_directions_endpoints_and_portable_blur(self):
        result=self.page.evaluate("""() => {
          const canvas=document.createElement('canvas');canvas.width=128;canvas.height=72;
          const ctx=canvas.getContext('2d',{alpha:false}),renderer=new ClipTransitionRenderer();
          const draw=(target,index,alpha=1,dx=0,dy=0,scale=1)=>{target.save();target.globalAlpha=alpha;target.fillStyle=index?'#0000ff':'#ff0000';
            target.translate(64,36);target.scale(scale,scale);target.fillRect(-64+dx,-36+dy,128,72);target.restore();};
          const pixel=(x,y)=>[...ctx.getImageData(x,y,1,1).data].slice(0,3);
          const render=(type,direction,p)=>{ctx.fillStyle='#000';ctx.fillRect(0,0,128,72);renderer.draw(ctx,{index:1,previous:0,type,direction,progress:p,softness:0},draw);};
          const checks=[];
          for(const [direction,x,y] of [['left',120,36],['right',8,36],['up',64,68],['down',64,4]]) {
            for(const type of ['wipeleft','slideleft']){render(type,direction,.25);checks.push(pixel(x,y)[2]===255&&pixel(64,36)[0]===255);}
          }
          render('circlecrop','in',.25);checks.push(pixel(64,36)[2]===255&&pixel(0,0)[0]===255);
          render('circlecrop','out',.25);checks.push(pixel(64,36)[0]===255&&pixel(0,0)[2]===255);
          render('zoom','in',.25);checks.push(Math.abs(pixel(0,0)[0]-255*.75)<1&&pixel(0,0)[2]===0);
          render('zoom','out',.25);checks.push(pixel(0,0)[0]===0&&pixel(0,0)[2]>0);
          for(const [type] of CLIP_TRANSITIONS)for(const p of [0,1]){render(type,'out',p);checks.push(pixel(64,36)[p?2:0]===255);}
          const pattern=(target,index,alpha=1)=>{target.save();target.globalAlpha=alpha;target.fillStyle='#808080';target.fillRect(0,0,128,72);target.fillStyle='#fff';target.fillRect(64,0,1,72);target.restore();};
          renderer.draw(ctx,{index:1,previous:0,type:'blur',progress:.5},pattern);
          return {checks,center:pixel(64,36),neighbor:pixel(63,36),edge:pixel(0,36)};
        }""")
        self.assertTrue(all(result['checks']),result)
        self.assertGreater(result['neighbor'][0],128)
        self.assertLess(result['center'][0],255)
        self.assertLess(abs(result['edge'][0]-128),3)

    @contextmanager
    def open_group_selection(self):
        with self.open_transition_editor():
            self.page.locator('#rainUpload').set_input_files(str(self.audio))
            wait_for_browser(self.page, '!!audioEngine.files.rain')
            self.page.evaluate('''projectStore.update(p=>{
              p.output.fps='30';p.rhythm.snap=false;
              p.mainClips=[{id:'group-first',offset:0,start:0,end:.5},
                {id:'group-middle',offset:1,start:.5,end:1},{id:'group-last',offset:3,start:1,end:3}];
              Object.assign(p.tracks.rain,{offset:.6,start:0,end:.5,until:1.1,loop:false,
                automation:{volume:[[0,20],[5,120]]}});
              Object.assign(p.videoClips[0],{id:'group-video',offset:.6,start:0,end:.5,transitionDuration:0});
              Object.assign(p.videoClips[1],{offset:3,start:.5,end:1,transitionDuration:0});
            });window.snapEnabled=false;timelineView.set(1,0);timelineSelection.set([]);''')
            wait_for_browser(self.page, 'videoPreview.ready && !videoPreview.busy && !audioEngine.mainMontage.pending')
            yield

    def select_mixed_group(self):
        self.page.locator('[data-main-clip="group-middle"] .clip-body').click()
        self.page.locator('[data-clip="group-video"] .clip-body').click(modifiers=['Shift'])
        self.page.locator('[data-audio-clip="rain"] .clip-body').click(modifiers=['Shift'])
        self.assertEqual(self.page.evaluate('timelineSelection.refs.length'), 3)

    def test_mixed_clip_selection_drag_draft_cancel_bounds_and_one_undo(self):
        with self.open_group_selection():
            self.select_mixed_group()
            body=self.page.locator('[data-main-clip="group-middle"] .clip-body')
            body.scroll_into_view_if_needed()
            before=self.page.evaluate('projectStore.snapshot()')
            history=self.page.evaluate('projectStore.past.length')
            box=body.bounding_box()
            width=self.page.locator('.main-edit-lane').bounding_box()['width']
            x,y=box['x']+box['width']/2,box['y']+box['height']/2
            self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+width*.04,y,steps=5)
            self.assertTrue(self.page.evaluate('!!timelineSelection.drag && timelineSelection.drag.moved'))
            self.assertEqual(self.page.evaluate('projectStore.snapshot()'),before)
            self.page.keyboard.press('Escape');self.page.mouse.up()
            self.assertEqual(self.page.evaluate('projectStore.snapshot()'),before)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+width*.04,y,steps=5);self.page.mouse.up()
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.mainClips[1].offset'),1.2)
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[0].offset'),.8)
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.rain.offset'),.8)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            after=self.page.evaluate('projectStore.snapshot()')
            self.page.locator('#undoBtn').click();self.assertEqual(self.page.evaluate('projectStore.snapshot()'),before)
            self.page.locator('#redoBtn').click();self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)
            body=self.page.locator('[data-main-clip="group-middle"] .clip-body');body.focus();body.press('ArrowRight')
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.rain.offset'),.8+1/30)

    def test_mixed_clip_clipboard_audio_playback_delete_reopen_and_locks(self):
        with self.open_group_selection():
            self.select_mixed_group()
            toolbar=self.page.locator('.clip-selection-tools')
            toolbar.locator('[data-selection="copy"]').focus()
            self.page.keyboard.press('Control+c')
            self.page.evaluate('audioEngine.seekProjectTime(2)')
            before=self.page.evaluate('projectStore.snapshot()');history=self.page.evaluate('projectStore.past.length')
            self.page.keyboard.press('Control+v')
            wait_for_browser(self.page,'!timelineSelection.busy && timelineSelection.refs.length===3 && Object.keys(audioEngine.files).length===3')
            copied=self.page.evaluate('timelineSelection.refs.find(r=>r.type==="audio").id')
            self.assertTrue(self.page.evaluate('id=>!!audioEngine.sourceBuffer(id)',copied))
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertAlmostEqual(self.page.evaluate('id=>projectStore.state.tracks[id].until',copied),2.5)
            self.page.evaluate('audioEngine.seekProjectTime(2.1);audioEngine.play()')
            wait_for_browser(self.page,'id=>!!audioEngine.ambientSources[id]',arg=copied)
            self.page.evaluate('audioEngine.pause()')
            after=self.page.evaluate('projectStore.snapshot()')
            self.page.locator('#undoBtn').click();self.assertEqual(self.page.evaluate('projectStore.snapshot()'),before)
            self.page.locator('#redoBtn').click();self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)
            self.page.evaluate('id=>timelineSelection.set([{type:"audio",id}])',copied)
            toolbar.locator('[data-selection="delete"]').click()
            self.assertFalse(self.page.evaluate('id=>!!projectStore.state.tracks[id]',copied))
            self.page.locator('#undoBtn').click();self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)
            self.page.locator('.track-rain .group-lock').check()
            self.page.locator('[data-audio-clip="rain"] .clip-body').click(modifiers=['Shift'])
            self.assertEqual(self.page.evaluate('timelineSelection.refs.length'),0)
            with self.page.expect_download() as download:
                self.page.locator('#saveProjectBtn').click()
            saved=Path(download.value.path()).read_text(encoding='utf-8')
            self.assertTrue(json.loads(saved)['tracks']['rain']['groupLocked'])
            self.page.locator('#openProjectInput').set_input_files({'name':'group.json','mimeType':'application/json','buffer':saved.encode()})
            wait_for_browser(self.page,'projectStore.state.tracks.rain.groupLocked && timelineSelection.refs.length===0')
            self.assertTrue(self.page.locator('.track-rain .group-lock').is_checked())

    def test_group_duplicate_preserves_gaps_and_blocks_colliding_paste(self):
        with self.open_group_selection():
            self.select_mixed_group()
            before=self.page.evaluate('projectStore.snapshot()');history=self.page.evaluate('projectStore.past.length')
            self.page.locator('[data-selection="duplicate"]').click()
            wait_for_browser(self.page,'!timelineSelection.busy && Object.keys(audioEngine.files).length===3')
            positions=self.page.evaluate('timelineSelection.items().filter(i=>timelineSelection.refs.some(r=>selectionKey(r)===selectionKey(i))).map(i=>[i.type,i.offset])')
            for kind,offset in positions:self.assertAlmostEqual(offset,1.9 if kind=='main' else 1.5)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.page.locator('#undoBtn').click();self.assertEqual(self.page.evaluate('projectStore.snapshot()'),before)
            self.page.evaluate('window.groupErrors=[];document.addEventListener("studio-error",e=>groupErrors.push(e.detail));audioEngine.seekProjectTime(.6)')
            self.page.locator('[data-selection="paste"]').click()
            self.assertTrue(self.page.evaluate('groupErrors.length>0'))
            self.assertEqual(self.page.evaluate('projectStore.snapshot()'),before)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)

    def test_clip_selection_touch_add_move_and_cancel(self):
        with self.open_group_selection():
            cdp=self.context.new_cdp_session(self.page)
            cdp.send('Emulation.setTouchEmulationEnabled',{'enabled':True,'maxTouchPoints':1})
            self.page.locator('[data-selection="mode"]').click()
            for selector in ['[data-main-clip="group-middle"] .clip-body','[data-audio-clip="rain"] .clip-body']:
                target=self.page.locator(selector);target.scroll_into_view_if_needed();box=target.bounding_box()
                point={'x':box['x']+box['width']/2,'y':box['y']+box['height']/2}
                cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[point]})
                cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
            self.assertEqual(self.page.evaluate('timelineSelection.refs.length'),2)
            before=self.page.evaluate('projectStore.snapshot()');history=self.page.evaluate('projectStore.past.length')
            target=self.page.locator('[data-audio-clip="rain"] .clip-body');target.scroll_into_view_if_needed();box=target.bounding_box()
            width=self.page.locator('.track-rain .audio-group-lane').bounding_box()['width']
            point={'x':box['x']+box['width']/2,'y':box['y']+box['height']/2}
            for cancel in [True,False]:
                cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[point]})
                cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[dict(x=point['x']+width*.04,y=point['y'])]})
                wait_for_browser(self.page,'!!timelineSelection.drag && timelineSelection.drag.moved')
                self.assertEqual(self.page.evaluate('projectStore.snapshot()'),before)
                cdp.send('Input.dispatchTouchEvent',{'type':'touchCancel' if cancel else 'touchEnd','touchPoints':[]})
                if cancel:self.assertEqual(self.page.evaluate('projectStore.snapshot()'),before)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.rain.offset'),.8)
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.mainClips[1].offset'),1.2)

    def test_clip_box_selection_cancel_locked_lane_and_responsive_tools(self):
        with self.open_group_selection():
            toolbar=self.page.locator('.clip-selection-tools')
            toolbar.locator('[data-selection="mode"]').click()
            lane=self.page.locator('.main-edit-lane');lane.scroll_into_view_if_needed();box=lane.bounding_box()
            x,y=box['x']+box['width']*.16,box['y']+2
            self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(box['x']+box['width']*.8,box['y']+box['height']-2,steps=5)
            self.assertEqual(self.page.evaluate('timelineSelection.refs.length'),2)
            self.page.keyboard.press('Escape');self.page.mouse.up()
            self.assertEqual(self.page.evaluate('timelineSelection.refs.length'),0)
            self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(box['x']+box['width']*.8,box['y']+box['height']-2,steps=5);self.page.mouse.up()
            self.assertEqual(self.page.evaluate('timelineSelection.refs.length'),2)
            toolbar.locator('[data-selection="clear"]').click()
            self.page.locator('.track-main .group-lock').check()
            lane.scroll_into_view_if_needed();box=lane.bounding_box()
            self.page.mouse.move(box['x']+box['width']*.16,box['y']+2);self.page.mouse.down();self.page.mouse.move(box['x']+box['width']*.8,box['y']+box['height']-2,steps=4);self.page.mouse.up()
            self.assertEqual(self.page.evaluate('timelineSelection.refs.length'),0)
            for width in [320,375,768,1024,1440]:
                for theme in ['light','dark']:
                    self.page.set_viewport_size({'width':width,'height':900});self.page.emulate_media(color_scheme=theme)
                    self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,theme))
                    self.assertTrue(toolbar.evaluate('(el)=>el.scrollWidth<=el.clientWidth'),(width,theme))

    @contextmanager
    def open_ripple_editor(self):
        with self.open_group_selection():
            self.page.evaluate('''projectStore.update(p=>{
              p.mainClips=null;p.tracks.main.start=0;p.tracks.main.end=3;
              Object.assign(p.tracks.rain,{offset:0,start:0,end:3,until:3,phase:.0,loop:false});
              Object.assign(p.videoClips[0],{offset:0,start:0,end:1.5});
              Object.assign(p.videoClips[1],{offset:1.5,start:.5,end:1.5});
              p.lyrics.lines=[{id:'ripple-row',text:'one two three',start:0,end:3,
                words:[{text:'one',start:0,end:1},{text:'two',start:1,end:2},{text:'three',start:2,end:3}]}];
            });audioEngine.seekProjectTime(0);''')
            wait_for_browser(self.page,'!audioEngine.mainMontage.pending && videoPreview.ready && !videoPreview.busy')
            self.page.locator('#timelineRipple').click()
            panel=self.page.locator('.ripple-editor')
            panel.locator('.ripple-start').fill('0.5');panel.locator('.ripple-end').fill('1')
            yield panel

    def test_ripple_remove_playable_audio_words_one_undo_and_reopen(self):
        with self.open_ripple_editor() as panel:
            before=self.page.evaluate('projectStore.snapshot()');history=self.page.evaluate('projectStore.past.length')
            panel.locator('[data-ripple-operation="remove"]').click()
            wait_for_browser(self.page,'!rippleEditor.busy && Object.keys(projectStore.state.tracks).length===4 && !audioEngine.mainMontage.pending')
            after=self.page.evaluate('projectStore.snapshot()')
            copied=next(key for key in after['tracks'] if key not in ('main','rain','fire'))
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertAlmostEqual(self.page.evaluate('projectDuration(projectStore.state)'),2.5)
            self.assertEqual(after['lyrics']['timeBase'],'project')
            self.assertEqual([row['text'] for row in after['lyrics']['lines']],['one','two three'])
            self.assertAlmostEqual(after['tracks'][copied]['phase'],1)
            self.assertTrue(self.page.evaluate('id=>!!audioEngine.sourceBuffer(id)',copied))
            self.page.evaluate('audioEngine.seekProjectTime(.75);audioEngine.play()')
            wait_for_browser(self.page,'id=>!!audioEngine.ambientSources[id]',arg=copied)
            self.page.evaluate('audioEngine.pause()')
            self.page.locator('#undoBtn').click();self.assertEqual(self.page.evaluate('projectStore.snapshot()'),before)
            self.page.locator('#redoBtn').click();self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)
            with self.page.expect_download() as download:self.page.locator('#saveProjectBtn').click()
            saved=Path(download.value.path()).read_bytes()
            self.page.locator('#openProjectInput').set_input_files({'name':'ripple.json','mimeType':'application/json','buffer':saved})
            wait_for_browser(self.page,'projectStore.state.lyrics.timeBase==="project" && projectStore.state.mainClips.length===2')
            wait_for_browser(self.page,'videoPreview.ready && !videoPreview.busy && !audioEngine.mainMontage.pending')
            self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)

    def test_ripple_insert_unchecked_lanes_locked_controls_and_failure_history(self):
        with self.open_ripple_editor() as panel:
            self.page.evaluate('projectStore.update(p=>{p.video.groupLocked=true;})')
            video=panel.locator('[data-ripple-lane="video"]')
            self.assertTrue(video.is_disabled());self.assertFalse(video.is_checked())
            panel.locator('.ripple-none').click()
            panel.locator('[data-ripple-lane="main"]').check()
            panel.locator('[data-ripple-lane="automation:rain"]').check()
            before=self.page.evaluate('projectStore.snapshot()');history=self.page.evaluate('projectStore.past.length')
            panel.locator('[data-ripple-operation="insert"]').click()
            wait_for_browser(self.page,'projectDuration(projectStore.state)===3.5 && !rippleEditor.busy')
            after=self.page.evaluate('projectStore.snapshot()')
            self.assertEqual(after['videoClips'],before['videoClips'])
            self.assertEqual(after['lyrics']['lines'],before['lyrics']['lines'])
            self.assertEqual(after['lyrics']['timeBase'],'project')
            self.assertEqual(after['tracks']['rain']['offset'],0)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            panel.locator('.ripple-all').click()
            panel.locator('.ripple-start').fill('0');panel.locator('.ripple-end').fill('3.5')
            panel.locator('[data-ripple-operation="remove"]').click()
            self.assertIn('en az bir ana',panel.locator('.ripple-status').inner_text())
            self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)

            self.page.evaluate('projectStore.update(p=>{p.tracks.rain.offset=4;p.tracks.rain.until=null;})')
            self.assertTrue(panel.locator('[data-ripple-lane="audio:rain"]').is_disabled())
            panel.locator('.ripple-none').click();panel.locator('[data-ripple-lane="main"]').check()
            panel.locator('.ripple-start').fill('0.5');panel.locator('.ripple-end').fill('1')
            panel.locator('[data-ripple-operation="insert"]').click()
            wait_for_browser(self.page,'projectDuration(projectStore.state)===4 && !rippleEditor.busy')
            self.assertIsNotNone(self.page.evaluate('projectStore.state.tracks.rain.source'))
            self.assertEqual(self.page.evaluate('projectStore.state.tracks.rain.offset'),4)

    def test_ripple_project_lyrics_word_seek_import_export_and_responsive_panel(self):
        with self.open_ripple_editor() as panel:
            panel.locator('[data-ripple-operation="remove"]').click()
            wait_for_browser(self.page,'!rippleEditor.busy && projectStore.state.lyrics.timeBase==="project"')
            self.page.evaluate('selectSidebarTab("lyrics")')
            self.page.locator('.lyric-row').nth(1).locator('button').first.click()
            self.assertAlmostEqual(self.page.evaluate('audioEngine.getProjectTime()'),.5)
            self.page.locator('#lyricWordEditor > summary').click()
            self.assertIn('proje sn',self.page.locator('.word-summary').inner_text())
            self.page.locator('.word-label').last.click()
            self.assertAlmostEqual(self.page.evaluate('audioEngine.getProjectTime()'),1.5)
            self.page.locator('.lyric-tools > summary').filter(has_text='Metin Yapıştır').click()
            self.page.locator('#lyricsTimebase').select_option('project')
            self.page.locator('#lyricsImport').set_input_files({'name':'project.srt','mimeType':'text/plain','buffer':b'1\n00:00:00,250 --> 00:00:01,250\nImported\n'})
            wait_for_browser(self.page,'projectStore.state.lyrics.lines[0].text==="Imported"')
            self.assertEqual(self.page.evaluate('projectStore.state.lyrics.lines[0].start'),.25)
            with self.page.expect_download() as download:self.page.locator('#lyricsSrt').click()
            self.assertIn('00:00:00,250 --> 00:00:01,250',Path(download.value.path()).read_text(encoding='utf-8'))
            self.page.evaluate('selectSidebarTab("main")')
            self.page.locator('#timelineRipple').click()
            for width in [320,375,768,1024,1440]:
                for theme in ['light','dark']:
                    self.page.set_viewport_size({'width':width,'height':900});self.page.emulate_media(color_scheme=theme)
                    self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,theme))
                    self.assertTrue(panel.evaluate('(el)=>el.scrollWidth<=el.clientWidth'),(width,theme))
            self.page.set_viewport_size({'width':320,'height':900})
            panel.locator('.ripple-none').click()
            self.assertEqual(panel.locator('[data-ripple-lane]:checked').count(),0)
            panel.locator('.ripple-all').click()
            self.assertGreater(panel.locator('[data-ripple-lane]:checked').count(),0)
            panel.locator('[data-ripple-operation="insert"]').scroll_into_view_if_needed()
            action=panel.locator('[data-ripple-operation="insert"]').bounding_box()
            footer=self.page.locator('.transport').bounding_box()
            self.assertLessEqual(action['y']+action['height'],footer['y'])

    def test_ripple_project_lyric_recognition_uses_source_file_and_maps_approved_draft(self):
        self.page.route('**/api/lyrics/models',lambda route:route.fulfill(json={'available':True,'models':{'base':True}}))
        self.page.route('**/api/lyrics/align_available',lambda route:route.fulfill(json={'available':False}))
        payload=[]
        def recognize(route):
            payload.append(route.request.post_data_buffer.decode('utf-8',errors='replace'))
            route.fulfill(json={'job_id':'ripple-test'})
        self.page.route('**/api/lyrics/transcribe',recognize)
        self.page.route('**/api/lyrics/jobs/ripple-test',lambda route:route.fulfill(json={'state':'done','result':{'lines':[
            dict(id='recognized',text='New',start=1.2,end=1.8,words=[dict(text='New',start=1.2,end=1.8)])]}}))
        self.page.reload(wait_until='networkidle')
        with self.open_ripple_editor() as panel:
            panel.locator('[data-ripple-operation="remove"]').click()
            wait_for_browser(self.page,'!rippleEditor.busy && projectStore.state.lyrics.timeBase==="project"')
            self.page.evaluate('selectSidebarTab("lyrics")')
            self.page.locator('#lyricsUseReference').check()
            before=self.page.evaluate('copyProject(projectStore.state.lyrics.lines)')
            self.page.locator('#lyricsTranscribe').click()
            wait_for_browser(self.page,'!document.getElementById("lyricsDraft").classList.contains("hidden")')
            self.assertEqual(self.page.evaluate('projectStore.state.lyrics.lines'),before)
            self.assertIn('"start":null',payload[0]);self.assertIn('"end":null',payload[0])
            self.page.locator('#lyricsApplyDraft').click()
            row=self.page.evaluate('projectStore.state.lyrics.lines[0]')
            self.assertEqual(row['text'],'New');self.assertAlmostEqual(row['start'],.7);self.assertAlmostEqual(row['end'],1.3)
            self.assertAlmostEqual(row['words'][0]['start'],.7)
            self.assertEqual(self.page.evaluate('projectStore.state.lyrics.timeBase'),'project')

    @contextmanager
    def open_audio_warp(self):
        self.load_audio();self.page.locator('#rainUpload').set_input_files(str(self.audio));wait_for_browser(self.page,'!!audioEngine.files.rain')
        self.page.evaluate('projectStore.update(p=>{p.effects.speed=1;p.tracks.rain.end=1;p.tracks.rain.loop=false;p.tracks.rain.fadeIn=p.tracks.rain.fadeOut=0;});window.warpOriginal=audioEngine.files.rain;void 0')
        panel=self.page.locator('#audioWarpEditor');panel.locator(':scope > summary').click();panel.locator('.warp-source').select_option('rain');panel.locator('.warp-new').click();yield panel

    def test_audio_warp_real_preview_apply_history_regenerate_dissolve_and_reopen(self):
        with self.open_audio_warp() as panel:
            before=self.page.evaluate('projectStore.snapshot()');history=self.page.evaluate('projectStore.past.length')
            rate=panel.locator('[data-warp-field="rate"]');rate.fill(str(2/3));rate.dispatch_event('change');panel.locator('.warp-insert-time').fill('.5');panel.locator('.warp-insert').click()
            target=panel.locator('[data-warp-field="target:1"]');target.fill('.5');target.dispatch_event('change')
            panel.locator('.warp-preview').click();wait_for_browser(self.page,'!!audioWarpEditor.result&&!audioWarpEditor.busy')
            self.assertEqual(self.page.evaluate('projectStore.snapshot()'),before);self.assertAlmostEqual(self.page.evaluate('audioWarpEditor.result.buffer.duration'),1.5,places=4)
            panel.locator('.warp-apply').click();wait_for_browser(self.page,'projectStore.state.audioWarps.length===1&&!audioWarpEditor.busy')
            after=self.page.evaluate('projectStore.snapshot()');output=after['audioWarps'][0]['output'];self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1);self.assertTrue(self.page.evaluate('audioEngine.files.rain===warpOriginal'));self.assertTrue(after['tracks']['rain']['muted'])
            self.page.evaluate('audioEngine.play()');wait_for_browser(self.page,'id=>!!audioEngine.ambientSources[id]',arg=output);self.page.evaluate('audioEngine.pause()')
            self.page.locator('#undoBtn').click();self.assertEqual(self.page.evaluate('projectStore.snapshot()'),before);self.page.locator('#redoBtn').click();self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)
            self.page.evaluate('id=>projectStore.update(p=>{p.tracks[id].offset=.2;p.tracks[id].until=1.7;p.tracks[id].volume=130;})',output);self.page.evaluate('selectSidebarTab("main")');panel.locator('.warp-open').click();self.assertAlmostEqual(float(panel.locator('[data-warp-field="offset"]').input_value()),.2)
            last=panel.locator('[data-warp-field="target:2"]');last.fill('1.6');last.dispatch_event('change');panel.locator('.warp-apply').click();wait_for_browser(self.page,'id=>!audioWarpEditor.busy&&projectStore.state.audioWarps[0].output!==id',arg=output)
            after=self.page.evaluate('projectStore.snapshot()');new=after['audioWarps'][0]['output'];self.assertEqual(after['tracks'][new]['volume'],130);self.assertAlmostEqual(after['tracks'][new]['source']['duration'],1.4,places=4)
            self.page.evaluate('selectSidebarTab("main")');panel.locator('.warp-dissolve').click();self.assertFalse(self.page.evaluate('projectStore.state.tracks.rain.muted'));self.page.locator('#undoBtn').click();self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)
            with self.page.expect_download() as download:self.page.locator('#saveProjectBtn').click()
            self.page.locator('#openProjectInput').set_input_files(dict(name='warp.json',mimeType='application/json',buffer=Path(download.value.path()).read_bytes()));wait_for_browser(self.page,'projectStore.state.audioWarps.length===1');self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)

    def test_audio_warp_canvas_precision_invalid_draft_cancel_locks_and_responsive(self):
        with self.open_audio_warp() as panel:
            before=self.page.evaluate('projectStore.snapshot()');canvas=panel.locator('canvas');canvas.scroll_into_view_if_needed();box=canvas.bounding_box();x=box['x']+16+(box['width']-32)*.5;y=box['y']+box['height']*.3
            self.page.mouse.click(x,y);self.assertEqual(self.page.evaluate('audioWarpEditor.draft.markers.length'),3);canvas.focus();canvas.press('ArrowRight');self.assertAlmostEqual(self.page.evaluate('audioWarpEditor.draft.markers[1][1]'),.501,places=4)
            box=canvas.bounding_box();self.page.mouse.move(x,box['y']+box['height']*.64);self.page.mouse.down();self.page.mouse.move(box['x']+16+(box['width']-32)*.65,box['y']+box['height']*.64,steps=4);self.page.mouse.up();self.assertGreater(self.page.evaluate('audioWarpEditor.draft.markers[1][1]'),.6)
            target=panel.locator('[data-warp-field="target:1"]');target.fill('.99');target.dispatch_event('change');self.assertTrue(panel.locator('.warp-apply').is_disabled());self.assertEqual(self.page.evaluate('projectStore.snapshot()'),before)
            target=panel.locator('[data-warp-field="target:1"]');target.fill('.5');target.dispatch_event('change');panel.locator('.warp-preview').click();panel.locator('.warp-cancel').click();wait_for_browser(self.page,'!audioWarpEditor.busy&&!audioWarpEditor.draft');self.assertEqual(self.page.evaluate('projectStore.snapshot()'),before)
            panel.locator('.warp-new').click();self.page.evaluate('projectStore.update(p=>{p.tracks.rain.groupLocked=true;})');self.assertTrue(panel.locator('[data-warp-field="transpose"]').is_disabled());self.page.locator('#undoBtn').click()
            for width in [320,375,768,1024,1440]:
                for theme in ['light','dark']:
                    self.page.set_viewport_size(dict(width=width,height=900));self.page.emulate_media(color_scheme=theme);self.assertTrue(panel.evaluate('el=>el.scrollWidth<=el.clientWidth'),(width,theme));self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,theme))

    def test_audio_warp_waveform_mount_failure_restores_source_mix_and_history(self):
        with self.open_audio_warp() as panel:
            before=self.page.evaluate('projectStore.snapshot()');history=self.page.evaluate('projectStore.past.length')
            self.page.evaluate('''const warpLoad=audioEngine.loadAudio.bind(audioEngine);audioEngine.loadAudio=async(id,file,options)=>{if(id.startsWith('warp_audio_'))throw new Error('Wave mount failed');return warpLoad(id,file,options);};void 0''')
            panel.locator('.warp-apply').click();wait_for_browser(self.page,'!audioWarpEditor.busy&&document.querySelector(".warp-status").textContent.includes("Wave mount failed")')
            self.assertEqual(self.page.evaluate('projectStore.snapshot()'),before);self.assertEqual(self.page.evaluate('projectStore.past.length'),history);self.assertTrue(self.page.evaluate('audioEngine.files.rain===warpOriginal'))

    def test_spectral_processing_failure_is_visible_blocks_stale_playback_and_recovers(self):
        self.load_audio();self.page.evaluate('window.spectralOriginal=audioEngine.rawSourceBuffer("main");spectralEditor.panel.open=true;Object.assign(spectralEditor.draft,{enabled:true,end:3,regions:[{...projectFields({},"spectralRegion"),start:0,end:3,low:100,high:400}]});spectralEditor.refresh();void 0')
        self.page.route('**/spectral-audio-worker.js',lambda route:route.fulfill(body='throw new Error("worker unavailable")',content_type='application/javascript'))
        panel=self.page.locator('#spectralEditor');panel.locator('.spectral-apply').click()
        wait_for_browser(self.page,'!!audioEngine.sourceProcessing.entries.get("main")?.error&&!spectralEditor.busy&&!audioEngine.mainMontage.pending')
        self.assertIn('işleyicisi',panel.locator('.spectral-status').inner_text());self.assertTrue(self.page.evaluate('audioEngine.rawSourceBuffer("main")===spectralOriginal'))
        self.page.evaluate('audioEngine.play()');self.assertFalse(self.page.evaluate('audioEngine.wsMain.isPlaying()'))
        self.page.unroute('**/spectral-audio-worker.js');panel.locator('.spectral-bypass').click();wait_for_browser(self.page,'!audioEngine.mainMontage.pending&&!projectStore.state.tracks.main.spectral.enabled')
        self.page.evaluate('audioEngine.play()');wait_for_browser(self.page,'audioEngine.wsMain.isPlaying()');self.page.evaluate('audioEngine.pause()')

    def test_spectral_regions_preview_apply_original_history_and_reopen(self):
        self.load_audio();self.page.evaluate('projectStore.update(p=>{p.effects.speed=1;p.effects.reverb=0;p.tracks.main.fadeIn=p.tracks.main.fadeOut=0;});window.originalSpectralFile=audioEngine.files.main;window.originalSpectralBuffer=audioEngine.rawSourceBuffer("main");void 0')
        panel=self.page.locator('#spectralEditor');panel.locator(':scope > summary').click();panel.locator('.spectral-analyze').click()
        wait_for_browser(self.page,'!!spectralEditor.data&&!spectralEditor.busy')
        before=self.page.evaluate('projectStore.snapshot()');history=self.page.evaluate('projectStore.past.length')
        for key,value in [('selection:start',.2),('selection:end',2.5),('selection:low',100),('selection:high',400)]:
            field=panel.locator(f'[data-spectral-field="{key}"]');field.fill(str(value));field.dispatch_event('change')
        panel.locator('.spectral-region-add').click();self.assertEqual(self.page.evaluate('projectStore.snapshot()'),before)
        field=panel.locator('[data-spectral-field="region:0:gain"]');field.fill('-40');field.dispatch_event('change')
        panel.locator('.spectral-listen').select_option('removed');panel.locator('.spectral-preview').click();wait_for_browser(self.page,'!!spectralEditor.url&&!spectralEditor.busy')
        removed=self.page.evaluate('''async()=>{const data=await (await fetch(spectralEditor.url)).arrayBuffer(),buffer=await new OfflineAudioContext(2,1,44100).decodeAudioData(data);return Math.sqrt(buffer.getChannelData(0).reduce((s,x)=>s+x*x,0)/buffer.length);}''');self.assertGreater(removed,.015)
        panel.locator('.spectral-apply').click();wait_for_browser(self.page,'!spectralEditor.busy&&!audioEngine.mainMontage.pending&&!!audioEngine.sourceProcessing.get("main")')
        after=self.page.evaluate('projectStore.snapshot()');self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
        self.assertTrue(self.page.evaluate('audioEngine.files.main===originalSpectralFile && audioEngine.rawSourceBuffer("main")===originalSpectralBuffer'))
        ratio=self.page.evaluate('''(()=>{const raw=audioEngine.rawSourceBuffer('main').getChannelData(0),out=audioEngine.sourceBuffer('main').getChannelData(0);let a=0,b=0;for(let i=44100;i<66000;i++){a+=raw[i]**2;b+=out[i]**2;}return Math.sqrt(b/a);})()''');self.assertLess(ratio,.02)
        self.page.evaluate('audioEngine.play()');wait_for_browser(self.page,'audioEngine.wsMain.isPlaying()');self.page.evaluate('audioEngine.pause()')
        self.page.locator('#undoBtn').click();wait_for_browser(self.page,'!audioEngine.mainMontage.pending');self.assertEqual(self.page.evaluate('projectStore.snapshot()'),before);self.assertTrue(self.page.evaluate('audioEngine.sourceBuffer("main")===originalSpectralBuffer'))
        self.page.locator('#redoBtn').click();wait_for_browser(self.page,'!audioEngine.mainMontage.pending&&!!audioEngine.sourceProcessing.get("main")');self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)
        with self.page.expect_download() as download:self.page.locator('#saveProjectBtn').click()
        self.page.locator('#openProjectInput').set_input_files(dict(name='spectral.json',mimeType='application/json',buffer=Path(download.value.path()).read_bytes()))
        wait_for_browser(self.page,'projectStore.state.tracks.main.spectral.enabled&&!audioEngine.mainMontage.pending');self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)

    def test_spectral_brush_profile_auxiliary_source_cancel_locks_and_responsive(self):
        self.load_audio();self.page.locator('#rainUpload').set_input_files(str(self.audio));wait_for_browser(self.page,'!!audioEngine.files.rain')
        panel=self.page.locator('#spectralEditor');panel.locator(':scope > summary').click();panel.locator('.spectral-source').select_option('rain');panel.locator('.spectral-analyze').click();wait_for_browser(self.page,'!!spectralEditor.data&&!spectralEditor.busy')
        canvas=panel.locator('canvas');box=canvas.bounding_box();self.page.mouse.move(box['x']+55,box['y']+80);self.page.mouse.down();self.page.mouse.move(box['x']+box['width']*.7,box['y']+box['height']*.8,steps=5);self.page.mouse.up()
        selection=self.page.evaluate('copyProject(spectralEditor.selection)');self.assertGreater(selection['end'],selection['start']);self.assertGreater(selection['high'],selection['low'])
        canvas.focus();canvas.press('ArrowRight');self.assertGreater(self.page.evaluate('spectralEditor.selection.start'),selection['start'])
        panel.locator('.spectral-profile').click();self.assertTrue(self.page.evaluate('spectralEditor.draft.noiseEnabled'))
        before=self.page.evaluate('projectStore.snapshot()');panel.locator('.spectral-preview').click();panel.locator('.spectral-cancel').click();wait_for_browser(self.page,'!spectralEditor.busy');self.assertEqual(self.page.evaluate('projectStore.snapshot()'),before)
        panel.locator('.spectral-analyze').click();wait_for_browser(self.page,'!!spectralEditor.data&&!spectralEditor.busy');panel.locator('.spectral-profile').click();panel.locator('.spectral-apply').click();wait_for_browser(self.page,'!spectralEditor.busy&&!!audioEngine.sourceProcessing.get("rain")')
        self.assertTrue(self.page.evaluate('projectStore.state.tracks.rain.spectral.noiseEnabled'))
        self.page.evaluate('projectStore.update(p=>{p.tracks.rain.groupLocked=true;})');self.assertTrue(panel.locator('.spectral-apply').is_disabled());self.page.locator('#undoBtn').click()
        for width in [320,375,768,1024,1440]:
            for theme in ['light','dark']:
                self.page.set_viewport_size(dict(width=width,height=900));self.page.emulate_media(color_scheme=theme);self.assertTrue(panel.evaluate('el=>el.scrollWidth<=el.clientWidth'),(width,theme));self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,theme))

    def test_sidechain_source_filter_meter_cycle_guard_and_group_delete_history(self):
        self.load_audio();self.page.locator('#rainUpload').set_input_files(str(self.audio));wait_for_browser(self.page,'!!audioEngine.files.rain')
        self.page.evaluate('projectStore.update(p=>{p.effects.speed=1;p.audioBuses.push({...projectFields({},"audioBus"),id:"group",name:"Key"});p.tracks.rain.bus="group";})')
        effects=self.page.locator('#inspect-main .layer-effects-editor');effects.locator(':scope > summary').click();dynamics=effects.locator('.dynamics-editor');dynamics.locator(':scope > summary').click();panel=dynamics.locator('.sidechain-editor');panel.locator(':scope > summary').click()
        panel.locator('[data-sidechain-field="source"]').select_option('b:group')
        panel.locator('[data-sidechain-field="character"]').select_option('pump')
        panel.locator('[data-sidechain-field="threshold"]').fill('-45');panel.locator('[data-sidechain-field="threshold"]').dispatch_event('change');panel.locator('[data-sidechain-field="enabled"]').check()
        after=self.page.evaluate('projectStore.snapshot()');self.page.evaluate('audioEngine.play()')
        wait_for_browser(self.page,'audioEngine.trackNodes.main.effects.dynamics.reduction.sidechain>3')
        wait_for_browser(self.page,'document.querySelector("#inspect-main .sidechain-editor meter").value>3')
        self.page.evaluate('audioEngine.seekProjectTime(.5)');wait_for_browser(self.page,'audioEngine.getProjectTime()>.6');self.page.evaluate('audioEngine.pause()')
        # Routing the target back into its own key group would create a cycle.
        routing=self.page.locator('#audioRoutingEditor');routing.locator(':scope > summary').click();routing.locator('[data-routing-track="main"] select').select_option('group')
        self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)
        card=routing.locator('[data-routing-channel="group"]');card.locator(':scope > summary').click();card.locator('.routing-delete-bus').click()
        self.assertFalse(self.page.evaluate('projectStore.state.tracks.main.sidechain.enabled'));self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.sidechain.source'),'')
        self.page.locator('#undoBtn').click();self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)
        panel.locator('[data-sidechain-field="listen"]').check();self.assertTrue(self.page.evaluate('projectStore.state.tracks.main.sidechain.listen'));self.page.locator('#undoBtn').click()
        for width in [320,375,768,1024,1440]:
            for theme in ['light','dark']:
                self.page.set_viewport_size(dict(width=width,height=900));self.page.emulate_media(color_scheme=theme);self.assertTrue(panel.evaluate('el=>el.scrollWidth<=el.clientWidth'),(width,theme))
        self.page.set_viewport_size(dict(width=1440,height=900))
        with self.page.expect_download() as download:self.page.locator('#saveProjectBtn').click()
        self.page.locator('#openProjectInput').set_input_files(dict(name='sidechain.json',mimeType='application/json',buffer=Path(download.value.path()).read_bytes()))
        wait_for_browser(self.page,'projectStore.state.tracks.main.sidechain.enabled');self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)

    def test_sidechain_native_graph_matches_track_and_group_export(self):
        import numpy as np
        from project import validate_project
        from audio_routing import AudioRoutingProcessor
        from audio_controls import apply_channel_controls
        from track_effects import TrackEffectProcessor
        sr=44100;frames=12032;t=np.arange(frames)/sr
        source=dict(name='signal.wav',size=1,lastModified=0,duration=1)
        for key,character in [('t:rain','compress'),('b:group','pump'),('b:group','duck')]:
            p=validate_project(dict(version=1,tracks=dict(main=dict(source=source,pan=1,sidechain=dict(enabled=True,source=key,character=character,threshold=-30,attack=1,hold=20,release=30)),rain=dict(source=source,pan=-1,bus='group')),audioBuses=[dict(id='group',name='Key')]))
            samples=dict(main=np.full((2,frames),.2,np.float32),rain=np.stack([.5*np.sin(2*np.pi*1000*t)*((t>.03)&(t<.1))]*2).astype(np.float32))
            processors={id:TrackEffectProcessor(track,sr) for id,track in p['tracks'].items()}
            def produce(id,detector):return apply_channel_controls(processors[id].process(samples[id],0,detector),p['tracks'][id],t)
            expected=AudioRoutingProcessor(p,sr).process({},0,frames,produce)
            actual=self.page.evaluate('''async ({p,samples})=>{const ctx=new OfflineAudioContext(2,12032,44100);await prepareDynamicsContext(ctx);const nodes={};for(const [id,track] of Object.entries(p.tracks)){if(!track.source)continue;const gain=ctx.createGain(),pan=ctx.createStereoPanner();gain.connect(pan);gain.gain.value=track.volume/100;pan.pan.value=track.pan;const effects=new TrackEffectsNode(ctx,gain,()=>trackReverbImpulse(ctx));effects.schedule(track,0,0,true,1);nodes[id]={gain,pan,effects};const buffer=ctx.createBuffer(2,12032,44100);samples[id].forEach((channel,i)=>buffer.copyToChannel(new Float32Array(channel),i));const source=ctx.createBufferSource();source.buffer=buffer;source.connect(effects.input);source.start();}const graph=new AudioRoutingGraph(ctx,ctx.destination);graph.update(p,nodes);graph.schedule(0,0,true,1);graph.scheduleEffects(0,0,true,1);const result=await ctx.startRendering();return [0,1].map(i=>Array.from(result.getChannelData(i)));}''',dict(p=p,samples={id:data.tolist() for id,data in samples.items()}))
            np.testing.assert_allclose(actual,expected,atol=2e-7,err_msg=key+character)

    def test_audio_dynamics_controls_worklet_meter_history_and_reopen(self):
        self.load_audio();effects=self.page.locator('#inspect-main .layer-effects-editor');effects.locator(':scope > summary').click()
        panel=effects.locator('.dynamics-editor');panel.locator(':scope > summary').click()
        compressor=panel.locator('[data-dynamics-stage="compressor"]');compressor.locator('[data-dynamics-field="threshold"]').fill('-40');compressor.locator('[data-dynamics-field="threshold"]').dispatch_event('change');compressor.locator('[data-dynamics-field="enabled"]').check()
        limiter=panel.locator('[data-dynamics-stage="limiter"]');limiter.locator('[data-dynamics-field="enabled"]').check()
        after=self.page.evaluate('projectStore.snapshot()')
        self.page.evaluate('audioEngine.play()')
        wait_for_browser(self.page,'audioEngine.trackNodes.main.effects.dynamics.reduction.compressor>2')
        wait_for_browser(self.page,'document.querySelector("#inspect-main [data-dynamics-stage=compressor] meter").value>2')
        self.assertGreater(float(compressor.locator('meter').get_attribute('value')),2)
        self.page.evaluate('audioEngine.pause()')
        self.page.locator('#undoBtn').click();self.assertFalse(self.page.evaluate('projectStore.state.tracks.main.dynamics.limiter.enabled'))
        self.page.locator('#redoBtn').click();self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)
        self.page.evaluate('projectStore.update(p=>{p.tracks.main.groupLocked=true;})');self.assertTrue(compressor.locator('[data-dynamics-field="threshold"]').is_disabled());self.page.locator('#undoBtn').click()
        for width in [320,375,768,1024,1440]:
            for theme in ['dark','light']:
                self.page.set_viewport_size(dict(width=width,height=900));self.page.emulate_media(color_scheme=theme)
                self.assertTrue(panel.evaluate('el=>el.scrollWidth<=el.clientWidth'),(width,theme))
        self.page.set_viewport_size(dict(width=1440,height=900))
        with self.page.expect_download() as download:self.page.locator('#saveProjectBtn').click()
        self.page.locator('#openProjectInput').set_input_files(dict(name='dynamics.json',mimeType='application/json',buffer=Path(download.value.path()).read_bytes()))
        wait_for_browser(self.page,'projectStore.state.tracks.main.dynamics.compressor.enabled');self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)

    def test_audio_dynamics_native_worklet_matches_export_for_track_and_group(self):
        import numpy as np
        from audio_dynamics import DynamicsProcessor
        p=self.page.evaluate('validateProject({version:1,tracks:{main:{dynamics:{gate:{enabled:true,hold:3},compressor:{enabled:true,knee:12,makeup:5},limiter:{enabled:true,ceiling:-2}}}}})')
        settings=p['tracks']['main']['dynamics'];samples=np.random.default_rng(2).normal(0,.5,(2,12032)).astype(np.float32);samples[:,4000:8000]*=.001
        expected=DynamicsProcessor(settings,44100).process(samples)
        actual=self.page.evaluate('''async ({settings,samples})=>{const ctx=new OfflineAudioContext(2,samples[0].length,44100);await prepareDynamicsContext(ctx);const node=new DynamicsNode(ctx,ctx.destination);node.configure(settings);const buffer=ctx.createBuffer(2,samples[0].length,44100);samples.forEach((channel,i)=>buffer.copyToChannel(new Float32Array(channel),i));const source=ctx.createBufferSource();source.buffer=buffer;source.connect(node.input);source.start();const output=await ctx.startRendering();node.disconnect();return [0,1].map(i=>Array.from(output.getChannelData(i)));}''',dict(settings=settings,samples=samples.tolist()))
        np.testing.assert_allclose(actual,expected,atol=6e-8)
        # Group processing uses the same post-effect processor before its fader.
        p=self.page.evaluate('validateProject({version:1,tracks:{main:{bus:"group"}},audioBuses:[{id:"group",name:"Group",dynamics:{limiter:{enabled:true,ceiling:-6}}}]})')
        p['tracks']['main']['source']=dict(name='input.wav',size=1,lastModified=0,duration=1)
        from audio_routing import AudioRoutingProcessor
        expected=AudioRoutingProcessor(p,44100).process(dict(main=samples),0,samples.shape[1])
        actual=self.page.evaluate('''async ({p,samples})=>{const ctx=new OfflineAudioContext(2,samples[0].length,44100);await prepareDynamicsContext(ctx);const pan=ctx.createStereoPanner(),graph=new AudioRoutingGraph(ctx,ctx.destination);graph.update(p,{main:{pan}});graph.schedule(0,0,true,1);graph.scheduleEffects(0,0,true,1);const buffer=ctx.createBuffer(2,samples[0].length,44100);samples.forEach((channel,i)=>buffer.copyToChannel(new Float32Array(channel),i));const source=ctx.createBufferSource();source.buffer=buffer;source.connect(pan);source.start();const result=await ctx.startRendering();return [0,1].map(i=>Array.from(result.getChannelData(i)));}''',dict(p=p,samples=samples.tolist()))
        np.testing.assert_allclose(actual,expected,atol=6e-8)

    def test_audio_routing_authoring_automation_locks_history_and_responsive(self):
        self.load_audio()
        panel=self.page.locator('#audioRoutingEditor');panel.locator(':scope > summary').click()
        panel.locator('.routing-add-bus').click();panel.locator('.routing-add-delay').click()
        group=self.page.evaluate('projectStore.state.audioBuses[0].id');aux=self.page.evaluate('projectStore.state.audioReturns[0].id')
        panel.locator('[data-routing-track="main"] select').select_option(group)
        card=panel.locator(f'[data-routing-channel="{group}"]');card.locator(':scope > summary').click()
        def field(key,value):
            element=card.locator(f'[data-routing-field="{key}"]');element.fill(str(value));element.dispatch_event('change')
        field('volume',65);field('send:'+aux,30)
        card.locator('[data-routing-card="fx:'+group+'"] > summary').click();field('eq:1:gain',6)
        card.get_by_label('eq etkin',exact=True).uncheck();card.get_by_role('button',name='eq arkaya al').click()
        card.locator('.routing-automation > summary').click();card.locator('.routing-key-add').click()
        field('key:volume:0:1',50)
        curve=card.get_by_label('Aralık eğrisi');curve.select_option('bezier');field('handle:volume:0:1',.8)
        after=self.page.evaluate('projectStore.snapshot()')
        self.assertEqual(after['audioBuses'][0]['volume'],65);self.assertEqual(after['audioBuses'][0]['automation']['volume'][0][2]['control'][1],.8)
        self.page.evaluate('audioEngine.play()');wait_for_browser(self.page,'audioEngine.wsMain.isPlaying()')
        self.assertAlmostEqual(self.page.evaluate('audioEngine.routing.buses.get(projectStore.state.audioBuses[0].id).gain.gain.value'),.5,places=4)
        self.page.evaluate('audioEngine.pause()')
        card.locator('[data-routing-field="groupLocked"]').check();self.assertTrue(card.locator('[data-routing-field="volume"]').is_disabled())
        self.page.locator('#undoBtn').click();self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)
        card.locator('.routing-delete-bus').click();self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.bus'),'')
        self.page.locator('#undoBtn').click();self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)
        for width in [320,375,768,1024,1440]:
            for theme in ['light','dark']:
                self.page.set_viewport_size(dict(width=width,height=900));self.page.emulate_media(color_scheme=theme)
                self.assertTrue(panel.evaluate('el=>el.scrollWidth<=el.clientWidth'),(width,theme))
                self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,theme))
        self.page.set_viewport_size(dict(width=1440,height=900))
        with self.page.expect_download() as download:self.page.locator('#saveProjectBtn').click()
        self.page.locator('#openProjectInput').set_input_files(dict(name='routing.json',mimeType='application/json',buffer=Path(download.value.path()).read_bytes()))
        wait_for_browser(self.page,'projectStore.state.audioBuses.length===1')
        self.assertEqual(self.page.evaluate('projectStore.snapshot()'),after)

    def test_audio_routing_native_preview_matches_streaming_export(self):
        import numpy as np
        from test_audio_routing import routing_project
        from audio_routing import AudioRoutingProcessor
        from audio_controls import apply_channel_controls
        for kind in ['delay','reverb']:
            p=routing_project(kind);sr=44100;frames=22050
            p['audioBuses'][0]['effectChain']['eq'][1]['gain']=6
            source=np.zeros((2,frames),np.float32);source[:,20]=[.2,.1]
            source=apply_channel_controls(source,p['tracks']['rain'],np.arange(frames)/sr)
            expected=AudioRoutingProcessor(p,sr).process(dict(rain=source),0,frames)
            actual=self.page.evaluate('''async p=>{const ctx=new OfflineAudioContext(2,22050,44100),pan=ctx.createStereoPanner(),gain=ctx.createGain();gain.connect(pan);pan.pan.value=p.tracks.rain.pan;
              const graph=new AudioRoutingGraph(ctx,ctx.destination);graph.update(p,{rain:{pan}});graph.schedule(0,0,true,.5);graph.scheduleEffects(0,0,true,.5);
              const buffer=ctx.createBuffer(2,22050,44100);buffer.getChannelData(0)[20]=.2;buffer.getChannelData(1)[20]=.1;
              const source=ctx.createBufferSource();source.buffer=buffer;source.connect(gain);source.start();const result=await ctx.startRendering();return [...Array(2)].map((_,i)=>Array.from(result.getChannelData(i)));}''',p)
            np.testing.assert_allclose(actual,expected,atol=3e-6,rtol=1e-4,err_msg=kind)

if __name__ == '__main__':
    unittest.main()
