"""A real timestamp hold without changing transport, cuts or layer timing."""
import base64
import json
from pathlib import Path
import unittest
from browser_helpers import wait_for_browser
import test_temporal_video_ui as temporal_ui


class ShutterStutterUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):temporal_ui.TemporalVideoUI.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls):temporal_ui.TemporalVideoUI.tearDownClass.__func__(cls)
    setUp=temporal_ui.TemporalVideoUI.setUp
    tearDown=temporal_ui.TemporalVideoUI.tearDown
    show=temporal_ui.TemporalVideoUI.show
    load_video=temporal_ui.TemporalVideoUI.load_video

    def test_full_hold_is_exact_partial_mix_preserves_alpha_and_release_is_neutral(self):
        result=self.page.evaluate('''()=>{
          const make=color=>{const c=document.createElement('canvas');c.width=16;c.height=16;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,16,16);return c;},current=make('rgba(255,0,0,.5)'),held=make('rgba(0,0,255,.25)'),r=new CreativeVideoRenderer(),s=validateCreativeVideoFx({preset:'VFX-33'}),frames=[{time:0,source:held,weight:1}];
          r.beginFrame();const full=r.source(current,s,.1,frames);r.beginFrame();const half=Array.from(r.source(current,{...s,amount:50},.1,frames).getContext('2d').getImageData(0,0,1,1).data);
          return {full:full===held,half,release:r.source(current,s,.3,frames)===current,zero:r.source(current,{...s,amount:0},.1,frames)===current,off:r.source(current,{...s,enabled:false},.1,frames)===current,holdZero:r.source(current,{...s,parameters:{...s.parameters,hold:0}},.1,frames)===current,noFrame:r.source(current,s,.1)===current};
        }''')
        self.assertTrue(all(result[k] for k in ['full','release','zero','off','holdZero','noFrame']))
        for actual,expected in zip(result['half'],[170,0,85,96]):self.assertAlmostEqual(actual,expected,delta=3)

    def test_every_control_changes_output_and_holds_repeat_without_accumulation(self):
        result=self.page.evaluate('''()=>{
          const r=new CreativeVideoRenderer(),moving=t=>{const c=document.createElement('canvas');c.width=240;c.height=135;const ctx=c.getContext('2d'),data=ctx.createImageData(240,135);for(let y=0;y<135;y++)for(let x=0;x<240;x++){const at=(y*240+x)*4;data.data[at]=(x*3+y*2+Math.floor(t*120))%256;data.data[at+1]=(x*2+y*4+Math.floor(t*210))%256;data.data[at+2]=((x+Math.floor(t*100))%40)<20?210:40;data.data[at+3]=255;}ctx.putImageData(data,0,0);return c;},s=validateCreativeVideoFx({preset:'VFX-33'}),render=(settings,t)=>{r.beginFrame();return r.source(moving(t),settings,t,temporalVideoSamples(settings,t).map(f=>({...f,source:moving(f.time)})));},times=[.1,.3,.6,.8,1.1],base=times.map(t=>render(s,t).toDataURL()),controls=[];
          for(const [key,value] of [['hold',0],['interval',.4],['phase',50]]){const next=copyProject(s);next.parameters[key]=value;controls.push({key,changed:times.some((t,i)=>render(next,t).toDataURL()!==base[i])});}
          controls.push({key:'amount',changed:render({...s,amount:50},.1).toDataURL()!==base[0]});
          const heldA=render(s,.15).toDataURL()===base[0],heldB=render(s,.65).toDataURL()===base[2];render(s,2.1);const repeat=render(s,.1).toDataURL()===base[0];
          const sheet=document.createElement('canvas');sheet.width=960;sheet.height=350;const ctx=sheet.getContext('2d');ctx.fillStyle='#141e38';ctx.fillRect(0,0,960,350);const images=[];
          [.05,.15,.25,.35,.55,.65,.75,.85].forEach((t,i)=>{const image=render(s,t),x=i%4*240,y=Math.floor(i/4)*175;images.push(image.toDataURL());ctx.fillStyle='#ccd5e2';ctx.font='14px Arial';ctx.fillText(t.toFixed(2)+' sn · '+(shutterStutterClock(t,...creativeVideoAtTime(s,t).values).active?'Tut':'Akış'),x+8,y+24);ctx.drawImage(image,x,y+36);});return {controls,heldA,heldB,repeat,released:base[1]!==base[0],distinct:new Set(images).size,sheet:sheet.toDataURL().split(',')[1]};
        }''')
        self.assertTrue(result['heldA'] and result['heldB'] and result['repeat'] and result['released']);self.assertEqual(result['distinct'],6)
        for control in result['controls']:self.assertTrue(control['changed'],control)
        (Path(__file__).resolve().parents[1]/'.local/shutter-contact-sheet.png').write_bytes(base64.b64decode(result['sheet']))

    def test_actual_preview_holds_releases_and_seeks_back_to_the_same_frame(self):
        self.load_video()
        self.page.evaluate("projectStore.update(p=>{p.video.creativeFx=validateCreativeVideoFx({preset:'VFX-33'});});audioEngine.seekProjectTime(.1)")
        settled='videoPreview.temporalSettled()&&!videoPreview.temporalPending&&!videoPreview.video.seeking'
        wait_for_browser(self.page,settled);first=self.page.evaluate('videoPreview.canvas.toDataURL()')
        self.page.evaluate('audioEngine.seekProjectTime(.15)');wait_for_browser(self.page,settled)
        self.assertEqual(self.page.evaluate('videoPreview.canvas.toDataURL()'),first)
        self.page.evaluate('audioEngine.seekProjectTime(.3)');wait_for_browser(self.page,settled+'&&videoPreview.temporalRenderedTime===null')
        self.assertNotEqual(self.page.evaluate('videoPreview.canvas.toDataURL()'),first)
        self.page.evaluate('audioEngine.seekProjectTime(.6);videoPreview.draw();audioEngine.seekProjectTime(.1);videoPreview.draw();audioEngine.seekProjectTime(.15);videoPreview.draw()');wait_for_browser(self.page,settled)
        self.assertEqual(self.page.evaluate('videoPreview.canvas.toDataURL()'),first)
        self.page.evaluate('videoPreview.temporalFrames.clear();videoPreview.temporalReady=null;videoPreview.draw()');wait_for_browser(self.page,settled)
        self.assertEqual(self.page.evaluate('videoPreview.canvas.toDataURL()'),first)
        self.assertAlmostEqual(self.page.evaluate('audioEngine.getProjectTime()'),.15,delta=1e-6)

    def test_authoring_drafts_clock_precision_curves_custom_copy_history_and_layout(self):
        with self.workspace.open_visual_layers():
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id)');self.show('#creativeVideoPresets');panel=self.page.locator('#creativeVideoPresets');panel.locator('[data-preset="VFX-33"]').click()
            history=self.page.evaluate('projectStore.past.length');slider=panel.locator('input[type=range][data-fx-parameter="hold"]');slider.evaluate("e=>{e.value=.35;e.dispatchEvent(new Event('input',{bubbles:true}));}")
            self.assertEqual(self.page.evaluate('videoPreview.creativeFxDraft.videoClips[0].creativeFx.parameters.hold'),.35);slider.dispatch_event('pointercancel');self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            number=panel.locator('input[type=number][data-fx-parameter="hold"]');number.fill('.35');number.press('Tab');self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            interval=panel.locator('input[type=number][data-fx-parameter="interval"]');interval.fill('.75');interval.press('Tab');self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.parameters.interval'),.75)
            phase=panel.locator('input[type=number][data-fx-parameter="phase"]');phase.fill('25.5');phase.press('Tab');self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.parameters.phase'),25.5)
            self.page.evaluate('projectStore.undo()');self.assertEqual(phase.input_value(),'0');self.page.evaluate('projectStore.redo()')
            panel.locator('.fx-keys').evaluate('(e)=>e.open=true');self.assertFalse(panel.locator('.fx-key-param option[value="interval"]').count());self.assertFalse(panel.locator('.fx-key-param option[value="phase"]').count())
            panel.locator('.fx-key-param').select_option('hold');panel.locator('.fx-key-time').fill('.5');panel.locator('.fx-key-value').fill('.1');panel.locator('.fx-key-add').click()
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.automation.hold[0][1]'),.1)
            panel.locator('.fx-save-name').fill('Kesik karelerim');panel.locator('.fx-save').click();self.assertEqual(self.page.evaluate('videoPresetBrowser.library.custom[0].settings.automation'),{})
            panel.locator('.fx-target').select_option('scene');panel.locator('[data-preset="VFX-33"]').click();self.assertEqual(self.page.evaluate('projectStore.state.video.creativeFx.preset'),'VFX-33')
            for theme in ('dark','light'):
                self.page.emulate_media(color_scheme=theme)
                for width in (320,375,768,1024,1440):
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
            self.page.evaluate('projectStore.update(p=>{p.video.groupLocked=true;})');self.assertTrue(panel.locator('[data-preset="VFX-33"]').is_disabled())

    def test_reverse_cut_and_phased_layer_clamp_hold_to_their_exposure_start(self):
        self.load_video()
        self.page.evaluate('''asset=>{projectStore.update(p=>{p.videoClips=[{id:'cut',asset,start:.3,end:1.3,offset:.25,transitionDuration:0,timeRemap:{reverse:true,smoothing:'blend'},creativeFx:{preset:'VFX-33',parameters:{hold:.4,interval:1}}}];});audioEngine.seekProjectTime(.3);}''',self.media['asset'])
        settled='videoPreview.ready&&videoPreview.temporalSettled()&&!videoPreview.temporalPending&&videoPreview.clips.entries.every(e=>!e.video.seeking&&e.sampler.settled())'
        wait_for_browser(self.page,settled);first=self.page.evaluate('videoPreview.canvas.toDataURL()')
        self.assertAlmostEqual(self.page.evaluate('videoPreview.temporalReady.result.clips.get(0)[0].time'),.25,delta=1e-8)
        self.page.evaluate('audioEngine.seekProjectTime(.35)');wait_for_browser(self.page,settled);self.assertEqual(self.page.evaluate('videoPreview.canvas.toDataURL()'),first)
        self.page.evaluate('''asset=>{projectStore.update(p=>{p.videoClips=[];p.visualLayers=[{id:'held-layer',type:'video',asset,offset:.15,until:1.5,start:.25,end:1.5,phase:.2,speed:1.3,loop:true,timeRemap:{reverse:true,smoothing:'blend'},creativeFx:{preset:'VFX-33',parameters:{hold:.4,interval:1}},width:75,opacity:65}];});audioEngine.seekProjectTime(.2);}''',self.media['asset'])
        settled='videoPreview.ready&&videoPreview.visuals.isReady()&&videoPreview.temporalSettled()&&!videoPreview.temporalPending'
        wait_for_browser(self.page,settled)
        first=self.page.evaluate('videoPreview.temporalReady.result.layers.get("held-layer")[0].source.toDataURL()');self.assertAlmostEqual(self.page.evaluate('videoPreview.temporalReady.result.layers.get("held-layer")[0].time'),.15,delta=1e-8)
        self.page.evaluate('audioEngine.seekProjectTime(.25)');wait_for_browser(self.page,settled)
        self.assertEqual(self.page.evaluate('videoPreview.temporalReady.result.layers.get("held-layer")[0].source.toDataURL()'),first)

    def test_maximum_hold_portrait_color_comparison_and_preparation_cost(self):
        self.load_video()
        self.page.evaluate("""()=>{projectStore.update(p=>{p.output.aspect='9:16';p.output.resolution='720';p.video.creativeFx=validateCreativeVideoFx({preset:'VFX-33',parameters:{hold:3,interval:3,phase:25}});});audioEngine.seekProjectTime(1.3);videoPreview.colorDraft={clipId:null,color:validateClipColor({enabled:true,brightness:.2})};videoPreview.colorComparison={clipId:null,position:.5};videoPreview.draw();}""")
        wait_for_browser(self.page,'videoPreview.temporalSettled()&&!videoPreview.temporalPending')
        comparison=self.page.evaluate('''()=>{const result=videoPreview.temporalReady.result;return {before:result.globalBefore.length,after:result.global.length,different:result.globalBefore[0].source.toDataURL()!==result.global[0].source.toDataURL()};}''')
        self.assertEqual(comparison,dict(before=1,after=1,different=True))
        self.page.evaluate('videoPreview.colorComparison=null;videoPreview.colorDraft=null;videoPreview.draw()');wait_for_browser(self.page,'videoPreview.temporalSettled()&&!videoPreview.temporalPending')
        times=[]
        for time in (40/30,41/30,42/30):
            self.page.evaluate('time=>{audioEngine.seekProjectTime(time);videoPreview.draw();}',time);wait_for_browser(self.page,'videoPreview.temporalSettled()&&!videoPreview.temporalPending')
            times.append(self.page.evaluate('videoPreview.stats().temporalMs'))
        result=self.page.evaluate('''()=>({history:videoPreview.temporalReady.result.global.length,anchor:videoPreview.temporalReady.result.global[0].time,bytes:videoPreview.temporalFrames.media.bytes,decoders:videoPreview.temporalFrames.media.decoders.size,width:videoPreview.canvas.width,height:videoPreview.canvas.height,png:videoPreview.canvas.toDataURL().split(',')[1]})''')
        self.assertEqual(result['history'],1);self.assertAlmostEqual(result['anchor'],.75,delta=1e-8);self.assertLessEqual(result['bytes'],64*1024*1024);self.assertLessEqual(result['decoders'],4);self.assertAlmostEqual(result['width']/result['height'],9/16,delta=.01)
        result.update(nearbyFrameMs=times,nearbyMedianMs=sorted(times)[1],colorComparison=comparison)
        root=Path(__file__).resolve().parents[1]/'.local';(root/'shutter-max-portrait.png').write_bytes(base64.b64decode(result.pop('png')));(root/'shutter-profile.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
