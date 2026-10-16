import unittest
from browser_helpers import wait_for_browser
import test_controller_ui as controller_ui

class PreparedAudioUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):controller_ui.ControllerUI.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls):controller_ui.ControllerUI.tearDownClass.__func__(cls)
    setUp=controller_ui.ControllerUI.setUp
    tearDown=controller_ui.ControllerUI.tearDown
    show=controller_ui.ControllerUI.show

    def test_real_prepared_playback_seek_reuse_edit_invalidation_and_native_restore(self):
        self.workspace.load_audio()
        self.page.evaluate("projectStore.update(p=>{p.effects.speed=1;p.effects.reverb=0;p.tracks.main.audioFx=validateCreativeAudioFx({preset:'AFX-08'});});window.preparedRequests=0;window.originalPreparedFetch=window.fetch;window.fetch=(...args)=>{if(args[0]==='/api/audio/preview')preparedRequests++;return originalPreparedFetch(...args);};")
        self.page.evaluate('audioEngine.play()');wait_for_browser(self.page,'!!audioEngine.preparedMix.buffer&&!!audioEngine.preparedMix.source&&audioEngine.wsMain.isPlaying()&&audioEngine.liveMonitorGate.gain.value===0',timeout=60000)
        result=self.page.evaluate('''()=>({requests:preparedRequests,gate:audioEngine.liveMonitorGate.gain.value,duration:audioEngine.preparedMix.buffer.duration,expected:projectDuration(projectStore.state),finite:audioEngine.preparedMix.buffer.getChannelData(0).every(Number.isFinite),nonzero:audioEngine.preparedMix.buffer.getChannelData(0).some(v=>Math.abs(v)>.0001)})''')
        self.assertEqual(result['requests'],1);self.assertEqual(result['gate'],0);self.assertTrue(result['finite'] and result['nonzero']);self.assertAlmostEqual(result['duration'],result['expected'],delta=.001)
        self.page.evaluate('audioEngine.pause();audioEngine.seekProjectTime(.5);audioEngine.play()');wait_for_browser(self.page,'!!audioEngine.preparedMix.source&&audioEngine.wsMain.isPlaying()')
        self.assertEqual(self.page.evaluate('preparedRequests'),1)
        self.page.evaluate('projectStore.update(p=>{p.tracks.main.audioFx.parameters.rise=.5;})');wait_for_browser(self.page,'!audioEngine.wsMain.isPlaying()&&!audioEngine.preparedMix.buffer')
        self.page.evaluate('audioEngine.play()');wait_for_browser(self.page,'!!audioEngine.preparedMix.buffer&&!!audioEngine.preparedMix.source',timeout=60000);self.assertEqual(self.page.evaluate('preparedRequests'),2)
        self.page.evaluate('audioEngine.pause();projectStore.update(p=>{p.tracks.main.audioFx=validateCreativeAudioFx({});})');self.assertEqual(self.page.evaluate('audioEngine.liveMonitorGate.gain.value'),1)
        self.page.evaluate('audioEngine.play()');wait_for_browser(self.page,'audioEngine.wsMain.isPlaying()');self.assertFalse(self.page.evaluate('!!audioEngine.preparedMix.source'));self.page.evaluate('audioEngine.pause()')

    def test_real_audition_all_twenty_prepared_algorithms_and_notes_editor(self):
        self.workspace.load_audio()
        result=self.page.evaluate('''async()=>{
          const audition=new PresetAudioAudition(),rows=[];
          for(const preset of PROJECT_SCHEMA.creativeAudioPresets.filter(p=>p.prepared)){const buffer=await audition.play(validateCreativeAudioFx({preset:preset.id}),137,false);rows.push({id:preset.id,length:buffer.length,finite:buffer.getChannelData(0).every(Number.isFinite),nonzero:buffer.getChannelData(0).some(v=>Math.abs(v)>.00001)});audition.stop();}return rows;
        }''')
        self.assertEqual(len(result),20)
        for row in result:self.assertTrue(row['length']>0 and row['finite'] and row['nonzero'],row)
        self.show('#creativeAudioPresets');panel=self.page.locator('#creativeAudioPresets');panel.evaluate('(e)=>e.open=true');panel.locator('[data-preset="AFX-48"]').click();field=panel.locator('textarea[data-fx-parameter="notes"]');field.fill('0,4,7');field.press('Tab')
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.audioFx.parameters.notes'),'0,4,7');self.page.evaluate('projectStore.undo()');self.assertEqual(field.input_value(),'0,7,12')

    def test_pump_source_picker_and_cancelled_preparation_never_publish_stale_audio(self):
        self.workspace.load_audio();self.show('#creativeAudioPresets');panel=self.page.locator('#creativeAudioPresets');panel.evaluate('(e)=>e.open=true');panel.locator('[data-preset="AFX-43"]').click();panel.locator('.fx-detector-source').select_option('t:rain')
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.sidechain.source'),'t:rain');self.assertFalse(self.page.evaluate('projectStore.state.tracks.main.sidechain.enabled'))
        self.page.evaluate('projectStore.undo()');self.assertEqual(panel.locator('.fx-detector-source').input_value(),'')
        self.page.evaluate("projectStore.update(p=>{p.tracks.main.audioFx=validateCreativeAudioFx({preset:'AFX-08'});});window.originalPreparedRequest=requestPreparedAudio;requestPreparedAudio=async(...args)=>{const buffer=await originalPreparedRequest(...args);await new Promise(resolve=>window.releasePrepared=resolve);return buffer;};void audioEngine.play()")
        wait_for_browser(self.page,'!!window.releasePrepared',timeout=60000)
        self.page.evaluate('projectStore.update(p=>{p.tracks.main.audioFx.parameters.rise=.5;});requestPreparedAudio=originalPreparedRequest;releasePrepared()')
        wait_for_browser(self.page,'!audioEngine.preparedMix.controller')
        self.assertFalse(self.page.evaluate('!!audioEngine.preparedMix.buffer||!!audioEngine.preparedMix.source||audioEngine.wsMain.isPlaying()'))
