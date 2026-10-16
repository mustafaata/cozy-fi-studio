"""Real decoded histories and authoring in the production-CSP studio."""
import json
import base64
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
import test_controller_ui as controller_ui
from browser_helpers import wait_for_browser
import engine
import media_assets


class TemporalVideoUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        controller_ui.ControllerUI.setUpClass.__func__(cls)
        import test_workspace_ui as workspace_ui
        root=Path(workspace_ui.WorkspaceUI.temporary.name)
        cls.assets=patch.object(media_assets,'ASSET_DIR',root/'temporal-assets');cls.assets.start()
        video=root/'temporal-testsrc.mp4'
        subprocess.run([engine._ffmpeg_bin(),'-v','error','-f','lavfi','-i','testsrc2=s=128x72:r=24:d=2','-c:v','libx264','-crf','12',str(video)],check=True)
        cls.media=media_assets.prepare_asset(video,video.name,engine._ffmpeg_bin())
    @classmethod
    def tearDownClass(cls):
        cls.assets.stop();controller_ui.ControllerUI.tearDownClass.__func__(cls)
    setUp=controller_ui.ControllerUI.setUp
    tearDown=controller_ui.ControllerUI.tearDown
    show=controller_ui.ControllerUI.show

    def load_video(self):
        self.workspace.load_audio()
        self.page.evaluate('asset=>projectStore.update(p=>{p.effects.speed=1;p.video.linkSpeed=false;p.video.speed=1;p.background.asset=asset;p.video.loop=false;})',self.media['asset'])
        wait_for_browser(self.page,'videoPreview.ready&&!videoPreview.busy')

    def test_premultiplied_blending_and_bypass(self):
        result=self.page.evaluate('''()=>{
          const make=(color)=>{const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;const c=canvas.getContext('2d');c.fillStyle=color;c.fillRect(0,0,16,16);return canvas;},a=make('rgba(255,0,0,.5)'),b=make('rgba(0,0,255,.25)'),settings=validateCreativeVideoFx({preset:'VFX-31'}),r=new CreativeVideoRenderer();
          const read=(amount)=>{r.beginFrame();return Array.from(r.source(a,{...settings,amount},1,[{source:b,weight:1}]).getContext('2d').getImageData(0,0,1,1).data);};
          const full=read(100),half=read(50);return {full,half,none:r.source(a,settings,1)===a,off:r.source(a,{...settings,enabled:false},1,[{source:b,weight:1}])===a,zero:r.source(a,{...settings,amount:0},1,[{source:b,weight:1}])===a};
        }''')
        self.assertTrue(result['none'] and result['off'] and result['zero'])
        for actual,expected in zip(result['full'],[170,0,85,96]):self.assertAlmostEqual(actual,expected,delta=3)
        for actual,expected in zip(result['half'],[219,0,36,112]):self.assertAlmostEqual(actual,expected,delta=3)

    def test_real_decoder_order_independence_bounded_cache_and_disposal(self):
        self.load_video()
        result=self.page.evaluate('''async()=>{
          const media=new TemporalMediaFrames(),source=videoPreview.video,info=videoPreview.info,clip=projectStore.state.video;
          const first=await media.sample(source,.25,clip,info),original=first.toDataURL();
          const later=await media.sample(source,1.25,clip,info);const different=original!==later.toDataURL();
          for(let i=0;i<36;i++)await media.sample(source,i/24,clip,info);
          const repeat=(await media.sample(source,.25,clip,info)).toDataURL()===original;
          const rows={different,repeat,immutable:first.toDataURL()===original,cache:media.cache.size,bytes:media.bytes,decoders:media.decoders.size,playerTime:source.currentTime};
          const firstDecoder=media.decoders.values().next().value;
          for(let i=0;i<5;i++)await media.sample({src:source.currentSrc+'?temporal-decoder='+i},.25,clip,info);
          rows.evicted=!firstDecoder.video.getAttribute('src')&&!firstDecoder.video.cozyTimeSampler;rows.pool=media.decoders.size;
          media.clear();return {...rows,cleared:media.cache.size===0&&media.decoders.size===0&&media.bytes===0};
        }''')
        self.assertTrue(result['different'] and result['repeat'] and result['immutable'] and result['cleared'],result)
        self.assertLessEqual(result['cache'],24);self.assertLessEqual(result['bytes'],64*1024*1024);self.assertLessEqual(result['decoders'],4)
        self.assertTrue(result['evicted']);self.assertLessEqual(result['pool'],4)
        self.assertAlmostEqual(result['playerTime'],0,delta=.01)

    def test_actual_preview_fast_seeks_replay_neutral_and_no_stale_paint(self):
        self.load_video()
        self.page.evaluate("projectStore.update(p=>{p.video.creativeFx=validateCreativeVideoFx({preset:'VFX-31',parameters:{count:4,interval:.15}});});audioEngine.seekProjectTime(.8)")
        settled='!videoPreview.temporalPending&&Math.abs(videoPreview.temporalRenderedTime-audioEngine.getProjectTime())<1e-6'
        wait_for_browser(self.page,settled)
        first=self.page.evaluate('videoPreview.canvas.toDataURL()')
        self.page.evaluate('audioEngine.seekProjectTime(1.3);videoPreview.draw();audioEngine.seekProjectTime(.4);videoPreview.draw();audioEngine.seekProjectTime(.8);videoPreview.draw()')
        wait_for_browser(self.page,settled)
        self.assertEqual(self.page.evaluate('videoPreview.canvas.toDataURL()'),first)
        self.page.evaluate('videoPreview.temporalFrames.media.clear();videoPreview.temporalReady=null;videoPreview.draw()');wait_for_browser(self.page,settled)
        self.assertEqual(self.page.evaluate('videoPreview.canvas.toDataURL()'),first)
        self.page.evaluate('projectStore.update(p=>{p.video.creativeFx.enabled=false;})')
        wait_for_browser(self.page,'!videoPreview.temporalPending&&videoPreview.temporalRenderedTime===null&&videoPreview.temporalFrames.media.decoders.size===0')
        self.assertNotEqual(self.page.evaluate('videoPreview.canvas.toDataURL()'),first)
        self.page.evaluate('''()=>{window.originalTemporalPrepare=videoPreview.temporalFrames.prepare;videoPreview.temporalFrames.prepare=async function(...args){const result=await originalTemporalPrepare.apply(this,args);await new Promise(resolve=>window.releaseTemporal=resolve);return result;};projectStore.update(p=>{p.video.creativeFx.enabled=true;});audioEngine.seekProjectTime(1);videoPreview.draw();}''')
        wait_for_browser(self.page,'!!window.releaseTemporal&&videoPreview.temporalPending')
        self.page.evaluate('projectStore.update(p=>{p.video.creativeFx.enabled=false;});videoPreview.draw()')
        plain=self.page.evaluate('videoPreview.canvas.toDataURL()')
        self.page.evaluate('videoPreview.temporalFrames.prepare=originalTemporalPrepare;releaseTemporal()')
        wait_for_browser(self.page,'!videoPreview.temporalPending&&videoPreview.temporalFrames.media.decoders.size===0')
        self.assertEqual(self.page.evaluate('videoPreview.canvas.toDataURL()'),plain)

    def test_maximum_history_portrait_preview_and_preparation_cost(self):
        self.load_video()
        self.page.evaluate("projectStore.update(p=>{p.output.aspect='9:16';p.output.resolution='720';p.video.creativeFx=validateCreativeVideoFx({preset:'VFX-31',parameters:{count:6,interval:.1,falloff:10}});});audioEngine.seekProjectTime(1.3)")
        wait_for_browser(self.page,'videoPreview.temporalSettled()&&!videoPreview.temporalPending')
        cold=self.page.evaluate('videoPreview.stats().temporalMs');nearby=[]
        for time in (40/30,41/30,42/30):
            self.page.evaluate('time=>{audioEngine.seekProjectTime(time);videoPreview.draw();}',time)
            wait_for_browser(self.page,'videoPreview.temporalSettled()&&!videoPreview.temporalPending')
            nearby.append(self.page.evaluate('videoPreview.stats().temporalMs'))
        result=self.page.evaluate('''()=>({history:videoPreview.temporalReady.result.global.length,bytes:videoPreview.temporalFrames.media.bytes,decoders:videoPreview.temporalFrames.media.decoders.size,temporalMs:videoPreview.stats().temporalMs,width:videoPreview.canvas.width,height:videoPreview.canvas.height,png:videoPreview.canvas.toDataURL().split(',')[1]})''')
        result.update(coldMs=cold,nearbyFrameMs=nearby,nearbyMedianMs=sorted(nearby)[1])
        self.assertEqual(result['history'],6);self.assertLessEqual(result['bytes'],64*1024*1024);self.assertLessEqual(result['decoders'],4)
        self.assertAlmostEqual(result['width']/result['height'],9/16,delta=.01);self.assertGreaterEqual(result['temporalMs'],0)
        diagnostic=Path(__file__).resolve().parents[1]/'.local'
        (diagnostic/'temporal-max-portrait.png').write_bytes(base64.b64decode(result.pop('png')))
        (diagnostic/'temporal-profile.json').write_text(json.dumps(result,indent=2),encoding='utf-8')

    def test_authoring_controls_draft_cancel_curves_copy_undo_and_mobile(self):
        with self.workspace.open_visual_layers():
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id)');self.show('#creativeVideoPresets');panel=self.page.locator('#creativeVideoPresets')
            panel.locator('[data-preset="VFX-31"]').click();history=self.page.evaluate('projectStore.past.length')
            slider=panel.locator('input[type=range][data-fx-parameter="interval"]');slider.evaluate("e=>{e.value=.2;e.dispatchEvent(new Event('input',{bubbles:true}));}")
            self.assertEqual(self.page.evaluate('videoPreview.creativeFxDraft.videoClips[0].creativeFx.parameters.interval'),.2)
            slider.dispatch_event('pointercancel');self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            number=panel.locator('input[type=number][data-fx-parameter="interval"]');number.fill('.2');number.press('Tab');self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            panel.locator('.fx-keys').evaluate('(e)=>e.open=true');self.assertFalse(panel.locator('.fx-key-param option[value="count"]').count())
            panel.locator('.fx-key-param').select_option('interval');panel.locator('.fx-key-time').fill('.5');panel.locator('.fx-key-value').fill('.1');panel.locator('.fx-key-add').click()
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.automation.interval[0][1]'),.1)
            panel.locator('.fx-save-name').fill('Hayaletim');panel.locator('.fx-save').click();self.assertEqual(self.page.evaluate('videoPresetBrowser.library.custom[0].settings.automation'),{})
            panel.locator('.fx-target').select_option('scene');panel.locator('[data-preset="VFX-31"]').click()
            self.page.evaluate('projectStore.undo()');self.assertEqual(self.page.evaluate('projectStore.state.video.creativeFx.preset'),'');self.page.evaluate('projectStore.redo()')
            for theme in ('dark','light'):
                self.page.emulate_media(color_scheme=theme)
                for width in (320,375,768,1024,1440):
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)

    def test_failure_visible_once_and_recoverable_after_edit(self):
        self.load_video()
        self.page.evaluate("""()=>{window.temporalErrors=[];document.addEventListener('studio-error',e=>temporalErrors.push(e.detail));window.savedTemporalSample=videoPreview.temporalFrames.media.sample;videoPreview.temporalFrames.media.sample=async()=>{throw new Error('forced temporal failure');};projectStore.update(p=>p.video.creativeFx=validateCreativeVideoFx({preset:'VFX-31'}));audioEngine.seekProjectTime(.8);}""")
        wait_for_browser(self.page,'!!videoPreview.temporalFailed&&!videoPreview.temporalPending')
        self.page.evaluate('videoPreview.draw();audioEngine.seekProjectTime(1);videoPreview.draw()')
        self.assertEqual(self.page.evaluate("temporalErrors.filter(e=>e==='forced temporal failure').length"),1)
        self.page.evaluate('videoPreview.temporalFrames.media.sample=savedTemporalSample;projectStore.update(p=>{p.video.creativeFx.parameters.interval=.2;})')
        wait_for_browser(self.page,'!videoPreview.temporalPending&&videoPreview.temporalRenderedTime===1')

    def test_color_comparison_uses_separate_before_and_after_histories(self):
        self.load_video()
        self.page.evaluate("projectStore.update(p=>{p.video.creativeFx=validateCreativeVideoFx({preset:'VFX-31'});});audioEngine.seekProjectTime(.8)")
        wait_for_browser(self.page,'videoPreview.temporalSettled()&&!videoPreview.temporalPending')
        self.page.evaluate("videoPreview.colorDraft={clipId:null,color:validateClipColor({enabled:true,brightness:.2})};videoPreview.colorComparison={clipId:null,position:.5};videoPreview.draw()")
        wait_for_browser(self.page,'videoPreview.temporalSettled()&&!videoPreview.temporalPending')
        result=self.page.evaluate('''()=>{const result=videoPreview.temporalReady.result;return {before:result.globalBefore.length,after:result.global.length,different:result.globalBefore.every((f,i)=>f.source.toDataURL()!==result.global[i].source.toDataURL())};}''')
        self.assertEqual(result['before'],3);self.assertEqual(result['after'],3);self.assertTrue(result['different'])
        self.page.evaluate('videoPreview.colorComparison=null;videoPreview.colorDraft=null;videoPreview.draw()')
        wait_for_browser(self.page,'videoPreview.temporalSettled()&&!videoPreview.temporalPending')
        self.assertEqual(self.page.evaluate('videoPreview.temporalReady.result.globalBefore.length'),0)
