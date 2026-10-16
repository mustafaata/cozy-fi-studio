import base64
import json
from pathlib import Path
import unittest
import numpy as np
from pedalboard.io import AudioFile
import test_controller_ui as controller_ui
from browser_helpers import wait_for_browser


class ReactiveFieldsUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):controller_ui.ControllerUI.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls):controller_ui.ControllerUI.tearDownClass.__func__(cls)
    setUp=controller_ui.ControllerUI.setUp
    tearDown=controller_ui.ControllerUI.tearDown
    show=controller_ui.ControllerUI.show

    def test_all_ten_distinct_all_primary_controls_replay_and_contact_sheet(self):
        result=self.page.evaluate('''()=>{
          const source=document.createElement('canvas');source.width=480;source.height=270;source.getContext('2d').fillStyle='#121a24';source.getContext('2d').fillRect(0,0,480,270);
          const analysis=reactiveExampleAnalysis(),renderer=new ReactiveRenderer(),times=[.25,.37,.6,1.45,2.35],rows=[],images=[],repeat=[],render=(s,t)=>renderer.source(source,s,t,analysis).toDataURL();
          for(const preset of PROJECT_SCHEMA.creativeReactivePresets.slice(20,30)){const s=validateCreativeReactiveFx({preset:preset.id}),base=times.map(t=>render(s,t));images.push(base[1]);render(s,2.9);repeat.push(render(s,.37)===base[1]);const controls=[];
            for(const key of preset.parameterOrder.filter(k=>!preset.parameters[k].advanced)){const spec=preset.parameters[key];controls.push({key,changed:[spec.min,spec.max].some(v=>{const next=copyProject(s);next.parameters[key]=v;return times.some((t,i)=>render(next,t)!==base[i]);})});}rows.push({id:preset.id,controls});}
          const sheet=document.createElement('canvas');sheet.width=1600;sheet.height=460;const ctx=sheet.getContext('2d');ctx.fillStyle='#0e141c';ctx.fillRect(0,0,1600,460);
          PROJECT_SCHEMA.creativeReactivePresets.slice(20,30).forEach((preset,i)=>{const x=i%5*320,y=Math.floor(i/5)*230,s=validateCreativeReactiveFx({preset:preset.id});ctx.font='13px Arial';ctx.fillStyle='#b9c0cd';ctx.fillText(preset.id+' · '+preset.name,x+12,y+22);ctx.drawImage(renderer.source(source,s,reactiveFieldPreviewTime(s),analysis),x+8,y+38,304,171);});return {distinct:new Set(images).size,repeat,rows,sheet:sheet.toDataURL().split(',')[1]};
        }''')
        (Path(__file__).resolve().parents[1]/'.local/reactive-fields-contact-sheet.png').write_bytes(base64.b64decode(result['sheet']))
        self.assertEqual(result['distinct'],10);self.assertTrue(all(result['repeat']))
        for row in result['rows']:
            for control in row['controls']:
                with self.subTest(preset=row['id'],key=control['key']):self.assertTrue(control['changed'],row)

    def test_silence_bypass_expiry_history_and_legacy_spectrum_only_analysis(self):
        result=self.page.evaluate('''()=>{
          const source=document.createElement('canvas');source.width=640;source.height=360;source.getContext('2d').fillStyle='#204260';source.getContext('2d').fillRect(0,0,640,360);
          const a=reactiveExampleAnalysis();a.samples.fill(0,24*a.bands);const legacy={...a,version:1};delete legacy.stereo;const silent={...legacy,samples:new Uint8Array(a.samples.length)},r=new ReactiveRenderer(),rows=[];
          for(const preset of PROJECT_SCHEMA.creativeReactivePresets.slice(20,30)){const s=validateCreativeReactiveFx({preset:preset.id});rows.push({id:preset.id,active:r.source(source,s,.37,legacy)!==source,silent:r.source(source,s,.37,silent)===source,expired:r.source(source,s,20,legacy)===source,bypass:r.source(source,{...s,amount:0},.37,legacy)===source,history:['ARX-21','ARX-22','ARX-23','ARX-26'].includes(preset.id)?r.source(source,s,.6,legacy)!==source:true});}return rows;
        }''')
        for row in result:
            with self.subTest(preset=row['id']):self.assertTrue(all(row[k] for k in ['active','silent','expired','bypass','history']),row)

    def test_real_selected_bus_post_analysis_reuse_and_audio_change_invalidation(self):
        path=Path(self.workspace.temporary.name)/'fields-bands.wav';t=np.arange(88200)/44100;gate=((t%.5)>.05)&((t%.5)<.22);left=(.2*np.sin(2*np.pi*110*t)+.12*np.sin(2*np.pi*900*t)+.08*np.sin(2*np.pi*4800*t))*gate
        with AudioFile(str(path),'w',44100,2,bit_depth=24) as handle:handle.write(np.stack([left,left*.8]).astype(np.float32))
        self.page.locator('#mainUpload').set_input_files(str(path));wait_for_browser(self.page,'!!audioEngine.files.main')
        self.page.evaluate("window.change(p=>{p.effects.speed=1;p.effects.reverb=0;p.tracks.main.fadeIn=p.tracks.main.fadeOut=0;p.audioBuses=[{id:'field-bus',name:'Alan sesi',audioFx:{preset:'AFX-11',amount:45,parameters:{delay:80}}}];p.tracks.main.bus='field-bus';p.video.reactiveFx={preset:'ARX-22'};p.video.reactiveAnalysis={source:'b:field-bus',point:'post'};});")
        self.show('#creativeReactivePresets');panel=self.page.locator('#creativeReactivePresets');panel.locator('.reactive-prepare').click();wait_for_browser(self.page,'!!reactiveAnalysisEditor.analysis',timeout=60000)
        result=self.page.evaluate('''()=>{const a=reactiveAnalysisEditor.analysis;window.fieldsPrepared=a;return {version:a.version,active:new ReactiveTimeline(a).at(projectStore.state.video.reactiveFx,.7).energy,source:projectStore.state.video.reactiveAnalysis.source,point:projectStore.state.video.reactiveAnalysis.point};}''')
        self.assertEqual(result['version'],2);self.assertGreater(result['active'],0);self.assertEqual(result['source'],'b:field-bus');self.assertEqual(result['point'],'post')
        for identifier in self.page.evaluate('PROJECT_SCHEMA.creativeReactivePresets.slice(20,30).map(p=>p.id)'):
            panel.locator(f'[data-preset="{identifier}"]').click();self.assertTrue(self.page.evaluate('reactiveAnalysisEditor.current()===window.fieldsPrepared'))
        self.page.evaluate('window.change(p=>p.audioBuses[0].volume=70)');self.assertTrue(self.page.evaluate('reactiveAnalysisEditor.analysis===null'));self.assertIn('yeniden',panel.locator('.reactive-status').inner_text())

    def test_catalog_drafts_automation_counts_history_copy_search_locks_and_responsive(self):
        self.workspace.load_audio();self.show('#creativeReactivePresets');panel=self.page.locator('#creativeReactivePresets');self.assertEqual(panel.locator('.fx-preset').count(),50)
        panel.locator('[data-preset="ARX-23"]').click();history=self.page.evaluate('projectStore.past.length');slider=panel.locator('input[type=range][data-fx-parameter="height"]');slider.evaluate("e=>{e.value=85;e.dispatchEvent(new Event('input',{bubbles:true}));}");self.assertEqual(self.page.evaluate('videoPreview.reactiveFxDraft.video.reactiveFx.parameters.height'),85);slider.dispatch_event('pointercancel');self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
        self.assertFalse(panel.locator('.fx-key-param option[value="grid"]').count());panel.locator('.fx-keys').evaluate('(e)=>e.open=true');panel.locator('.fx-key-param').select_option('height');panel.locator('.fx-key-time').fill('.5');panel.locator('.fx-key-value').fill('80');panel.locator('.fx-key-add').click();self.assertEqual(self.page.evaluate('projectStore.state.video.reactiveFx.automation.height[0][1]'),80)
        self.page.evaluate('projectStore.undo()');self.assertEqual(self.page.evaluate('projectStore.state.video.reactiveFx.automation'),{});self.page.evaluate('projectStore.redo()');panel.locator('.fx-save-name').fill('Arazim');panel.locator('.fx-save').click();self.assertEqual(self.page.evaluate('reactivePresetBrowser.library.custom[0].settings.automation'),{})
        history=self.page.evaluate('projectStore.past.length');self.page.keyboard.press('Control+k');query=self.page.locator('#studioToolQuery');query.fill('Polygon Morph');self.assertEqual(self.page.locator('.tool-result').count(),1);query.press('Enter');self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
        for theme in ('dark','light'):
            self.page.emulate_media(color_scheme=theme)
            for width in (320,375,768,1024,1440):self.page.set_viewport_size(dict(width=width,height=900));self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
        self.page.evaluate('window.change(p=>p.video.groupLocked=true)');self.assertTrue(panel.locator('[data-preset="ARX-30"]').is_disabled())

    def test_maximum_density_720h_profile_and_fixed_workspaces(self):
        result=self.page.evaluate('''()=>{
          const source=document.createElement('canvas');source.width=1280;source.height=720;source.getContext('2d').fillRect(0,0,1280,720);const a=reactiveExampleAnalysis();a.samples.fill(0);for(let tick=12;tick<a.frames;tick+=5)for(let band=0;band<a.bands;band++)a.samples[tick*a.bands+band]=255;
          const r=new ReactiveRenderer(),rows=[];
          for(const [id,parameters] of [['ARX-21',{damping:2,gap:.06}],['ARX-22',{lines:96,trail:2}],['ARX-23',{grid:32,history:3}],['ARX-24',{detail:96}],['ARX-25',{layers:10}],['ARX-26',{cell:3,gap:.06}],['ARX-27',{count:24}],['ARX-28',{symmetry:24}],['ARX-29',{rows:16,columns:24}],['ARX-30',{vertices:16}]]){const s=validateCreativeReactiveFx({preset:id,parameters}),times=[];for(let i=0;i<5;i++){const start=performance.now();r.source(source,s,2.9,a);times.push(performance.now()-start);}rows.push({id,median:times.sort((a,b)=>a-b)[2]});}
          const poolPixels=r.fields.pool.width*r.fields.pool.height,poolEdge=Math.max(r.fields.pool.width,r.fields.pool.height),portrait=document.createElement('canvas');portrait.width=320;portrait.height=1280;r.source(portrait,validateCreativeReactiveFx({preset:'ARX-21'}),2.9,a);return {rows,poolPixels,poolEdge,portraitPoolPixels:r.fields.pool.width*r.fields.pool.height,portraitPoolEdge:Math.max(r.fields.pool.width,r.fields.pool.height),maxEvents:r.frame(validateCreativeReactiveFx({preset:'ARX-21',parameters:{damping:2,gap:.06}}),2.9,a).events.length};
        }''')
        self.assertLessEqual(result['poolPixels'],20736);self.assertLessEqual(result['poolEdge'],192);self.assertEqual(result['maxEvents'],16)
        self.assertLessEqual(result['portraitPoolPixels'],20736);self.assertLessEqual(result['portraitPoolEdge'],192)
        for row in result['rows']:self.assertLess(row['median'],500,row)
        (Path(__file__).resolve().parents[1]/'.local/reactive-fields-profile.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
