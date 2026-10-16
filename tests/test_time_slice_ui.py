"""Time-separated bands, alpha joins and real media under production CSP."""
import base64
import json
from pathlib import Path
import unittest
from browser_helpers import wait_for_browser
import test_temporal_video_ui as temporal_ui


class TimeSliceUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):temporal_ui.TemporalVideoUI.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls):temporal_ui.TemporalVideoUI.tearDownClass.__func__(cls)
    setUp=temporal_ui.TemporalVideoUI.setUp
    tearDown=temporal_ui.TemporalVideoUI.tearDown
    show=temporal_ui.TemporalVideoUI.show
    load_video=temporal_ui.TemporalVideoUI.load_video

    def test_odd_dimensions_all_directions_soft_edges_and_premultiplied_mix(self):
        result=self.page.evaluate('''()=>{
          const width=31,height=23,make=i=>{const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d');ctx.fillStyle=`rgba(${230-i*29},${20+i*31},${70+i*17},${[.5,0,.25,1,.75,.4,1][i]})`;ctx.fillRect(0,0,width,height);return c;},sources=Array.from({length:7},(_,i)=>make(i)),colors=sources.map(c=>Array.from(c.getContext('2d').getImageData(0,0,1,1).data)),r=new CreativeVideoRenderer(),rows=[];
          for(const count of [2,7])for(let direction=0;direction<4;direction++)for(const softness of [0,50,100])for(const amount of [37,100]){
            const s=validateCreativeVideoFx({preset:'VFX-32',amount,parameters:{count,direction,softness}}),frames=Array.from({length:count-1},(_,i)=>({stripe:i+1,source:sources[i+1]}));r.beginFrame();const pixels=r.source(sources[0],s,2,frames).getContext('2d').getImageData(0,0,width,height).data;let max=0;
            for(let y=0;y<height;y++)for(let x=0;x<width;x++){const weights=Array.from({length:count},(_,i)=>temporalSliceWeight(temporalSliceBand(count,i,direction,softness),(direction<2?x+.5:y+.5)/(direction<2?width:height))*amount/100);weights[0]+=1-amount/100;const expected=[0,0,0,0];for(let i=0;i<count;i++){const c=colors[i];for(let k=0;k<3;k++)expected[k]+=c[k]*c[3]/255*weights[i];expected[3]+=c[3]*weights[i];}const at=(y*width+x)*4;for(let k=0;k<4;k++){const actual=k<3?pixels[at+k]*pixels[at+3]/255:pixels[at+3];max=Math.max(max,Math.abs(actual-expected[k]));}}
            rows.push({count,direction,softness,amount,max});
          }
          const s=validateCreativeVideoFx({preset:'VFX-32'}),frames=[{stripe:1,source:sources[1]}];return {rows,bypass:r.source(sources[0],{...s,enabled:false},2,frames)===sources[0],zero:r.source(sources[0],{...s,amount:0},2,frames)===sources[0],noDelay:r.source(sources[0],{...s,parameters:{...s.parameters,delay:0}},2,frames)===sources[0],still:r.source(sources[0],s,2)===sources[0]};
        }''')
        self.assertTrue(result['bypass'] and result['zero'] and result['noDelay'] and result['still'])
        self.assertEqual(len(result['rows']),48)
        for row in result['rows']:
            with self.subTest(**row):self.assertLessEqual(row['max'],3,row)
        (Path(__file__).resolve().parents[1]/'.local/time-slice-compositing.json').write_text(json.dumps(result,indent=2),encoding='utf-8')

    def test_all_controls_change_output_directions_repeat_and_contact_sheet(self):
        result=self.page.evaluate('''()=>{
          const r=new CreativeVideoRenderer(),moving=t=>{const c=document.createElement('canvas');c.width=240;c.height=135;const ctx=c.getContext('2d'),data=ctx.createImageData(240,135);for(let y=0;y<135;y++)for(let x=0;x<240;x++){const at=(y*240+x)*4;data.data[at]=(x*3+y*2+Math.floor(t*120))%256;data.data[at+1]=(x*2+y*4+Math.floor(t*210))%256;data.data[at+2]=((x+Math.floor(t*100))%40)<20?210:40;data.data[at+3]=255;}ctx.putImageData(data,0,0);return c;},s=validateCreativeVideoFx({preset:'VFX-32'}),render=(settings,time)=>{r.beginFrame();return r.source(moving(time),settings,time,temporalVideoSamples(settings,time).map(f=>({...f,source:moving(f.time)})));},base=render(s,1.3).toDataURL(),controls=[];
          for(const [key,value] of [['count',7],['delay',1.2],['direction',3],['softness',100]]){const next=copyProject(s);next.parameters[key]=value;controls.push({key,changed:render(next,1.3).toDataURL()!==base});}
          render(s,2.3);const repeat=render(s,1.3).toDataURL()===base;
          const sheet=document.createElement('canvas');sheet.width=960;sheet.height=350;const ctx=sheet.getContext('2d');ctx.fillStyle='#141e38';ctx.fillRect(0,0,960,350);const images=[];
          for(let direction=0;direction<4;direction++)for(let soft=0;soft<2;soft++){const next=copyProject(s);next.parameters.direction=direction;next.parameters.softness=soft?100:0;const image=render(next,1.3),x=direction*240,y=soft*175;images.push(image.toDataURL());ctx.fillStyle='#ccd5e2';ctx.font='14px Arial';ctx.fillText(['Sağa','Sola','Aşağı','Yukarı'][direction]+' · '+next.parameters.softness+'%',x+8,y+24);ctx.drawImage(image,x,y+36);}
          return {controls,repeat,distinct:new Set(images).size,sheet:sheet.toDataURL().split(',')[1]};
        }''')
        self.assertTrue(result['repeat']);self.assertEqual(result['distinct'],8)
        for control in result['controls']:self.assertTrue(control['changed'],control)
        (Path(__file__).resolve().parents[1]/'.local/time-slice-contact-sheet.png').write_bytes(base64.b64decode(result['sheet']))

    def test_real_preview_seek_repeat_early_clamping_and_zero_delay(self):
        self.load_video()
        self.page.evaluate("projectStore.update(p=>{p.video.creativeFx=validateCreativeVideoFx({preset:'VFX-32',parameters:{count:7,delay:1.5}});});audioEngine.seekProjectTime(.08)")
        wait_for_browser(self.page,'videoPreview.temporalSettled()&&!videoPreview.temporalPending')
        result=self.page.evaluate('''()=>{const frames=videoPreview.temporalReady.result.global;return {length:frames.length,times:frames.map(f=>f.time),sources:new Set(frames.map(f=>f.source)).size};}''')
        self.assertEqual(result['length'],6);self.assertEqual(result['times'],[0]*6);self.assertEqual(result['sources'],1)
        self.page.evaluate('audioEngine.seekProjectTime(1.3)');wait_for_browser(self.page,'videoPreview.temporalSettled()&&!videoPreview.temporalPending')
        first=self.page.evaluate('videoPreview.canvas.toDataURL()')
        self.page.evaluate('audioEngine.seekProjectTime(.3);videoPreview.draw();audioEngine.seekProjectTime(1.3);videoPreview.draw()');wait_for_browser(self.page,'videoPreview.temporalSettled()&&!videoPreview.temporalPending')
        self.assertEqual(self.page.evaluate('videoPreview.canvas.toDataURL()'),first)
        self.page.evaluate('projectStore.update(p=>{p.video.creativeFx.parameters.delay=0;})')
        wait_for_browser(self.page,'!videoPreview.temporalPending&&videoPreview.temporalRenderedTime===null&&videoPreview.temporalFrames.media.decoders.size===0')
        self.assertNotEqual(self.page.evaluate('videoPreview.canvas.toDataURL()'),first)

    def test_authoring_structural_controls_drafts_curves_custom_copy_and_layout(self):
        with self.workspace.open_visual_layers():
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id)');self.show('#creativeVideoPresets');panel=self.page.locator('#creativeVideoPresets');panel.locator('[data-preset="VFX-32"]').click()
            history=self.page.evaluate('projectStore.past.length');slider=panel.locator('input[type=range][data-fx-parameter="delay"]');slider.evaluate("e=>{e.value=.9;e.dispatchEvent(new Event('input',{bubbles:true}));}")
            self.assertEqual(self.page.evaluate('videoPreview.creativeFxDraft.videoClips[0].creativeFx.parameters.delay'),.9);slider.dispatch_event('pointercancel');self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            number=panel.locator('input[type=number][data-fx-parameter="delay"]');number.fill('.9');number.press('Tab');self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            panel.locator('select[data-fx-parameter="direction"]').select_option('3');self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.parameters.direction'),3)
            self.page.evaluate('projectStore.undo()');self.assertEqual(panel.locator('select[data-fx-parameter="direction"]').input_value(),'0');self.page.evaluate('projectStore.redo()')
            panel.locator('.fx-keys').evaluate('(e)=>e.open=true');self.assertFalse(panel.locator('.fx-key-param option[value="count"]').count());self.assertFalse(panel.locator('.fx-key-param option[value="direction"]').count())
            panel.locator('.fx-key-param').select_option('delay');panel.locator('.fx-key-time').fill('.5');panel.locator('.fx-key-value').fill('.2');panel.locator('.fx-key-add').click()
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.automation.delay[0][1]'),.2)
            panel.locator('.fx-save-name').fill('Zaman şeritlerim');panel.locator('.fx-save').click();self.assertEqual(self.page.evaluate('videoPresetBrowser.library.custom[0].settings.automation'),{})
            panel.locator('.fx-target').select_option('scene');panel.locator('[data-preset="VFX-32"]').click();self.assertEqual(self.page.evaluate('projectStore.state.video.creativeFx.preset'),'VFX-32')
            for theme in ('dark','light'):
                self.page.emulate_media(color_scheme=theme)
                for width in (320,375,768,1024,1440):
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
            self.page.evaluate("projectStore.update(p=>{p.video.groupLocked=true;})");panel.locator('.fx-target').select_option('clip');self.assertTrue(panel.locator('[data-preset="VFX-32"]').is_disabled())

    def test_maximum_portrait_color_comparison_history_and_cost(self):
        self.load_video()
        self.page.evaluate("""()=>{projectStore.update(p=>{p.output.aspect='9:16';p.output.resolution='720';p.video.creativeFx=validateCreativeVideoFx({preset:'VFX-32',parameters:{count:7,delay:1.5,softness:100}});});audioEngine.seekProjectTime(.08);videoPreview.colorDraft={clipId:null,color:validateClipColor({enabled:true,brightness:.2})};videoPreview.colorComparison={clipId:null,position:.5};videoPreview.draw();}""")
        wait_for_browser(self.page,'videoPreview.temporalSettled()&&!videoPreview.temporalPending')
        comparison=self.page.evaluate('''()=>{const result=videoPreview.temporalReady.result;return {before:result.globalBefore.length,after:result.global.length,beforeSources:new Set(result.globalBefore.map(f=>f.source)).size,afterSources:new Set(result.global.map(f=>f.source)).size,different:result.globalBefore[0].source.toDataURL()!==result.global[0].source.toDataURL()};}''')
        self.assertEqual(comparison,dict(before=6,after=6,beforeSources=1,afterSources=1,different=True))
        self.page.evaluate('videoPreview.colorComparison=null;videoPreview.colorDraft=null;audioEngine.seekProjectTime(1.3);videoPreview.draw()')
        wait_for_browser(self.page,'videoPreview.temporalSettled()&&!videoPreview.temporalPending')
        result=self.page.evaluate('''()=>({history:videoPreview.temporalReady.result.global.length,bytes:videoPreview.temporalFrames.media.bytes,decoders:videoPreview.temporalFrames.media.decoders.size,temporalMs:videoPreview.stats().temporalMs,width:videoPreview.canvas.width,height:videoPreview.canvas.height,png:videoPreview.canvas.toDataURL().split(',')[1]})''')
        self.assertEqual(result['history'],6);self.assertLessEqual(result['bytes'],64*1024*1024);self.assertLessEqual(result['decoders'],4);self.assertAlmostEqual(result['width']/result['height'],9/16,delta=.01)
        root=Path(__file__).resolve().parents[1]/'.local';(root/'time-slice-max-portrait.png').write_bytes(base64.b64decode(result.pop('png')))
        result['earlyColorComparison']=comparison;(root/'time-slice-profile.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
