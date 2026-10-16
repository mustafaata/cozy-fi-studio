"""Character authoring and genuine AudioWorklet/file DSP parity under WSGI/CSP."""
import json
from pathlib import Path
import unittest
import numpy as np
import test_controller_ui as controller_ui
from creative_audio import AudioPresetProcessor
from project import SCHEMA, validate_creative_audio_fx


class CharacterUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):controller_ui.ControllerUI.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls):controller_ui.ControllerUI.tearDownClass.__func__(cls)
    setUp=controller_ui.ControllerUI.setUp
    tearDown=controller_ui.ControllerUI.tearDown
    show=controller_ui.ControllerUI.show

    def assert_native_parity(self, sr, frames, first, presets=None, overrides=None):
        clock=np.arange(frames)/sr
        samples=np.stack([.12*np.sin(2*np.pi*220*clock)+.03*np.sin(2*np.pi*4100*clock),.1*np.sin(2*np.pi*337*clock)]).astype(np.float32)
        for preset in presets or SCHEMA['creativeAudioPresets'][20:30]:
            with self.subTest(preset=preset['id'],sr=sr,first=first):
                key=next(k for k in preset['parameterOrder'] if k!='gain' and preset['parameters'][k]['automatable'])
                spec=preset['parameters'][key]
                fx=validate_creative_audio_fx(dict(preset=preset['id'],automation={key:[[0,spec['default'],dict(type='smooth')],[.5,spec['min'],dict(type='hold')],[.75,spec['max']]],'amount':[[0,20],[2,90]],'gain':[[0,-6],[2,-3]]}))
                if overrides is not None:fx=validate_creative_audio_fx({**fx,**overrides})
                actual=self.page.evaluate('''async({fx,samples,sr,frames,first})=>{
                  const ctx=new OfflineAudioContext(2,frames,sr);await prepareAudioCharacterContext(ctx);
                  const buffer=ctx.createBuffer(2,frames,sr);samples.forEach((values,c)=>buffer.copyToChannel(Float32Array.from(values),c));
                  const source=ctx.createBufferSource(),node=new AudioPresetNode(ctx,ctx.destination);source.buffer=buffer;source.connect(node.input);node.schedule(fx,first/sr,0,true,(first+frames)/sr,137);
                  const refills=[];for(let t=PROJECT_SCHEMA.trackEffects.refill;t<frames/sr;t+=PROJECT_SCHEMA.trackEffects.refill)refills.push(ctx.suspend(t).then(()=>{node.schedule(fx,first/sr+ctx.currentTime,ctx.currentTime,true,(first+frames)/sr,137);return ctx.resume();}));
                  source.start();const rendering=ctx.startRendering();await Promise.all(refills);const out=await rendering;node.disconnect();return [Array.from(out.getChannelData(0)),Array.from(out.getChannelData(1))];
                }''',dict(fx=fx,samples=samples.tolist(),sr=sr,frames=frames,first=first))
                expected=AudioPresetProcessor(fx,sr,137).process(samples,first)
                delta=np.abs(np.asarray(actual)-expected)
                violations=np.argwhere(delta>5e-5+5e-4*np.abs(expected))
                if len(violations):
                    details=[dict(channel=int(c),frame=int(i),actual=actual[c][i],expected=float(expected[c,i]),delta=float(delta[c,i])) for c,i in violations[:20]]
                    (Path(__file__).resolve().parents[1]/'.local'/f"character-parity-{preset['id']}-{sr}.json").write_text(json.dumps(details,indent=2),encoding='utf-8')
                np.testing.assert_allclose(actual,expected,atol=5e-5,rtol=5e-4)

    def test_delivery_rate_all_ten_automated_worklets_and_refills_match_file_dsp(self):
        self.assert_native_parity(44100,52920,0)

    def test_48k_all_ten_cold_seek_clocks_and_automation_match_file_dsp(self):
        self.assert_native_parity(48000,48000,19200)

    def test_sequence_editing_history_copies_search_drafts_locks_and_responsive(self):
        self.workspace.load_audio();self.show('#creativeAudioPresets');panel=self.page.locator('#creativeAudioPresets');panel.evaluate('(e)=>e.open=true')
        self.assertEqual(panel.locator('.fx-preset').count(),50)
        panel.locator('[data-preset="AFX-38"]').click();steps=panel.locator('.fx-sequence button');self.assertEqual(steps.count(),16)
        first=steps.first;history=self.page.evaluate('projectStore.past.length');first.focus();self.page.keyboard.press('Space')
        self.assertEqual(first.get_attribute('aria-pressed'),'false');self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
        self.page.evaluate('projectStore.undo()');self.assertEqual(first.get_attribute('aria-pressed'),'true');self.page.evaluate('projectStore.redo()')
        self.assertFalse(panel.locator('.fx-key-param option[value="step01"]').count())
        panel.locator('.fx-save-name').fill('Benim ritmim');panel.locator('.fx-save').click();self.assertEqual(self.page.evaluate('audioPresetBrowser.library.custom[0].settings.parameters.step01'),0)
        panel.locator('.fx-compare').click();self.assertTrue(first.is_disabled());panel.locator('.fx-compare').click()
        panel.locator('[data-preset="AFX-39"]').click();levels=panel.locator('.fx-sequence input');self.assertEqual(levels.count(),16);levels.first.fill('72');levels.first.press('Tab');self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.audioFx.parameters.step01'),72)
        levels.first.fill('101');levels.first.press('Tab');self.assertEqual(levels.first.input_value(),'72')
        self.page.evaluate("projectStore.update(p=>p.audioBuses.push({...projectFields({},'audioBus'),id:'rhythm',name:'Ritim'}))")
        panel.locator('.fx-target').select_option('b:rhythm');panel.locator('[data-preset="AFX-40"]').click();self.assertEqual(panel.locator('.fx-sequence button').count(),16)
        panel.locator('[data-preset="AFX-27"]').click();slider=panel.locator('input[type=range][data-fx-parameter="density"]');history=self.page.evaluate('projectStore.past.length');slider.evaluate("e=>{e.value=50;e.dispatchEvent(new Event('input',{bubbles:true}));}");self.assertEqual(self.page.evaluate('audioEngine.audioFxDraft.audioBuses[0].audioFx.parameters.density'),50)
        slider.dispatch_event('pointercancel');self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
        panel.locator('[data-preset="AFX-38"]').click()
        for theme in ('dark','light'):
            self.page.emulate_media(color_scheme=theme)
            for width in (320,375,768,1024,1440):
                self.page.set_viewport_size(dict(width=width,height=900));self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
                self.assertTrue(panel.locator('.fx-sequence').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'))
        panel.locator('.fx-sequence').screenshot(path=str(Path(__file__).resolve().parents[1]/'.local/character-sequence.png'))
        history=self.page.evaluate('projectStore.past.length');self.page.keyboard.press('Control+k');query=self.page.locator('#studioToolQuery');query.fill('Sample Rate Dust');self.assertEqual(self.page.locator('.tool-result').count(),1);query.press('Enter');self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
        self.page.evaluate('window.change(p=>p.audioBuses[0].groupLocked=true)');self.assertTrue(panel.locator('.fx-sequence button').first.is_disabled())

    def test_real_transport_prepares_track_and_bus_and_rebuilds_on_tempo_change(self):
        self.workspace.load_audio()
        self.page.evaluate("projectStore.update(p=>{p.effects.speed=1;p.tracks.main.audioFx=validateCreativeAudioFx({preset:'AFX-28'});p.audioBuses=[{...projectFields({},'audioBus'),id:'rhythm',name:'Ritim',audioFx:validateCreativeAudioFx({preset:'AFX-38'})}];p.tracks.main.bus='rhythm';})")
        result=self.page.evaluate('''async()=>{
          await audioEngine.play();const bus=audioEngine.routing.buses.get('rhythm').effects.preset,old=bus.worklet.node,track=audioEngine.trackNodes.main.effects.preset;
          const before={playing:audioEngine.wsMain.isPlaying(),track:track.worklet.preset.id,bus:bus.worklet.preset.id,dryDelay:track.dryDelay.delayTime.value};
          projectStore.update(p=>p.rhythm.bpm=137);audioEngine.scheduleTrackEffects();const changed=old!==bus.worklet.node;audioEngine.pause();return {...before,changed};
        }''')
        self.assertTrue(result['playing']);self.assertEqual(result['track'],'AFX-28');self.assertEqual(result['bus'],'AFX-38');self.assertAlmostEqual(result['dryDelay'],.03,places=6);self.assertTrue(result['changed'])

    def test_audition_and_bounded_hot_switches_across_three_families(self):
        result=self.page.evaluate('''async()=>{
          const ctx=new AudioContext();await ctx.resume();await Promise.all([prepareAudioCharacterContext(ctx),prepareAudioModulationContext(ctx),prepareAudioDistortionContext(ctx)]);const node=new AudioPresetNode(ctx,ctx.destination);
          try{for(let i=0;i<15;i++)node.schedule(validateCreativeAudioFx({preset:['AFX-28','AFX-21','AFX-38'][i%3]}),0,ctx.currentTime,true,10,137);
            const retired=node.retired.length,delay=node.dryDelay===null;node.disconnect();const settings=validateCreativeAudioFx({preset:'AFX-40'}),audition=new PresetAudioAudition(),out=await audition.play(settings,137,true);audition.stop();return {retired,delay,after:node.retired.length,frames:out.length,rms:Math.sqrt(out.getChannelData(0).reduce((s,v)=>s+v*v,0)/out.length)};
          }finally{node.disconnect();await ctx.close();}
        }''')
        self.assertLessEqual(result['retired'],2);self.assertTrue(result['delay']);self.assertEqual(result['after'],0);self.assertGreater(result['frames'],10000);self.assertGreater(result['rms'],.01)

    def test_realtime_quantum_profile_and_maximum_stutter_memory(self):
        result=self.page.evaluate('''()=>{
          const sr=48000,input=[new Float32Array(128).fill(.15),new Float32Array(128).fill(-.1)],output=input.map(()=>new Float32Array(128)),rows=[];
          for(const preset of PROJECT_SCHEMA.creativeAudioPresets.slice(20,30)){const s=validateCreativeAudioFx({preset:preset.id}),dsp=new AudioCharacterDSP(sr,preset.algorithm,s.parameters,137),times=[];for(let i=0;i<80;i++){const start=performance.now();dsp.process(input,output,{},i*128);times.push(performance.now()-start);}rows.push({id:preset.id,median:times.sort((a,b)=>a-b)[40]});}
          const s=validateCreativeAudioFx({preset:'AFX-40',parameters:{beats:4}}),dsp=new AudioCharacterDSP(sr,'stutter',s.parameters,20);return {rows,maxCellFrames:dsp.cellLength,totalBufferBytes:[...dsp.capture,...dsp.recorded].reduce((s,v)=>s+v.byteLength,0)};
        }''')
        (Path(__file__).resolve().parents[1]/'.local/character-profile.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        self.assertEqual(result['maxCellFrames'],576000);self.assertEqual(result['totalBufferBytes'],9216000)
        for row in result['rows']:self.assertLess(row['median'],128/48000*1000,row)
