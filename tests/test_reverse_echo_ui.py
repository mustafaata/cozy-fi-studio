"""Future decoded frames, premultiplied echoes and production-CSP authoring."""
import base64
import json
from pathlib import Path
import unittest
from browser_helpers import wait_for_browser
import test_temporal_video_ui as temporal_ui


class ReverseEchoUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):temporal_ui.TemporalVideoUI.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls):temporal_ui.TemporalVideoUI.tearDownClass.__func__(cls)
    setUp=temporal_ui.TemporalVideoUI.setUp
    tearDown=temporal_ui.TemporalVideoUI.tearDown
    show=temporal_ui.TemporalVideoUI.show
    load_video=temporal_ui.TemporalVideoUI.load_video

    def test_transparent_echoes_preserve_alpha_and_neutral_paths_return_original(self):
        result=self.page.evaluate('''()=>{
          const make=color=>{const c=document.createElement('canvas');c.width=16;c.height=16;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,16,16);return c;},source=make('rgba(255,0,0,.5)'),future=make('rgba(0,0,255,.25)'),r=new CreativeVideoRenderer(),s=validateCreativeVideoFx({preset:'VFX-35'}),frames=[{source:future,weight:1}];
          const read=amount=>{r.beginFrame();return Array.from(r.source(source,{...s,amount},.2,frames).getContext('2d').getImageData(0,0,1,1).data);};
          return {full:read(100),half:read(50),off:r.source(source,{...s,enabled:false},.2,frames)===source,zero:r.source(source,{...s,amount:0},.2,frames)===source,empty:r.source(source,s,.2)===source,falloff:r.source(source,{...s,parameters:{...s.parameters,falloff:100}},.2,frames)===source};
        }''')
        self.assertTrue(all(result[k] for k in ['off','zero','empty','falloff']))
        for key,expected in [('full',[170,0,85,96]),('half',[219,0,36,112])]:
            for actual,value in zip(result[key],expected):self.assertAlmostEqual(actual,value,delta=3)

    def test_controls_change_pixels_future_is_distinct_and_thumbnails_use_custom_settings(self):
        result=self.page.evaluate('''()=>{
          const r=new CreativeVideoRenderer(),moving=t=>{const c=document.createElement('canvas');c.width=240;c.height=135;const ctx=c.getContext('2d');ctx.fillStyle='#16395a';ctx.fillRect(0,0,240,135);ctx.fillStyle='#e8b23d';ctx.fillRect(15+t*115,20,20,95);return c;},s=validateCreativeVideoFx({preset:'VFX-35'}),render=(settings,t)=>{r.beginFrame();return r.source(moving(t),settings,t,temporalVideoSamples(settings,t,0,2).map(f=>({...f,source:moving(f.time)})));},base=render(s,.3).toDataURL(),controls=[];
          for(const [key,value] of [['count',1],['interval',.25],['falloff',80]]){const next=copyProject(s);next.parameters[key]=value;controls.push({key,changed:render(next,.3).toDataURL()!==base});}
          controls.push({key:'amount',changed:render({...s,amount:40},.3).toDataURL()!==base});
          const ghost=validateCreativeVideoFx({preset:'VFX-31',parameters:s.parameters}),past=render(ghost,.3).toDataURL(),futureVsPast=base!==past;render(s,1.4);const repeat=render(s,.3).toDataURL()===base;
          const sheet=document.createElement('canvas');sheet.width=960;sheet.height=350;const ctx=sheet.getContext('2d');ctx.fillStyle='#141e38';ctx.fillRect(0,0,960,350);const images=[];
          [.05,.15,.25,.35,.55,.65,.75,.85].forEach((t,i)=>{const image=render(s,t),x=i%4*240,y=Math.floor(i/4)*175;images.push(image.toDataURL());ctx.fillStyle='#ccd5e2';ctx.font='14px Arial';ctx.fillText(t.toFixed(2)+' sn · ileri yankı',x+8,y+24);ctx.drawImage(image,x,y+36);});
          const thumbnail=videoPresetBrowser.thumbnails.get('VFX-35'),copy=videoPresetBrowser.videoThumbnail({settings:{...s,parameters:{...s.parameters,interval:.4}}});
          return {controls,futureVsPast,repeat,distinct:new Set(images).size,thumbnail:!!thumbnail&&thumbnail.toDataURL()!==copy.toDataURL(),sheet:sheet.toDataURL().split(',')[1]};
        }''')
        self.assertTrue(result['futureVsPast'] and result['repeat'] and result['thumbnail']);self.assertEqual(result['distinct'],8)
        for control in result['controls']:self.assertTrue(control['changed'],control)
        (Path(__file__).resolve().parents[1]/'.local/reverse-echo-contact-sheet.png').write_bytes(base64.b64decode(result['sheet']))

    def test_actual_future_preview_first_frame_seek_repeat_and_end_release(self):
        self.load_video()
        self.page.evaluate("projectStore.update(p=>{p.video.creativeFx=validateCreativeVideoFx({preset:'VFX-35',parameters:{count:4,interval:.15}});});audioEngine.seekProjectTime(0)")
        settled='videoPreview.temporalSettled()&&!videoPreview.temporalPending&&!videoPreview.video.seeking'
        wait_for_browser(self.page,settled)
        self.assertTrue(self.page.evaluate('videoPreview.temporalReady.result.global.every(f=>f.time>0)'))
        first=self.page.evaluate('videoPreview.canvas.toDataURL()')
        self.page.evaluate('audioEngine.seekProjectTime(1.3);videoPreview.draw();audioEngine.seekProjectTime(.4);videoPreview.draw();audioEngine.seekProjectTime(0);videoPreview.draw()');wait_for_browser(self.page,settled)
        self.assertEqual(self.page.evaluate('videoPreview.canvas.toDataURL()'),first)
        self.page.evaluate('videoPreview.temporalFrames.clear();videoPreview.temporalReady=null;videoPreview.draw()');wait_for_browser(self.page,settled)
        self.assertEqual(self.page.evaluate('videoPreview.canvas.toDataURL()'),first)
        self.page.evaluate('projectStore.update(p=>{p.video.creativeFx.enabled=false;})');wait_for_browser(self.page,'!videoPreview.temporalPending&&videoPreview.temporalRenderedTime===null&&videoPreview.temporalFrames.media.decoders.size===0')
        self.assertNotEqual(self.page.evaluate('videoPreview.canvas.toDataURL()'),first)
        self.page.evaluate('projectStore.update(p=>{p.video.creativeFx.enabled=true;});audioEngine.seekProjectTime(projectDuration(projectStore.state)-1/30);videoPreview.draw()')
        wait_for_browser(self.page,settled+'&&videoPreview.temporalRenderedTime===null&&videoPreview.temporalFrames.media.decoders.size===0')

    def test_authoring_drafts_curves_count_history_copy_locks_and_layout(self):
        with self.workspace.open_visual_layers():
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id)');self.show('#creativeVideoPresets');panel=self.page.locator('#creativeVideoPresets');panel.locator('[data-preset="VFX-35"]').click()
            history=self.page.evaluate('projectStore.past.length');slider=panel.locator('input[type=range][data-fx-parameter="interval"]');slider.evaluate("e=>{e.value=.25;e.dispatchEvent(new Event('input',{bubbles:true}));}")
            self.assertEqual(self.page.evaluate('videoPreview.creativeFxDraft.videoClips[0].creativeFx.parameters.interval'),.25);slider.dispatch_event('pointercancel');self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            number=panel.locator('input[type=number][data-fx-parameter="interval"]');number.fill('.25');number.press('Tab');self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            falloff=panel.locator('input[type=number][data-fx-parameter="falloff"]');falloff.fill('25.5');falloff.press('Tab');self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.parameters.falloff'),25.5)
            self.page.evaluate('projectStore.undo()');self.assertEqual(falloff.input_value(),'35');self.page.evaluate('projectStore.redo()')
            panel.locator('.fx-keys').evaluate('(e)=>e.open=true');self.assertFalse(panel.locator('.fx-key-param option[value="count"]').count());self.assertTrue(panel.locator('.fx-key-param option[value="falloff"]').count())
            panel.locator('.fx-key-param').select_option('interval');panel.locator('.fx-key-time').fill('.5');panel.locator('.fx-key-value').fill('.1');panel.locator('.fx-key-add').click();self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.automation.interval[0][1]'),.1)
            panel.locator('.fx-save-name').fill('İleri yankılarım');panel.locator('.fx-save').click();self.assertEqual(self.page.evaluate('videoPresetBrowser.library.custom[0].settings.automation'),{})
            panel.locator('.fx-target').select_option('scene');panel.locator('[data-preset="VFX-35"]').click();self.assertEqual(self.page.evaluate('projectStore.state.video.creativeFx.preset'),'VFX-35')
            for theme in ('dark','light'):
                self.page.emulate_media(color_scheme=theme)
                for width in (320,375,768,1024,1440):
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
            self.page.evaluate('projectStore.update(p=>{p.video.groupLocked=true;})');self.assertTrue(panel.locator('[data-preset="VFX-35"]').is_disabled())

    def test_reverse_clip_and_phased_layer_never_sample_beyond_their_exposure_end(self):
        self.load_video()
        self.page.evaluate('''asset=>{projectStore.update(p=>{p.videoClips=[{id:'echo-cut',asset,start:.3,end:1.3,offset:.25,transitionDuration:0,timeRemap:{reverse:true,smoothing:'blend'},creativeFx:{preset:'VFX-35',parameters:{count:6,interval:.1}}}];});audioEngine.seekProjectTime(.95);}''',self.media['asset'])
        settled='videoPreview.ready&&videoPreview.temporalSettled()&&!videoPreview.temporalPending&&videoPreview.clips.entries.every(e=>!e.video.seeking&&e.sampler.settled())'
        wait_for_browser(self.page,settled)
        result=self.page.evaluate('''()=>{const r=videoPreview.temporalReady.result,echo=r.clips.get(0);return {times:echo.map(e=>e.time),futureLower:echo[0].source.toDataURL()!==r.videos[0].toDataURL()};}''')
        self.assertEqual(len(result['times']),2);self.assertTrue(all(.95<t<1.25 for t in result['times']));self.assertTrue(result['futureLower'])
        self.page.evaluate('audioEngine.seekProjectTime(1.2)');wait_for_browser(self.page,settled+'&&videoPreview.temporalRenderedTime===null')
        self.page.evaluate('''asset=>{projectStore.update(p=>{p.videoClips=[];p.visualLayers=[{id:'echo-layer',type:'video',asset,offset:.15,until:1.5,start:.25,end:1.5,phase:.2,speed:1.3,loop:true,timeRemap:{reverse:true,smoothing:'blend'},creativeFx:{preset:'VFX-35',parameters:{count:6,interval:.1}},width:75,opacity:65}];});audioEngine.seekProjectTime(.15);}''',self.media['asset'])
        settled='videoPreview.ready&&videoPreview.visuals.isReady()&&videoPreview.temporalSettled()&&!videoPreview.temporalPending'
        wait_for_browser(self.page,settled);self.assertEqual(self.page.evaluate('videoPreview.temporalReady.result.layers.get("echo-layer").length'),6)
        self.page.evaluate('audioEngine.seekProjectTime(1.25)');wait_for_browser(self.page,settled)
        self.assertEqual(self.page.evaluate('videoPreview.temporalReady.result.layers.get("echo-layer").length'),2)
        self.page.evaluate('audioEngine.seekProjectTime(1.45)');wait_for_browser(self.page,settled+'&&videoPreview.temporalRenderedTime===null')

    def test_maximum_future_portrait_color_comparison_cache_and_preparation_cost(self):
        self.load_video()
        self.page.evaluate("projectStore.update(p=>{p.output.aspect='9:16';p.output.resolution='720';p.video.creativeFx=validateCreativeVideoFx({preset:'VFX-35',parameters:{count:6,interval:.1,falloff:0}});});audioEngine.seekProjectTime(.3)")
        settled='videoPreview.temporalSettled()&&!videoPreview.temporalPending'
        wait_for_browser(self.page,settled)
        self.page.evaluate("videoPreview.colorDraft={clipId:null,color:validateClipColor({enabled:true,brightness:.2})};videoPreview.colorComparison={clipId:null,position:.5};videoPreview.draw()")
        wait_for_browser(self.page,settled)
        comparison=self.page.evaluate('''()=>{const r=videoPreview.temporalReady.result;return {before:r.globalBefore.length,after:r.global.length,different:r.globalBefore[0].source.toDataURL()!==r.global[0].source.toDataURL()};}''')
        self.assertEqual(comparison,dict(before=6,after=6,different=True))
        self.page.evaluate('videoPreview.colorComparison=null;videoPreview.colorDraft=null;videoPreview.draw()');wait_for_browser(self.page,settled)
        times=[]
        for time in (10/30,11/30,12/30):
            self.page.evaluate('time=>{audioEngine.seekProjectTime(time);videoPreview.draw();}',time);wait_for_browser(self.page,settled);times.append(self.page.evaluate('videoPreview.stats().temporalMs'))
        result=self.page.evaluate('''()=>({future:videoPreview.temporalReady.result.global.map(f=>f.time),history:videoPreview.temporalReady.result.global.length,bytes:videoPreview.temporalFrames.media.bytes,decoders:videoPreview.temporalFrames.media.decoders.size,width:videoPreview.canvas.width,height:videoPreview.canvas.height,png:videoPreview.canvas.toDataURL().split(',')[1]})''')
        self.assertEqual(result['history'],6);self.assertTrue(all(t>.4 for t in result['future']));self.assertLessEqual(result['bytes'],64*1024*1024);self.assertLessEqual(result['decoders'],4);self.assertAlmostEqual(result['width']/result['height'],9/16,delta=.01)
        result.update(nearbyFrameMs=times,nearbyMedianMs=sorted(times)[1],colorComparison=comparison)
        root=Path(__file__).resolve().parents[1]/'.local';(root/'reverse-echo-max-portrait.png').write_bytes(base64.b64decode(result.pop('png')));(root/'reverse-echo-profile.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
