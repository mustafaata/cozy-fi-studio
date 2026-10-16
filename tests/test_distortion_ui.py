"""Distortion authoring and real AudioWorklet/export parity under WSGI/CSP."""
import unittest
import numpy as np
import test_controller_ui as controller_ui
from creative_audio import AudioPresetProcessor
from project import SCHEMA,validate_creative_audio_fx


class DistortionUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):controller_ui.ControllerUI.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls):controller_ui.ControllerUI.tearDownClass.__func__(cls)
    setUp=controller_ui.ControllerUI.setUp
    tearDown=controller_ui.ControllerUI.tearDown
    show=controller_ui.ControllerUI.show

    def test_delivery_rate_automation_and_refills_match_native_distortion(self):
        sr,frames=44100,44100;clock=np.arange(frames)/sr
        samples=np.stack([.12*np.sin(2*np.pi*220*clock)+.03*np.sin(2*np.pi*4100*clock),.1*np.sin(2*np.pi*337*clock)]).astype(np.float32)
        for preset in SCHEMA['creativeAudioPresets'][15:20]:
            with self.subTest(preset=preset['id']):
                key='fuzz' if preset['algorithm']=='fuzz' else 'threshold' if preset['algorithm']=='wavefold' else 'drive';spec=preset['parameters'][key]
                fx=validate_creative_audio_fx(dict(preset=preset['id'],automation={key:[[0,spec['default'],dict(type='smooth')],[.5,spec['min'],dict(type='hold')],[.75,spec['max']]],'amount':[[0,20],[1,90]],'gain':[[0,-6],[1,-3]]}))
                actual=self.page.evaluate('''async({fx,samples,sr,frames})=>{
                  const ctx=new OfflineAudioContext(2,frames,sr);await prepareAudioDistortionContext(ctx);
                  const buffer=ctx.createBuffer(2,frames,sr);samples.forEach((values,c)=>buffer.copyToChannel(Float32Array.from(values),c));
                  const source=ctx.createBufferSource(),node=new AudioPresetNode(ctx,ctx.destination);source.buffer=buffer;source.connect(node.input);node.schedule(fx,0,0,true,frames/sr,120);
                  const refills=[];for(let time=PROJECT_SCHEMA.trackEffects.refill;time<frames/sr;time+=PROJECT_SCHEMA.trackEffects.refill)refills.push(ctx.suspend(time).then(()=>{node.schedule(fx,ctx.currentTime,ctx.currentTime,true,frames/sr,120);return ctx.resume();}));
                  source.start();const rendering=ctx.startRendering();await Promise.all(refills);const output=await rendering;node.disconnect();return [Array.from(output.getChannelData(0)),Array.from(output.getChannelData(1))];
                }''',dict(fx=fx,samples=samples.tolist(),sr=sr,frames=frames))
                expected=AudioPresetProcessor(fx,sr).process(samples,0)
                np.testing.assert_allclose(actual,expected,atol=5e-5,rtol=5e-4)

    def test_native_zero_mix_is_exactly_sixteen_frames_late(self):
        result=self.page.evaluate('''async()=>{
          const ctx=new OfflineAudioContext(2,256,44100);await prepareAudioDistortionContext(ctx);
          const buffer=ctx.createBuffer(2,256,44100);buffer.getChannelData(0)[0]=.5;
          const source=ctx.createBufferSource(),node=new AudioPresetNode(ctx,ctx.destination);source.buffer=buffer;source.connect(node.input);
          node.schedule(validateCreativeAudioFx({preset:'AFX-25',amount:0,parameters:{gain:0}}),0,0,true,256/44100,120);source.start();const output=await ctx.startRendering();node.disconnect();return Array.from(output.getChannelData(0));
        }''')
        expected=np.zeros(256);expected[16]=.5;np.testing.assert_allclose(result,expected,atol=1e-7)

    def test_distortion_catalog_search_targets_curves_copies_and_audition(self):
        self.workspace.load_audio();self.show('#creativeAudioPresets');panel=self.page.locator('#creativeAudioPresets');panel.evaluate('(e)=>e.open=true')
        panel.locator('.fx-search').fill('distorsiyon');self.assertEqual(panel.locator('.fx-preset').count(),5)
        thumbnails=panel.locator('.fx-preset canvas').evaluate_all('(nodes)=>nodes.map(n=>n.toDataURL())');self.assertEqual(len(set(thumbnails)),5)
        panel.locator('[data-preset="AFX-25"]').click();panel.locator('select[data-fx-parameter="folds"]').select_option('6')
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.audioFx.parameters.folds'),6)
        self.assertFalse(panel.locator('.fx-key-param option[value="folds"]').count())
        panel.locator('.fx-keys').evaluate('(e)=>e.open=true');panel.locator('.fx-key-param').select_option('threshold');panel.locator('.fx-key-time').fill('.5');panel.locator('.fx-key-value').fill('.35');panel.locator('.fx-key-add').click()
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.audioFx.automation.threshold[0][1]'),.35)
        self.page.evaluate("projectStore.update(p=>p.audioBuses.push({...projectFields({},'audioBus'),id:'tape',name:'Bant'}))")
        panel.locator('.fx-target').select_option('b:tape');panel.locator('[data-preset="AFX-21"]').click()
        field=panel.locator('input[type=number][data-fx-parameter="drive"]');history=self.page.evaluate('projectStore.past.length');field.fill('24');field.press('Tab')
        self.assertEqual(self.page.evaluate('projectStore.state.audioBuses[0].audioFx.parameters.drive'),24);self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
        self.page.evaluate('projectStore.undo()');self.assertEqual(field.input_value(),'12');self.page.evaluate('projectStore.redo()')
        panel.locator('.fx-save-name').fill('Bant 24');panel.locator('.fx-save').click();self.assertEqual(self.page.evaluate('audioPresetBrowser.library.custom[0].settings.parameters.drive'),24)
        self.assertEqual(self.page.evaluate('audioPresetBrowser.library.custom[0].settings.automation'),{})
        history=self.page.evaluate('projectStore.past.length');self.page.keyboard.press('Control+k');query=self.page.locator('#studioToolQuery');query.fill('Warm Tape');self.assertEqual(self.page.locator('.tool-result').count(),1);query.press('Enter')
        self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
        audition=self.page.evaluate("async()=>{const output=await audioPresetBrowser.audition.play(validateCreativeAudioFx({preset:'AFX-23'}),120,true);audioPresetBrowser.audition.stop();return {frames:output.length,rms:Math.sqrt(output.getChannelData(0).reduce((s,v)=>s+v*v,0)/output.length)};}")
        self.assertGreater(audition['frames'],10000);self.assertGreater(audition['rms'],.01);self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
        for theme in ('dark','light'):
            self.page.emulate_media(color_scheme=theme)
            for width in [320,375,768,1024,1440]:
                self.page.set_viewport_size(dict(width=width,height=900));self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
                self.assertTrue(panel.locator('.fx-preset').first.evaluate('(e)=>{const text=e.querySelector("strong").getBoundingClientRect(),card=e.getBoundingClientRect();return text.bottom<=card.bottom+1&&text.right<=card.right+1;}'))

    def test_hot_family_switch_waits_for_latest_processor_and_releases_dry_delay(self):
        result=self.page.evaluate('''async()=>{
          const ctx=new AudioContext();await ctx.resume();const node=new AudioPresetNode(ctx,ctx.destination);
          try{
            node.schedule(validateCreativeAudioFx({preset:'AFX-21'}),0,ctx.currentTime,true,10,120);
            node.schedule(validateCreativeAudioFx({preset:'AFX-16'}),0,ctx.currentTime,true,10,120);while(node.preparing)await node.preparing;
            const latest=node.worklet?.preset.id==='AFX-16';
            for(let i=0;i<12;i++)node.schedule(validateCreativeAudioFx({preset:i%2?'AFX-16':'AFX-25'}),0,ctx.currentTime,true,10,120);
            const retired=node.retired.length,noDryDelay=node.dryDelay===null,active=node.worklet?.preset.id==='AFX-16';node.disconnect();return {latest,retired,noDryDelay,active,after:node.retired.length};
          }finally{await ctx.close();}
        }''')
        self.assertTrue(result['latest']);self.assertTrue(result['noDryDelay']);self.assertTrue(result['active']);self.assertLessEqual(result['retired'],2);self.assertEqual(result['after'],0)

    def test_failed_distortion_preparation_does_not_block_modulation_and_retries(self):
        result=self.page.evaluate('''async()=>{
          const ctx=new AudioContext();await ctx.resume();await prepareAudioModulationContext(ctx);
          const node=new AudioPresetNode(ctx,ctx.destination),load=ctx.audioWorklet.addModule.bind(ctx.audioWorklet),errors=[];const onerror=event=>errors.push(event.detail);document.addEventListener('studio-error',onerror);
          try{
            ctx.audioWorklet.addModule=()=>Promise.reject(new Error('Injected rejection'));
            node.schedule(validateCreativeAudioFx({preset:'AFX-22'}),0,ctx.currentTime,true,3,120);await node.preparing;
            node.schedule(validateCreativeAudioFx({preset:'AFX-16'}),0,ctx.currentTime,true,3,120);const modulation=node.worklet?.preset.id==='AFX-16';
            ctx.audioWorklet.addModule=load;await prepareAudioDistortionContext(ctx);node.schedule(validateCreativeAudioFx({preset:'AFX-22'}),0,ctx.currentTime,true,3,120);
            return {modulation,retried:node.worklet?.preset.id==='AFX-22',errors};
          }finally{document.removeEventListener('studio-error',onerror);node.disconnect();await ctx.close();}
        }''')
        self.assertTrue(result['modulation']);self.assertTrue(result['retried']);self.assertEqual(len(result['errors']),1);self.assertIn('Distorsiyon',result['errors'][0])

    def test_real_transport_prepares_track_distortion_and_bus_modulation(self):
        self.workspace.load_audio()
        self.page.evaluate("projectStore.update(p=>{p.effects.speed=1;p.tracks.main.audioFx=validateCreativeAudioFx({preset:'AFX-24'});p.audioBuses=[{...projectFields({},'audioBus'),id:'stereo',name:'Stereo',audioFx:validateCreativeAudioFx({preset:'AFX-16'})}];p.tracks.main.bus='stereo';})")
        result=self.page.evaluate('''async()=>{
          await audioEngine.play();const result={playing:audioEngine.wsMain.isPlaying(),track:audioEngine.trackNodes.main.effects.preset?.worklet?.preset.id,bus:audioEngine.routing.buses.get('stereo')?.effects.preset?.worklet?.preset.id};audioEngine.pause();return result;
        }''')
        self.assertTrue(result['playing']);self.assertEqual(result['track'],'AFX-24');self.assertEqual(result['bus'],'AFX-16')
