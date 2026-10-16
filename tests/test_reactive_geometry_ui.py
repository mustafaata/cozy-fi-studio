"""Spectrum/stereo authoring and deterministic past-only drawing under production CSP."""
import base64
import json
from pathlib import Path
import unittest
import numpy as np
from pedalboard.io import AudioFile
import test_controller_ui as controller_ui
from browser_helpers import wait_for_browser


class ReactiveGeometryUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):controller_ui.ControllerUI.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls):controller_ui.ControllerUI.tearDownClass.__func__(cls)
    setUp=controller_ui.ControllerUI.setUp
    tearDown=controller_ui.ControllerUI.tearDown
    show=controller_ui.ControllerUI.show

    def test_ten_distinct_shapes_all_macros_seek_repeat_and_contact_sheet(self):
        result=self.page.evaluate('''()=>{
          const source=document.createElement('canvas');source.width=480;source.height=270;const ctx=source.getContext('2d');ctx.fillStyle='#121a24';ctx.fillRect(0,0,480,270);
          const analysis=reactiveExampleAnalysis(),renderer=new ReactiveRenderer(),times=[.31,.37,.6,1.45,2.35],rows=[],images=[],repeat=[];
          const render=(s,t)=>renderer.source(source,s,t,analysis).toDataURL();
          for(const preset of PROJECT_SCHEMA.creativeReactivePresets.slice(5,15)){
            const s=validateCreativeReactiveFx({preset:preset.id}),base=times.map(t=>render(s,t));images.push(base[1]);render(s,2.9);repeat.push(render(s,.37)===base[1]);
            const controls=[];for(const key of preset.parameterOrder.filter(key=>!preset.parameters[key].advanced)){const spec=preset.parameters[key];controls.push({key,changed:[spec.min,spec.max].some(value=>{const next=copyProject(s);next.parameters[key]=value;return times.some((t,i)=>render(next,t)!==base[i]);})});}rows.push({id:preset.id,controls});
          }
          const sheet=document.createElement('canvas');sheet.width=1600;sheet.height=460;const target=sheet.getContext('2d');target.fillStyle='#0e141c';target.fillRect(0,0,1600,460);
          PROJECT_SCHEMA.creativeReactivePresets.slice(5,15).forEach((preset,i)=>{const x=i%5*320,y=Math.floor(i/5)*230;target.fillStyle='#b9c0cd';target.font='13px Arial';target.fillText(preset.id+' · '+preset.name,x+12,y+22);target.drawImage(renderer.source(source,validateCreativeReactiveFx({preset:preset.id}),.37,analysis),x+8,y+38,304,171);});
          return {distinct:new Set(images).size,repeat,rows,sheet:sheet.toDataURL().split(',')[1]};
        }''')
        (Path(__file__).resolve().parents[1]/'.local'/'reactive-geometry-contact-sheet.png').write_bytes(base64.b64decode(result['sheet']))
        self.assertEqual(result['distinct'],10);self.assertTrue(all(result['repeat']))
        for row in result['rows']:
            for control in row['controls']:
                with self.subTest(preset=row['id'],control=control['key']):self.assertTrue(control['changed'],row)

    def test_history_is_present_after_sound_then_expires_and_silence_is_pixel_exact(self):
        result=self.page.evaluate('''()=>{
          const source=document.createElement('canvas');source.width=640;source.height=360;const ctx=source.getContext('2d');ctx.fillStyle='#1c2230';ctx.fillRect(0,0,640,360);
          const a=reactiveExampleAnalysis();a.samples.fill(0,24*a.bands);a.stereo.samples.fill(0,Math.floor(.4*a.stereo.rate)*2);a.stereo.moments.fill(0,25*3);
          const silent={...a,samples:new Uint8Array(a.samples.length),stereo:{...a.stereo,samples:new Uint8Array(a.stereo.samples.length),moments:new Float32Array(a.stereo.moments.length)}},r=new ReactiveRenderer(),rows=[];
          for(const id of ['ARX-06','ARX-08','ARX-11','ARX-13','ARX-15']){
            const params=id==='ARX-06'?{hold:.5}:id==='ARX-08'?{history:1,speed:.8}:id==='ARX-15'?{rings:8,interval:.1}:{trail:.5},s=validateCreativeReactiveFx({preset:id,parameters:params});
            rows.push({id,history:r.source(source,s,.6,a)!==source,expired:r.source(source,s,2.8,a)===source,silent:r.source(source,s,.37,silent)===source,bypass:r.source(source,{...s,amount:0},.37,a)===source});
          }return rows;
        }''')
        for row in result:
            with self.subTest(preset=row['id']):self.assertTrue(row['history'],row);self.assertTrue(row['expired'],row);self.assertTrue(row['silent']);self.assertTrue(row['bypass'])

    def test_real_antiphase_audio_preparation_reused_across_all_twenty_presets(self):
        path=Path(self.workspace.temporary.name)/'geometry-antiphase.wav';t=np.arange(44100)/44100;left=(.25*np.sin(2*np.pi*130*t)).astype(np.float32)
        with AudioFile(str(path),'w',44100,2,bit_depth=24) as handle:handle.write(np.stack([left,-left]))
        self.page.locator('#mainUpload').set_input_files(str(path));wait_for_browser(self.page,'!!audioEngine.files.main')
        self.page.evaluate("window.change(p=>{p.effects.speed=1;p.effects.reverb=0;p.tracks.main.fadeIn=p.tracks.main.fadeOut=0;p.video.reactiveFx={preset:'ARX-11'};p.video.reactiveAnalysis={source:'t:main',point:'pre'};});")
        self.show('#creativeReactivePresets');panel=self.page.locator('#creativeReactivePresets');panel.locator('.reactive-prepare').click();wait_for_browser(self.page,'!!reactiveAnalysisEditor.analysis',timeout=60000)
        result=self.page.evaluate('''()=>{const a=reactiveAnalysisEditor.analysis,timeline=new ReactiveGeometryTimeline(a),s=timeline.moments(.5,.1);window.geometryPrepared=a;return {version:a.version,rate:a.stereo.rate,frames:a.stereo.frames,correlation:s.correlation,mid:s.mid,side:s.side};}''')
        self.assertEqual(result['version'],2);self.assertEqual(result['rate'],6000);self.assertLess(result['correlation'],-.999);self.assertLess(result['mid'],.0001);self.assertGreater(result['side'],.1)
        for identifier in self.page.evaluate('PROJECT_SCHEMA.creativeReactivePresets.map(p=>p.id)'):
            panel.locator(f'[data-preset="{identifier}"]').click();self.assertTrue(self.page.evaluate('reactiveAnalysisEditor.analysis===window.geometryPrepared'))

    def test_new_catalog_drafts_curves_integer_counts_undo_search_custom_and_layout(self):
        self.workspace.load_audio();self.show('#creativeReactivePresets');panel=self.page.locator('#creativeReactivePresets');panel.locator('.fx-search').fill('spektrum')
        self.assertEqual(panel.locator('.fx-preset').count(),6);self.assertEqual(panel.locator('[data-preset="ARX-42"]').count(),1);panel.locator('[data-preset="ARX-06"]').click();history=self.page.evaluate('projectStore.past.length')
        slider=panel.locator('input[type=range][data-fx-parameter="hold"]');slider.evaluate("e=>{e.value=.8;e.dispatchEvent(new Event('input',{bubbles:true}));}");self.assertEqual(self.page.evaluate('videoPreview.reactiveFxDraft.video.reactiveFx.parameters.hold'),.8)
        slider.dispatch_event('pointercancel');self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
        field=panel.locator('input[type=number][data-fx-parameter="hold"]');field.fill('.8');field.press('Tab');self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
        panel.locator('.fx-keys').evaluate('(e)=>e.open=true');self.assertEqual(panel.locator('.fx-key-param option[value="bands"]').count(),0);panel.locator('.fx-key-param').select_option('hold');panel.locator('.fx-key-time').fill('.5');panel.locator('.fx-key-value').fill('.2');panel.locator('.fx-key-add').click()
        self.assertEqual(self.page.evaluate('projectStore.state.video.reactiveFx.automation.hold[0][1]'),.2)
        panel.locator('.fx-save-name').fill('Spektrumum');panel.locator('.fx-save').click();self.assertEqual(self.page.evaluate('reactivePresetBrowser.library.custom[0].settings.automation'),{})
        self.page.evaluate('projectStore.undo()');self.assertEqual(self.page.evaluate('projectStore.state.video.reactiveFx.automation'),{});self.page.evaluate('projectStore.redo()')
        history=self.page.evaluate('projectStore.past.length');self.page.keyboard.press('Control+k');query=self.page.locator('#studioToolQuery');query.fill('Stereo Lissajous');self.assertEqual(self.page.locator('.tool-result').count(),1);query.press('Enter');self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
        panel.locator('.fx-search').fill('');panel.locator('.fx-filter').select_option('all')
        for theme in ('dark','light'):
            self.page.emulate_media(color_scheme=theme)
            for width in (320,375,768,1024,1440):
                self.page.set_viewport_size(dict(width=width,height=900));self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
                self.assertTrue(panel.locator('.fx-preset').first.evaluate('(e)=>{const text=e.querySelector("strong").getBoundingClientRect(),card=e.getBoundingClientRect();return text.bottom<=card.bottom+1&&text.right<=card.right+1;}'))

    def test_720h_geometry_render_budget_with_maximum_history_and_density(self):
        result=self.page.evaluate('''()=>{
          const source=document.createElement('canvas');source.width=1280;source.height=720;source.getContext('2d').fillRect(0,0,1280,720);const a=reactiveExampleAnalysis(),r=new ReactiveRenderer(),rows=[];
          for(const [id,parameters] of [['ARX-08',{history:8}],['ARX-12',{points:512}],['ARX-15',{rings:24}]]){const s=validateCreativeReactiveFx({preset:id,parameters}),times=[];for(let i=0;i<6;i++){const start=performance.now();r.source(source,s,.37,a);times.push(performance.now()-start);}rows.push({id,median:times.sort((a,b)=>a-b)[3]});}return rows;
        }''')
        (Path(__file__).resolve().parents[1]/'.local'/'reactive-geometry-profile.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        for row in result:
            with self.subTest(preset=row['id']):self.assertLess(row['median'],500,row)

    def test_legacy_spectrum_analysis_explicitly_requests_stereo_preparation(self):
        self.workspace.load_audio();self.show('#creativeReactivePresets');panel=self.page.locator('#creativeReactivePresets')
        result=self.page.evaluate('''()=>{
          window.change(p=>p.video.reactiveFx={preset:'ARX-11'});const legacy={...reactiveExampleAnalysis(),version:1};delete legacy.stereo;reactiveAnalysisEditor.analysis=legacy;reactiveAnalysisEditor.refresh();
          const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;return new ReactiveRenderer().source(canvas,projectStore.state.video.reactiveFx,.37,legacy)===canvas;
        }''')
        self.assertTrue(result);self.assertIn('stereo',panel.locator('.reactive-status').inner_text());self.assertIn('yeniden',panel.locator('.reactive-status').inner_text())
        self.page.evaluate("reactiveAnalysisEditor.clear('Analiz temizlendi.');")
        self.assertEqual(panel.locator('.reactive-status').inner_text(),'Analiz temizlendi.')
        self.page.evaluate('reactiveAnalysisEditor.analysis=reactiveExampleAnalysis();reactiveAnalysisEditor.refresh()')
        self.assertFalse(panel.locator('.reactive-status').evaluate("e=>e.classList.contains('is-error')"))
