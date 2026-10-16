import base64
from pathlib import Path
import unittest
from browser_helpers import wait_for_browser
import test_temporal_video_ui as temporal_ui

class FinalVisualUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):temporal_ui.TemporalVideoUI.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls):temporal_ui.TemporalVideoUI.tearDownClass.__func__(cls)
    setUp=temporal_ui.TemporalVideoUI.setUp
    tearDown=temporal_ui.TemporalVideoUI.tearDown
    show=temporal_ui.TemporalVideoUI.show

    def test_all_twenty_text_presets_distinct_seek_bypass_and_controls(self):
        result=self.page.evaluate('''()=>{
          const canvas=document.createElement('canvas');canvas.width=480;canvas.height=180;const ctx=canvas.getContext('2d'),render=(s,t)=>{ctx.clearRect(0,0,480,180);ctx.font='48px Arial';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillStyle='#eee';paintTextFx(ctx,'İstanbul O',240,55,{settings:s,time:t,local:t,duration:4,size:48,lineHeight:60,wordState:{active:true,progress:.5,fragmentProgress:.5,elapsed:.2,remaining:.3}},(c,text,x,y)=>c.fillText(text,x,y));return canvas.toDataURL();},neutral=render(validateCreativeTextFx({}),.37),rows=[],images=[],sheet=document.createElement('canvas');sheet.width=1920;sheet.height=1100;const c=sheet.getContext('2d');c.fillStyle='#141e38';c.fillRect(0,0,1920,1100);
          PROJECT_SCHEMA.creativeTextPresets.slice(30).forEach((preset,i)=>{const s=validateCreativeTextFx({preset:preset.id}),t=['TFX-46','TFX-49'].includes(preset.id)?3.7:preset.id==='TFX-50'?.55:.37,base=render(s,t);images.push(base);render(s,2.3);const repeat=render(s,t)===base,controls=[];for(const key of preset.parameterOrder){const spec=preset.parameters[key],next=copyProject(s);next.parameters[key]=spec.type==='string'?'Bambaşka metin':spec.default===spec.min?spec.max:spec.min;controls.push({key,changed:render(next,t)!==base});}rows.push({id:preset.id,changed:base!==neutral,repeat,bypass:render({...s,amount:0},t)===neutral,controls});render(s,t);const x=i%4*480,y=Math.floor(i/4)*220;c.fillStyle='#cbd2df';c.font='14px Arial';c.fillText(preset.name,x+12,y+25);c.drawImage(canvas,x,y+35);});return {rows,distinct:new Set(images).size,sheet:sheet.toDataURL().split(',')[1]};
        }''')
        self.assertEqual(result['distinct'],20)
        for row in result['rows']:self.assertTrue(row['changed'] and row['repeat'] and row['bypass'],row)
        (Path(__file__).resolve().parents[1]/'.local/final-text-contact-sheet.png').write_bytes(base64.b64decode(result['sheet']))
        (Path(__file__).resolve().parents[1]/'.local/final-text-controls.txt').write_text(str(result['rows']),encoding='utf-8')

    def test_all_twenty_reactive_presets_seek_repeat_silence_bypass_and_text_scope(self):
        result=self.page.evaluate('''()=>{
          const analysis=reactiveExampleAnalysis(),source=document.createElement('canvas');source.width=320;source.height=180;const c=source.getContext('2d'),g=c.createLinearGradient(0,0,320,180);g.addColorStop(0,'#173b68');g.addColorStop(1,'#e0b05a');c.fillStyle=g;c.fillRect(0,0,320,180);c.fillStyle='white';c.fillRect(90,40,40,70);c.fillStyle='#302245';c.fillRect(210,10,30,130);const renderer=new ReactiveRenderer(),canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d'),sheet=document.createElement('canvas');sheet.width=1600;sheet.height=880;const sc=sheet.getContext('2d');sc.fillStyle='#141e38';sc.fillRect(0,0,1600,880);const rows=[],images=[];
          const render=(s,t,a=analysis)=>{ctx.clearRect(0,0,320,180);ctx.drawImage(renderer.source(source,s,t,a,137),0,0);const frame=renderer.frame(s,t,a,137);if(frame&&REACTIVE_TEXT_ALGORITHMS.has(frame.algorithm)){ctx.font='40px Arial';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillStyle='white';paintTextFx(ctx,'Studio',160,60,{settings:validateCreativeTextFx({}),size:40,reactiveFrame:frame,wordState:{active:true}},(c,text,x,y)=>c.fillText(text,x,y));}return canvas.toDataURL();};
          PROJECT_SCHEMA.creativeReactivePresets.slice(30).forEach((preset,i)=>{let s=validateCreativeReactiveFx({preset:preset.id});if(preset.id==='ARX-49')s.parameters.trend=0;const t=1.3,base=render(s,t);images.push(base);render(s,2.9);const repeat=render(s,t)===base,silent={...analysis,samples:new Uint8Array(analysis.samples.length),features:new Float32Array(analysis.features.length),stereo:{...analysis.stereo,samples:new Uint8Array(analysis.stereo.samples.length),moments:new Float32Array(analysis.stereo.moments.length)}};const frame=renderer.frame(s,t,silent,137),off=renderer.source(source,{...s,amount:0},t,analysis)===source;rows.push({id:preset.id,repeat,off,silent:frame.energy===0&&frame.events.length===0,text:REACTIVE_TEXT_ALGORITHMS.has(preset.algorithm)?renderer.source(source,s,t,analysis)===source:true});render(s,t);const x=i%5*320,y=Math.floor(i/5)*220;sc.fillStyle='#cbd2df';sc.font='14px Arial';sc.fillText(preset.name,x+8,y+25);sc.drawImage(canvas,x,y+35);});return {rows,distinct:new Set(images).size,sheet:sheet.toDataURL().split(',')[1]};
        }''')
        self.assertEqual(result['distinct'],20)
        for row in result['rows']:self.assertTrue(row['repeat'] and row['off'] and row['silent'] and row['text'],row)
        (Path(__file__).resolve().parents[1]/'.local/final-reactive-contact-sheet.png').write_bytes(base64.b64decode(result['sheet']))

    def test_second_text_editor_history_custom_copy_and_responsive_catalogs(self):
        with self.workspace.open_visual_layers():
            self.page.evaluate("visualLayerEditor.add('text')")
            self.show('#creativeTextPresets');panel=self.page.locator('#creativeTextPresets');panel.locator('.fx-target').select_option('layer');panel.locator('[data-preset="TFX-50"]').click();field=panel.locator('textarea[data-fx-parameter="second"]');field.fill('İkinci başlık 👋 <script>');field.press('Tab')
            self.assertEqual(self.page.evaluate('projectStore.state.visualLayers[0].textFx.parameters.second'),'İkinci başlık 👋 <script>');self.page.evaluate('projectStore.undo()');self.assertEqual(field.input_value(),'Yeni bölüm');self.page.evaluate('projectStore.redo()')
            panel.locator('.fx-save-name').fill('İki başlık');panel.locator('.fx-save').click();self.assertEqual(self.page.evaluate('textPresetBrowser.library.custom[0].settings.parameters.second'),'İkinci başlık 👋 <script>')
            for theme in ('dark','light'):
                self.page.emulate_media(color_scheme=theme)
                for width in (320,375,768,1024,1440):
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)

    def test_timed_word_fx_are_neutral_without_real_words_and_animate_with_them(self):
        result=self.page.evaluate('''()=>{
          const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d'),metrics=JSON.parse(document.getElementById('lyricFontMetrics').textContent),p=validateProject({version:1,tracks:{main:{source:{name:'x',size:1,lastModified:0,duration:4}}},effects:{speed:1},lyrics:{enabled:true,timeBase:'project',font:'Arial',fontSize:48,color:'#ffffff',outline:0,animation:'none',lines:[{id:'words',text:'bir iki',start:0,end:4,words:[{text:'bir',start:0,end:2},{text:'iki',start:2,end:4}]}]}}),rows=[];
          for(let i=31;i<=34;i++){p.lyrics.textFx=validateCreativeTextFx({preset:'TFX-'+i});drawLyricLayer(canvas,p,1,metrics);const a=canvas.toDataURL();drawLyricLayer(canvas,p,3,metrics);const b=canvas.toDataURL();delete p.lyrics.lines[0].words;drawLyricLayer(canvas,p,1,metrics);const noWords=canvas.toDataURL();p.lyrics.textFx.enabled=false;drawLyricLayer(canvas,p,1,metrics);const neutral=canvas.toDataURL();p.lyrics.lines[0].words=[{text:'bir',start:0,end:2},{text:'iki',start:2,end:4}];rows.push({id:i,changed:a!==b,neutral:noWords===neutral});}return rows;
        }''')
        for row in result:self.assertTrue(row['changed'] and row['neutral'],row)

    def test_karaoke_and_two_line_templates_are_exact_when_new_word_fx_are_bypassed(self):
        rows=self.page.evaluate('''()=>{
          const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const metrics=JSON.parse(document.getElementById('lyricFontMetrics').textContent),p=validateProject({version:1,tracks:{main:{source:{name:'x',size:1,lastModified:0,duration:4}}},effects:{speed:1},lyrics:{enabled:true,timeBase:'project',font:'Arial',animation:'none',fontSize:48,outline:0,lines:[{id:'a',text:'bir iki',start:0,end:2,words:[{text:'bir',start:0,end:1},{text:'iki',start:1,end:2}]},{id:'b',text:'üç dört',start:2,end:4}]}}),rows=[];
          for(let i=31;i<=35;i++){p.lyrics.template=i===35?'two-line':'karaoke';p.lyrics.textFx=validateCreativeTextFx({});drawLyricLayer(canvas,p,.5,metrics);const neutral=canvas.toDataURL();p.lyrics.textFx=validateCreativeTextFx({preset:'TFX-'+i,enabled:false});drawLyricLayer(canvas,p,.5,metrics);const off=canvas.toDataURL()===neutral;p.lyrics.textFx=validateCreativeTextFx({preset:'TFX-'+i,amount:0});drawLyricLayer(canvas,p,.5,metrics);rows.push({id:i,off,zero:canvas.toDataURL()===neutral});}return rows;
        }''')
        for row in rows:self.assertTrue(row['off'] and row['zero'],row)
