import base64
import json
from pathlib import Path
import unittest
import test_controller_ui as controller_ui


class TextKineticUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):controller_ui.ControllerUI.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls):controller_ui.ControllerUI.tearDownClass.__func__(cls)
    setUp=controller_ui.ControllerUI.setUp
    tearDown=controller_ui.ControllerUI.tearDown
    show=controller_ui.ControllerUI.show

    def test_distinct_ten_images_all_primary_macros_seek_repeat_and_contact_sheet(self):
        result=self.page.evaluate('''()=>{
          const canvas=document.createElement('canvas');canvas.width=460;canvas.height=240;const ctx=canvas.getContext('2d');
          const render=(s,t)=>{ctx.clearRect(0,0,460,240);ctx.font='bold 52px Arial';ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.fillStyle='#f0c080';paintTextFx(ctx,'İstanbul O!',230,135,{settings:s,time:t,local:t,duration:4,size:52,lineHeight:65},(c,text,x,y)=>c.fillText(text,x,y));return canvas.toDataURL();};
          const images=[],rows=[],repeat=[],times=[.03,.14,.37,.73,1.25];
          for(const preset of PROJECT_SCHEMA.creativeTextPresets.slice(20,30)){const s=validateCreativeTextFx({preset:preset.id}),base=times.map(t=>render(s,t));images.push(render(s,textKineticPreviewTime(s)));render(s,3.9);repeat.push(render(s,.14)===base[1]);const controls=[];
            for(const key of preset.parameterOrder.filter(k=>!preset.parameters[k].advanced)){const spec=preset.parameters[key];controls.push({key,changed:[spec.min,spec.max].some(v=>{const next=copyProject(s);next.parameters[key]=v;return times.some((t,i)=>render(next,t)!==base[i]);})});}rows.push({id:preset.id,controls});}
          const sheet=document.createElement('canvas');sheet.width=1600;sheet.height=470;const target=sheet.getContext('2d');target.fillStyle='#121820';target.fillRect(0,0,1600,470);
          PROJECT_SCHEMA.creativeTextPresets.slice(20,30).forEach((preset,i)=>{const s=validateCreativeTextFx({preset:preset.id});render(s,textKineticPreviewTime(s));const x=i%5*320,y=Math.floor(i/5)*235;target.fillStyle='#b9c0cd';target.font='14px Arial';target.fillText(preset.id+' · '+preset.name,x+12,y+24);target.drawImage(canvas,x+8,y+35,304,180);});return {distinct:new Set(images).size,repeat,rows,sheet:sheet.toDataURL().split(',')[1]};
        }''')
        (Path(__file__).resolve().parents[1]/'.local/text-kinetic-contact-sheet.png').write_bytes(base64.b64decode(result['sheet']))
        self.assertEqual(result['distinct'],10);self.assertTrue(all(result['repeat']))
        for row in result['rows']:
            for control in row['controls']:
                with self.subTest(preset=row['id'],key=control['key']):self.assertTrue(control['changed'],row)

    def test_unicode_settled_identity_bypass_partial_mix_and_rgb_alpha_mask(self):
        result=self.page.evaluate('''()=>{
          const canvas=document.createElement('canvas');canvas.width=640;canvas.height=240;const ctx=canvas.getContext('2d'),render=(s,t=3.3)=>{ctx.clearRect(0,0,640,240);ctx.font='56px Arial';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillStyle='#c8e8ff';paintTextFx(ctx,'İ ş é 👨‍👩‍👧‍👦',320,80,{settings:s,time:t,local:t,duration:4,size:56,lineHeight:70},(c,text,x,y)=>c.fillText(text,x,y));return ctx.getImageData(0,0,640,240).data.slice();};
          const neutral=render(validateCreativeTextFx({})),rows=[];for(const preset of PROJECT_SCHEMA.creativeTextPresets.slice(20,30)){const s=validateCreativeTextFx({preset:preset.id}),bypass=render({...s,amount:0});rows.push({id:preset.id,bypass:bypass.every((v,i)=>v===neutral[i]),settled:!['TFX-21','TFX-23','TFX-26','TFX-29'].includes(preset.id)||render(s).every((v,i)=>v===neutral[i])});}
          const s=validateCreativeTextFx({preset:'TFX-22',parameters:{height:100,distance:25}}),effect=render(s,.01),half=render({...s,amount:50},.01);let alpha=0,error=0;for(let i=0;i<half.length;i+=4){alpha=Math.max(alpha,Math.abs(effect[i+3]-neutral[i+3]));for(let c=0;c<4;c++)error=Math.max(error,Math.abs(half[i+c]*half[i+3]/255-(effect[i+c]*effect[i+3]/255+neutral[i+c]*neutral[i+3]/255)/2));}return {rows,alpha,error};
        }''')
        self.assertEqual(result['alpha'],0);self.assertLessEqual(result['error'],3)
        for row in result['rows']:self.assertTrue(row['bypass'],row);self.assertTrue(row['settled'],row)

    def test_real_karaoke_colours_rich_title_styles_and_single_fragment_cursor(self):
        result=self.page.evaluate('''()=>{
          const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d'),metrics=JSON.parse(document.getElementById('lyricFontMetrics').textContent),p=validateProject({version:PROJECT_SCHEMA.version,tracks:{main:{end:4}},effects:{speed:1},lyrics:{enabled:true,timeBase:'project',font:'Arial',template:'karaoke',animation:'none',wordAnimation:'none',fontSize:72,outline:0,glow:0,glowIntensity:0,color:'#ffffff',glowColor:'#00ffff',lines:[{id:'cue',text:'İstanbul ışığı',start:0,end:4,words:[{text:'İstanbul',start:0,end:2},{text:'ışığı',start:2,end:4}]}]}}),rows=[];
          for(const preset of PROJECT_SCHEMA.creativeTextPresets.slice(20,30)){p.lyrics.textFx=validateCreativeTextFx({preset:preset.id});drawLyricLayer(canvas,p,1.7,metrics);const data=ctx.getImageData(0,0,640,360).data;let highlight=0,normal=0;for(let i=0;i<data.length;i+=4)if(data[i+3]>8){if(data[i]<40&&data[i+1]>200&&data[i+2]>200)highlight++;if(data[i]>220&&data[i+1]>220&&data[i+2]>220)normal++;}rows.push({id:preset.id,highlight,normal});}
          const painter=new TextKineticPainter(),settings=validateCreativeTextFx({preset:'TFX-25',parameters:{charTime:.1,blink:1}}),fx=textFxAtTime(settings,.2,.2,4),options={settings,time:.2,local:.2,duration:4,size:40,lineHeight:50,row:'ABCD',bounds:{left:0,top:0,width:120,height:50}};ctx.font='40px Arial';ctx.textAlign='left';ctx.textBaseline='top';let cursors=0;const fill=CanvasRenderingContext2D.prototype.fillRect;CanvasRenderingContext2D.prototype.fillRect=function(...args){cursors++;return fill.apply(this,args);};try{painter.paint(ctx,'AB',0,0,{...options,prefix:''},(c,t,x,y)=>c.fillText(t,x,y),fx);painter.paint(ctx,'CD',ctx.measureText('AB').width,0,{...options,prefix:'AB'},(c,t,x,y)=>c.fillText(t,x,y),fx);}finally{CanvasRenderingContext2D.prototype.fillRect=fill;}return {rows,cursors};
        }''')
        self.assertEqual(result['cursors'],1)
        for row in result['rows']:self.assertGreater(row['highlight'],5,row);self.assertGreater(row['normal'],5,row)

    def test_surface_and_layout_budgets_fonts_invalidation_and_desktop_profile(self):
        result=self.page.evaluate('''async()=>{
          const painter=new TextKineticPainter(),canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');ctx.textBaseline='top';ctx.font='56px Arial';const fonts=[];
          for(const font of ['Arial','Poppins','Caveat','Playfair Display','Syne']){await document.fonts.load(`56px "${font}"`);ctx.font=`56px "${font}"`;fonts.push(painter.layout(ctx,'İ é 👨‍👩‍👧‍👦').length===5);}
          for(let i=0;i<40;i++)painter.layout(ctx,'Metin '+i);const entries=painter.layouts.size,glyphs=painter.layoutGlyphs;document.fonts.dispatchEvent(new Event('loadingdone'));const after=painter.layouts.size;
          const rows=[];ctx.font='56px Arial';ctx.fillStyle='white';for(const preset of PROJECT_SCHEMA.creativeTextPresets.slice(20,30)){const s=validateCreativeTextFx({preset:preset.id}),options={settings:s,time:.14,local:.14,duration:4,size:56,lineHeight:70},fx=textFxAtTime(s,.14,.14,4),times=[];for(let i=0;i<6;i++){ctx.clearRect(0,0,640,360);const start=performance.now();painter.paint(ctx,'İstanbul O',80,130,options,(c,t,x,y)=>c.fillText(t,x,y),fx);times.push(performance.now()-start);}rows.push({id:preset.id,median:times.sort((a,b)=>a-b)[3]});}
          ctx.font='800px Arial';const s=validateCreativeTextFx({preset:'TFX-23'});painter.paint(ctx,'W'.repeat(300),0,0,{settings:s,time:.1,local:.1,duration:4,size:800},(c,t,x,y)=>c.fillText(t,x,y),textFxAtTime(s,.1,.1,4));return {fonts,entries,glyphs,after,rows,pixels:painter.native.width*painter.native.height,edge:Math.max(painter.native.width,painter.native.height)};
        }''')
        self.assertTrue(all(result['fonts']));self.assertLessEqual(result['entries'],16);self.assertLessEqual(result['glyphs'],8192);self.assertEqual(result['after'],0);self.assertLessEqual(result['edge'],2048);self.assertLessEqual(result['pixels'],262144+4096)
        for row in result['rows']:self.assertLess(row['median'],300,row)
        (Path(__file__).resolve().parents[1]/'.local/text-kinetic-profile.json').write_text(json.dumps(result,indent=2),encoding='utf-8')

    def test_catalog_targets_curves_integer_seed_cancel_history_search_locks_and_layout(self):
        self.workspace.load_audio();self.show('#creativeTextPresets');panel=self.page.locator('#creativeTextPresets');self.assertEqual(panel.locator('.fx-preset').count(),50)
        panel.locator('[data-preset="TFX-23"]').click();history=self.page.evaluate('projectStore.past.length');slider=panel.locator('input[type=range][data-fx-parameter="distance"]');slider.evaluate("e=>{e.value=180;e.dispatchEvent(new Event('input',{bubbles:true}));}");self.assertEqual(self.page.evaluate('lyricsPreview.textFxDraft.lyrics.textFx.parameters.distance'),180);slider.dispatch_event('pointercancel');self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
        panel.locator('.fx-keys').evaluate('(e)=>e.open=true');panel.locator('.fx-key-param').select_option('distance');panel.locator('.fx-key-time').fill('.5');panel.locator('.fx-key-value').fill('160');panel.locator('.fx-key-add').click();self.assertEqual(self.page.evaluate('projectStore.state.lyrics.textFx.automation.distance[0][1]'),160);self.assertFalse(panel.locator('.fx-key-param option[value="seed"]').count())
        panel.locator('.fx-save-name').fill('Birleşen metnim');panel.locator('.fx-save').click();self.assertEqual(self.page.evaluate('textPresetBrowser.library.custom[0].settings.automation'),{})
        self.page.evaluate("window.change(p=>p.visualLayers=[{id:'kinetic-title',type:'title'}]);visualLayerEditor.select('kinetic-title');")
        self.show('#creativeTextPresets');panel.locator('.fx-target').select_option('layer');panel.locator('[data-preset="TFX-29"]').click();panel.locator('select[data-fx-parameter="axis"]').select_option('1');self.assertEqual(self.page.evaluate('projectStore.state.visualLayers[0].textFx.parameters.axis'),1);self.page.evaluate('projectStore.undo()');self.assertEqual(panel.locator('select[data-fx-parameter="axis"]').input_value(),'0')
        history=self.page.evaluate('projectStore.past.length');self.page.keyboard.press('Control+k');query=self.page.locator('#studioToolQuery');query.fill('Perspective Crawl');self.assertEqual(self.page.locator('.tool-result').count(),1);query.press('Enter');self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
        for theme in ('dark','light'):
            self.page.emulate_media(color_scheme=theme)
            for width in (320,375,768,1024,1440):self.page.set_viewport_size(dict(width=width,height=900));self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
        self.page.evaluate('window.change(p=>p.visualLayers[0].locked=true)');self.assertTrue(panel.locator('[data-preset="TFX-30"]').is_disabled())
