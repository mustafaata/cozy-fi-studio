"""Native listening, export DSP parity and authoring under production CSP."""
import unittest
import numpy as np
import test_controller_ui as controller_ui
from project import SCHEMA, validate_creative_audio_fx
from creative_audio import AudioPresetProcessor, preset_impulse


class AudioPresetsUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):controller_ui.ControllerUI.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls):controller_ui.ControllerUI.tearDownClass.__func__(cls)
    setUp=controller_ui.ControllerUI.setUp
    tearDown=controller_ui.ControllerUI.tearDown
    show=controller_ui.ControllerUI.show

    def test_all_native_processors_match_streaming_export(self):
        sample_rate,frames=8000,14000
        samples=np.zeros((2,frames),dtype=np.float32);samples[:,0]=[.5,.3];samples[:,2400:3000]=.15;samples[:,6000]=[-.3,.2]
        for preset in (p for p in SCHEMA['creativeAudioPresets'] if not p.get('prepared')):
            with self.subTest(preset=preset['id']):
                fx=validate_creative_audio_fx({'preset':preset['id']})
                actual=self.page.evaluate('''async ({fx,samples,sampleRate,frames})=>{
                  const ctx=new OfflineAudioContext(2,frames,sampleRate);if(audioPresetDefinition(fx).algorithm==='duck')await prepareDynamicsContext(ctx);
                  const spec=audioPresetWorkletSpec(audioPresetDefinition(fx));if(spec)await prepareAudioPresetWorkletContext(ctx,spec);
                  const buffer=ctx.createBuffer(2,frames,sampleRate);samples.forEach((values,c)=>buffer.copyToChannel(Float32Array.from(values),c));
                  const track=validateProject({version:PROJECT_SCHEMA.version,tracks:{main:{audioFx:fx}}}).tracks.main;
                  const source=ctx.createBufferSource(),node=new TrackEffectsNode(ctx,ctx.destination,()=>trackReverbImpulse(ctx));source.buffer=buffer;source.connect(node.input);node.schedule(track,0,0,true,frames/sampleRate,120);source.start();
                  const output=await ctx.startRendering();node.disconnect();return [Array.from(output.getChannelData(0)),Array.from(output.getChannelData(1))];
                }''',dict(fx=fx,samples=samples.tolist(),sampleRate=sample_rate,frames=frames))
                expected=AudioPresetProcessor(fx,sample_rate).process(samples,0)
                np.testing.assert_allclose(actual,expected,atol=3e-5,rtol=3e-4)
                if preset['algorithm']=='room':
                    native=self.page.evaluate('s=>audioPresetImpulseData(s,8000).map(a=>Array.from(a))',fx)
                    np.testing.assert_allclose(native,preset_impulse(fx,8000),atol=2e-7)

    def test_channel_and_bus_targets_tempo_automation_preview_and_audition(self):
        self.workspace.load_audio();self.show('#creativeAudioPresets');panel=self.page.locator('#creativeAudioPresets');panel.evaluate('(e)=>e.open=true')
        self.assertEqual(panel.locator('.fx-preset').count(),50)
        history=self.page.evaluate('projectStore.past.length');panel.locator('[data-preset="AFX-12"]').click()
        self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.audioFx.preset'),'AFX-12')
        self.assertEqual(self.page.evaluate("audioPresetDelay(projectStore.state.tracks.main.audioFx,60)"),.75)
        self.assertFalse(panel.locator('.fx-key-param option[value="beats"]').count())
        self.assertEqual(panel.locator('.fx-key-param option[value="gain"]').count(),1)
        panel.locator('.fx-compare').click();self.assertFalse(self.page.evaluate('audioEngine.audioFxDraft.tracks.main.audioFx.enabled'))
        panel.locator('.fx-compare').click();self.assertTrue(self.page.evaluate('audioEngine.audioFxDraft===null'))
        slider=panel.locator('input[type=range][data-fx-parameter="amount"]');history=self.page.evaluate('projectStore.past.length')
        slider.evaluate("e=>{e.value='40';e.dispatchEvent(new Event('input',{bubbles:true}));}")
        self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
        slider.dispatch_event('pointercancel');self.assertEqual(slider.input_value(),'25')
        self.page.evaluate("projectStore.update(p=>{p.audioBuses.push({...projectFields({},'audioBus'),id:'fx-bus',name:'FX Grubu'});})")
        panel.locator('.fx-target').select_option('b:fx-bus');panel.locator('[data-preset="AFX-01"]').click()
        self.assertEqual(self.page.evaluate('projectStore.state.audioBuses[0].audioFx.preset'),'AFX-01')
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.audioFx.preset'),'AFX-12')
        history=self.page.evaluate('projectStore.past.length')
        length=self.page.evaluate("async()=>{const result=await audioPresetBrowser.audition.play(validateCreativeAudioFx({preset:'AFX-15'}),120,true);audioPresetBrowser.audition.stop();return result.length;}")
        self.assertGreater(length,10000);self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
        for width in [320,375,768,1024,1440]:
            self.page.set_viewport_size(dict(width=width,height=900));self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)

    def test_native_automation_refills_match_export_over_whole_clip(self):
        sample_rate,frames=8000,12000
        samples=np.random.default_rng(83).normal(0,.04,(2,frames)).astype(np.float32)
        fx=validate_creative_audio_fx(dict(preset='AFX-13',automation=dict(amount=[[0,10],[1.5,80]],gain=[[0,-6],[1.5,0]],tone=[[0,1000],[1.5,3000]])))
        actual=self.page.evaluate('''async({fx,samples,sampleRate,frames})=>{
          const ctx=new OfflineAudioContext(2,frames,sampleRate),buffer=ctx.createBuffer(2,frames,sampleRate);samples.forEach((values,c)=>buffer.copyToChannel(Float32Array.from(values),c));
          const source=ctx.createBufferSource(),node=new AudioPresetNode(ctx,ctx.destination);source.buffer=buffer;source.connect(node.input);
          node.schedule(fx,0,0,true,frames/sampleRate,120);
          const refills=[];for(let time=PROJECT_SCHEMA.trackEffects.refill;time<frames/sampleRate;time+=PROJECT_SCHEMA.trackEffects.refill)refills.push(ctx.suspend(time).then(()=>{node.schedule(fx,ctx.currentTime,ctx.currentTime,true,frames/sampleRate,120);return ctx.resume();}));
          source.start();const rendering=ctx.startRendering();await Promise.all(refills);const output=await rendering;node.disconnect();return [Array.from(output.getChannelData(0)),Array.from(output.getChannelData(1))];
        }''',dict(fx=fx,samples=samples.tolist(),sampleRate=sample_rate,frames=frames))
        expected=AudioPresetProcessor(fx,sample_rate).process(samples,0)
        np.testing.assert_allclose(actual,expected,atol=5e-5,rtol=5e-4)

    def test_live_room_changes_crossfade_and_release_bounded_resources(self):
        actual=self.page.evaluate('''async()=>{
          const ctx=new AudioContext();await ctx.resume();const node=new AudioPresetNode(ctx,ctx.destination);
          try{for(let i=0;i<12;i++){const settings=validateCreativeAudioFx({preset:'AFX-01',parameters:{size:.5+i*.1}});node.schedule(settings,0,ctx.currentTime,true,2,120);}
            const result={retired:node.retired.length,impulses:audioPresetImpulses.get(ctx).size,fade:node.branchFadeStart!==null};node.disconnect();result.after=node.retired.length;return result;
          }finally{await ctx.close();}
        }''')
        self.assertLessEqual(actual['retired'],2);self.assertLessEqual(actual['impulses'],8)
        self.assertTrue(actual['fade']);self.assertEqual(actual['after'],0)

    def test_modulation_control_curves_and_refills_match_native_at_delivery_rate(self):
        sample_rate,frames=44100,44100
        clock=np.arange(frames)/sample_rate
        samples=np.stack([.1*np.sin(2*np.pi*220*clock)+.03*np.sin(2*np.pi*950*clock),.1*np.sin(2*np.pi*337*clock)]).astype(np.float32)
        for preset in SCHEMA['creativeAudioPresets'][10:15]:
            with self.subTest(preset=preset['id']):
                key='speed' if preset['algorithm']=='rotary' else 'rate';spec=preset['parameters'][key]
                curves={key:[[0,spec['default'],dict(type='smooth')],[.5,spec['min'],dict(type='hold')],[.75,spec['max']]],'amount':[[0,30],[1,80]],'gain':[[0,-6],[1,-3]]}
                fx=validate_creative_audio_fx(dict(preset=preset['id'],automation=curves))
                actual=self.page.evaluate('''async({fx,samples,sampleRate,frames})=>{
                  const ctx=new OfflineAudioContext(2,frames,sampleRate);await prepareAudioModulationContext(ctx);
                  const buffer=ctx.createBuffer(2,frames,sampleRate);samples.forEach((values,c)=>buffer.copyToChannel(Float32Array.from(values),c));
                  const source=ctx.createBufferSource(),node=new AudioPresetNode(ctx,ctx.destination);source.buffer=buffer;source.connect(node.input);node.schedule(fx,0,0,true,frames/sampleRate,120);
                  const refills=[];for(let time=PROJECT_SCHEMA.trackEffects.refill;time<frames/sampleRate;time+=PROJECT_SCHEMA.trackEffects.refill)refills.push(ctx.suspend(time).then(()=>{node.schedule(fx,ctx.currentTime,ctx.currentTime,true,frames/sampleRate,120);return ctx.resume();}));
                  source.start();const rendering=ctx.startRendering();await Promise.all(refills);const output=await rendering;node.disconnect();return [Array.from(output.getChannelData(0)),Array.from(output.getChannelData(1))];
                }''',dict(fx=fx,samples=samples.tolist(),sampleRate=sample_rate,frames=frames))
                expected=AudioPresetProcessor(fx,sample_rate).process(samples,0)
                np.testing.assert_allclose(actual,expected,atol=5e-5,rtol=5e-4)

    def test_modulation_authoring_bus_keys_and_audition(self):
        self.workspace.load_audio();self.show('#creativeAudioPresets');panel=self.page.locator('#creativeAudioPresets');panel.evaluate('(e)=>e.open=true')
        panel.locator('.fx-search').fill('modülasyon');self.assertEqual(panel.locator('.fx-preset').count(),5)
        panel.locator('[data-preset="AFX-18"]').click()
        panel.locator('select[data-fx-parameter="stages"]').select_option('8')
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.audioFx.parameters.stages'),8)
        self.assertFalse(panel.locator('.fx-key-param option[value="stages"]').count())
        panel.locator('.fx-keys').evaluate('(e)=>e.open=true');panel.locator('.fx-key-param').select_option('rate')
        panel.locator('.fx-key-time').fill('.5');panel.locator('.fx-key-value').fill('1.2');panel.locator('.fx-key-add').click()
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.audioFx.automation.rate[0][1]'),1.2)
        self.page.evaluate("projectStore.update(p=>p.audioBuses.push({...projectFields({},'audioBus'),id:'rotor',name:'Rotor'}))")
        panel.locator('.fx-target').select_option('b:rotor');panel.locator('[data-preset="AFX-20"]').click()
        field=panel.locator('input[type=number][data-fx-parameter="speed"]');history=self.page.evaluate('projectStore.past.length');field.fill('25');field.press('Tab')
        self.assertEqual(self.page.evaluate('projectStore.state.audioBuses[0].audioFx.parameters.speed'),25)
        self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
        self.page.evaluate('projectStore.undo()');self.assertEqual(field.input_value(),'100');self.page.evaluate('projectStore.redo()')
        panel.locator('.fx-save-name').fill('Rotor 25');panel.locator('.fx-save').click()
        self.assertEqual(self.page.evaluate('audioPresetBrowser.library.custom[0].settings.parameters.speed'),25)
        self.assertEqual(self.page.evaluate('audioPresetBrowser.library.custom[0].settings.automation'),{})
        history=self.page.evaluate('projectStore.past.length')
        audition=self.page.evaluate("async()=>{const result=await audioPresetBrowser.audition.play(validateCreativeAudioFx({preset:'AFX-19'}),120,true);audioPresetBrowser.audition.stop();return {frames:result.length,rms:Math.sqrt(result.getChannelData(0).reduce((s,v)=>s+v*v,0)/result.length)};}")
        self.assertGreater(audition['frames'],10000);self.assertGreater(audition['rms'],.01);self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
        for theme in ('dark','light'):
            self.page.emulate_media(color_scheme=theme)
            for width in [320,375,768,1024,1440]:
                self.page.set_viewport_size(dict(width=width,height=900));self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
                self.assertTrue(panel.locator('.fx-preset').first.evaluate('(e)=>{const text=e.querySelector("strong").getBoundingClientRect(),card=e.getBoundingClientRect();return text.bottom<=card.bottom+1&&text.right<=card.right+1;}'))

    def test_hot_modulation_load_switch_and_disposal_keep_latest_selection(self):
        result=self.page.evaluate('''async()=>{
          const ctx=new AudioContext();await ctx.resume();const node=new AudioPresetNode(ctx,ctx.destination);
          try{
            const mod=validateCreativeAudioFx({preset:'AFX-16'}),room=validateCreativeAudioFx({preset:'AFX-01'});
            node.schedule(mod,0,ctx.currentTime,true,10,120);const pending=!!node.preparing;node.schedule(room,0,ctx.currentTime,true,10,120);await node.preparing;
            const latest=node.key.includes('AFX-01')&&!node.worklet;
            for(let i=0;i<12;i++)node.schedule(validateCreativeAudioFx({preset:i%2?'AFX-18':'AFX-16',parameters:i%2?{stages:i%4?8:4}:{voices:2+i%5}}),0,ctx.currentTime,true,10,120);
            const retired=node.retired.length,active=!!node.worklet,fade=node.branchFadeStart!==null;node.disconnect();
            const orphan=new AudioPresetNode(ctx,ctx.destination);orphan.schedule(mod,0,ctx.currentTime,true,10,120);orphan.disconnect();
            return {pending,latest,retired,active,fade,after:node.retired.length,closed:orphan.disconnected};
          }finally{await ctx.close();}
        }''')
        self.assertTrue(result['pending']);self.assertTrue(result['latest']);self.assertTrue(result['active']);self.assertTrue(result['fade'])
        self.assertLessEqual(result['retired'],2);self.assertEqual(result['after'],0);self.assertTrue(result['closed'])

    def test_rejected_worklet_preparation_reports_error_and_explicit_retry_recovers(self):
        result=self.page.evaluate('''async()=>{
          const ctx=window.__retryModContext=new AudioContext();await ctx.resume();const node=window.__retryModNode=new AudioPresetNode(ctx,ctx.destination),errors=[];
          // Chromium's worklet module fetch bypasses page.route interception.
          // Inject rejection at the platform boundary and retry the real module.
          window.__retryModLoader=ctx.audioWorklet.addModule.bind(ctx.audioWorklet);ctx.audioWorklet.addModule=()=>Promise.reject(new Error('Injected module load failure'));
          const onerror=event=>errors.push(event.detail);document.addEventListener('studio-error',onerror);
          node.schedule(validateCreativeAudioFx({preset:'AFX-17'}),0,ctx.currentTime,true,3,120);await node.preparing;
          document.removeEventListener('studio-error',onerror);return {errors,active:node.active,failed:node.preparationFailed};
        }''')
        self.assertEqual(len(result['errors']),1);self.assertIn('Modülasyon',result['errors'][0]);self.assertFalse(result['active']);self.assertTrue(result['failed'])
        recovered=self.page.evaluate('''async()=>{
          const ctx=window.__retryModContext,node=window.__retryModNode;
          try{ctx.audioWorklet.addModule=window.__retryModLoader;await prepareAudioModulationContext(ctx);node.schedule(validateCreativeAudioFx({preset:'AFX-17'}),0,ctx.currentTime,true,3,120);return !!node.worklet;}
          finally{node.disconnect();await ctx.close();delete window.__retryModContext;delete window.__retryModNode;delete window.__retryModLoader;}
        }''')
        self.assertTrue(recovered)
