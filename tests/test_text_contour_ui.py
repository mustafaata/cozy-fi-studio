"""Native glyph contour rendering and authoring on production WSGI/CSP."""
import base64
from pathlib import Path
import unittest
import test_controller_ui as controller_ui


class TextContourUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):controller_ui.ControllerUI.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls):controller_ui.ControllerUI.tearDownClass.__func__(cls)
    setUp=controller_ui.ControllerUI.setUp
    tearDown=controller_ui.ControllerUI.tearDown
    show=controller_ui.ControllerUI.show

    def test_native_font_holes_turkish_emoji_cache_bounds_and_font_invalidation(self):
        result=self.page.evaluate('''async()=>{
          const painter=new TextContourPainter(),canvas=document.createElement('canvas');canvas.width=400;canvas.height=180;const ctx=canvas.getContext('2d');ctx.font='72px Arial';ctx.textBaseline='alphabetic';
          const hole=painter.geometry(ctx,'O',72),closed=hole.contours.every(path=>path.closed);ctx.translate(50,110);ctx.lineWidth=2;ctx.strokeStyle='white';painter.stroke(ctx,hole,0,1);
          const m=ctx.measureText('O'),cx=Math.round(50+(m.actualBoundingBoxRight-m.actualBoundingBoxLeft)/2),cy=Math.round(110+(m.actualBoundingBoxDescent-m.actualBoundingBoxAscent)/2),center=ctx.getImageData(cx,cy,1,1).data[3];
          const fonts=[];for(const font of ['Arial','Poppins','Caveat','Playfair Display','Syne']){await document.fonts.load(`700 56px "${font}"`);ctx.font=`700 56px "${font}"`;const geometry=painter.geometry(ctx,'İ ğ ş é 👨‍👩‍👧‍👦',56);fonts.push({font,length:geometry.length,paths:geometry.contours.length,closed:geometry.contours.every(p=>p.closed)});}
          for(let i=0;i<70;i++)painter.geometry(ctx,'Metin '+i,56);const entries=painter.cache.size,points=painter.cachePoints;document.fonts.dispatchEvent(new Event('loadingdone'));
          return {holes:hole.contours.length,closed,center,fonts,entries,points,after:painter.cache.size};
        }''')
        self.assertGreaterEqual(result['holes'],2);self.assertTrue(result['closed']);self.assertEqual(result['center'],0)
        for row in result['fonts']:
            with self.subTest(font=row['font']):self.assertGreater(row['paths'],5);self.assertGreater(row['length'],100);self.assertTrue(row['closed'])
        self.assertLessEqual(result['entries'],32);self.assertLessEqual(result['points'],262144);self.assertEqual(result['after'],0)

    def test_five_distinct_contours_repeat_on_seek_and_each_macro_changes_the_image(self):
        result=self.page.evaluate('''()=>{
          const canvas=document.createElement('canvas');canvas.width=420;canvas.height=180;const ctx=canvas.getContext('2d');
          const render=(settings,time)=>{ctx.clearRect(0,0,420,180);ctx.font='56px Arial';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillStyle='#fff';paintTextFx(ctx,'İstanbul O',210,55,{settings,time,local:time,duration:4,size:56,lineHeight:70},(target,text,x,y)=>target.fillText(text,x,y));return canvas.toDataURL();};
          const images=[],rows=[],repeat=[];for(const preset of PROJECT_SCHEMA.creativeTextPresets.slice(10,15)){
            const settings=validateCreativeTextFx({preset:preset.id}),times=[.37,1.2,1.5,2.9,3.5],base=times.map(time=>render(settings,time));images.push(base[0]);render(settings,3.9);repeat.push(render(settings,.37)===base[0]);
            const controls=[];for(const key of preset.parameterOrder.filter(key=>!preset.parameters[key].advanced)){const spec=preset.parameters[key],next=copyProject(settings);next.parameters[key]=settings.parameters[key]===spec.max?spec.min:spec.max;controls.push({key,changed:times.some((time,i)=>render(next,time)!==base[i])});}rows.push({id:preset.id,controls});
          }
          const sheet=document.createElement('canvas');sheet.width=1600;sheet.height=220;const target=sheet.getContext('2d');target.fillStyle='#121820';target.fillRect(0,0,1600,220);
          PROJECT_SCHEMA.creativeTextPresets.slice(10,15).forEach((preset,i)=>{target.save();target.translate(i*320,0);target.fillStyle='#b9c0cd';target.font='14px Arial';target.fillText(preset.id+' · '+preset.name,16,26);target.font='48px Arial';target.textBaseline='top';target.textAlign='center';target.fillStyle='#fff';const time=preset.id==='TFX-15'?3.5:preset.id==='TFX-14'?.37:.7;paintTextFx(target,'İstanbul',160,82,{settings:validateCreativeTextFx({preset:preset.id}),time,local:time,duration:4,size:48,lineHeight:60},(c,t,x,y)=>c.fillText(t,x,y));target.restore();});
          return {distinct:new Set(images).size,repeat,rows,sheet:sheet.toDataURL().split(',')[1]};
        }''')
        output=Path(__file__).resolve().parents[1]/'.local'/'text-contour-contact-sheet.png';output.parent.mkdir(exist_ok=True);output.write_bytes(base64.b64decode(result['sheet']))
        self.assertEqual(result['distinct'],5);self.assertTrue(all(result['repeat']))
        for row in result['rows']:
            for control in row['controls']:
                with self.subTest(preset=row['id'],control=control['key']):self.assertTrue(control['changed'])

    def test_partial_amount_keeps_opaque_native_pixels_and_bypass_is_pixel_exact(self):
        result=self.page.evaluate('''()=>{
          const canvas=document.createElement('canvas');canvas.width=400;canvas.height=180;const ctx=canvas.getContext('2d');
          const draw=(settings,time=1)=>{ctx.clearRect(0,0,400,180);ctx.font='64px Arial';ctx.textBaseline='top';ctx.fillStyle='#fff';paintTextFx(ctx,'İstanbul',30,55,{settings,time,local:time,duration:4,size:64,lineHeight:80},(c,t,x,y)=>c.fillText(t,x,y));return ctx.getImageData(0,0,400,180).data;};
          const neutral=draw(validateCreativeTextFx({})),full=draw(validateCreativeTextFx({preset:'TFX-15'})),half=draw(validateCreativeTextFx({preset:'TFX-15',amount:50}));let opaque=0,dimmed=0;
          for(let i=0;i<neutral.length;i+=4)if(neutral[i+3]===255&&full[i+3]===255){opaque++;if(half[i+3]<254)dimmed++;}
          const bypass=draw(validateCreativeTextFx({preset:'TFX-13',amount:0})),legacy=[];for(const preset of ['TFX-06','TFX-08','TFX-10']){const full=draw(validateCreativeTextFx({preset}),.37),half=draw(validateCreativeTextFx({preset,amount:50}),.37);let solid=0,dim=0;for(let i=0;i<neutral.length;i+=4)if(neutral[i+3]===255&&full[i+3]===255){solid++;if(half[i+3]<254)dim++;}legacy.push({preset,solid,dim});}return {opaque,dimmed,bypass:neutral.every((v,i)=>v===bypass[i]),legacy};
        }''')
        self.assertGreater(result['opaque'],1000);self.assertEqual(result['dimmed'],0);self.assertTrue(result['bypass'])
        for row in result['legacy']:
            with self.subTest(preset=row['preset']):self.assertGreater(row['solid'],100);self.assertEqual(row['dim'],0)

    def test_chalk_grain_stays_on_the_same_glyph_pixels_when_karaoke_glow_changes(self):
        result=self.page.evaluate('''()=>{
          const canvas=document.createElement('canvas');canvas.width=400;canvas.height=180;const ctx=canvas.getContext('2d');
          const draw=(settings,glow)=>{ctx.clearRect(0,0,400,180);ctx.font='64px Arial';ctx.textBaseline='top';ctx.fillStyle='white';ctx.shadowColor='white';ctx.shadowBlur=glow;paintTextFx(ctx,'İstanbul',30,55,{settings,time:2,local:2,duration:4,size:64,lineHeight:80},(c,t,x,y)=>c.fillText(t,x,y));return ctx.getImageData(0,0,400,180).data;};
          const settings=validateCreativeTextFx({preset:'TFX-13',parameters:{density:100,roughness:20}}),native=draw(validateCreativeTextFx({}),0),plain=draw(settings,0),glow=draw(settings,12);let max=0,holes=0;for(let i=0;i<native.length;i+=4)if(native[i+3]===255){if(plain[i+3]<240)holes++;max=Math.max(max,Math.abs(plain[i+3]-glow[i+3]));}return {max,holes};
        }''')
        self.assertGreater(result['holes'],100);self.assertLessEqual(result['max'],1)

    def test_catalog_lyrics_title_automation_cancel_history_custom_and_layout(self):
        self.workspace.load_audio();self.show('#creativeTextPresets');panel=self.page.locator('#creativeTextPresets');panel.locator('.fx-search').fill('kontur')
        self.assertEqual(panel.locator('.fx-preset').count(),5);panel.locator('[data-preset="TFX-13"]').click();history=self.page.evaluate('projectStore.past.length')
        slider=panel.locator('input[type=range][data-fx-parameter="density"]');slider.evaluate("e=>{e.value=80;e.dispatchEvent(new Event('input',{bubbles:true}));}");self.assertEqual(self.page.evaluate('lyricsPreview.textFxDraft.lyrics.textFx.parameters.density'),80)
        slider.dispatch_event('pointercancel');self.assertEqual(self.page.evaluate('projectStore.past.length'),history);self.assertEqual(slider.input_value(),'65')
        field=panel.locator('input[type=number][data-fx-parameter="density"]');field.fill('80');field.press('Tab');self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
        panel.locator('.fx-keys').evaluate('(e)=>e.open=true');panel.locator('.fx-key-param').select_option('density');panel.locator('.fx-key-time').fill('.5');panel.locator('.fx-key-value').fill('20');panel.locator('.fx-key-add').click()
        self.assertFalse(panel.locator('.fx-key-param option[value="seed"]').count());self.assertEqual(self.page.evaluate('projectStore.state.lyrics.textFx.automation.density[0][1]'),20)
        panel.locator('.fx-save-name').fill('Tebeşirim');panel.locator('.fx-save').click();self.assertEqual(self.page.evaluate('textPresetBrowser.library.custom[0].settings.automation'),{})
        self.page.evaluate("window.change(p=>{p.visualLayers=[{id:'contour-title',type:'title',name:'Kontur Başlık'}];});visualLayerEditor.select('contour-title');")
        self.show('#creativeTextPresets');panel.locator('.fx-target').select_option('layer');panel.locator('[data-preset="TFX-14"]').click();field=panel.locator('input[type=number][data-fx-parameter="hue2"]');field.fill('45');field.press('Tab')
        self.assertEqual(self.page.evaluate('projectStore.state.visualLayers[0].textFx.parameters.hue2'),45);self.page.evaluate('projectStore.undo()');self.assertEqual(field.input_value(),'320');self.page.evaluate('projectStore.redo()')
        history=self.page.evaluate('projectStore.past.length');self.page.keyboard.press('Control+k');query=self.page.locator('#studioToolQuery');query.fill('Outline Trace');self.assertEqual(self.page.locator('.tool-result').count(),1);query.press('Enter');self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
        for theme in ('dark','light'):
            self.page.emulate_media(color_scheme=theme)
            for width in [320,375,768,1024,1440]:
                self.page.set_viewport_size(dict(width=width,height=900));self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
                self.assertTrue(panel.locator('.fx-preset').first.evaluate('(e)=>{const text=e.querySelector("strong").getBoundingClientRect(),card=e.getBoundingClientRect();return text.bottom<=card.bottom+1&&text.right<=card.right+1;}'))
        self.page.evaluate("window.change(p=>p.visualLayers[0].locked=true)");self.assertTrue(panel.locator('[data-preset="TFX-11"]').is_disabled())

    def test_karaoke_colours_and_rich_run_styles_survive_all_contours(self):
        self.workspace.load_audio()
        result=self.page.evaluate('''()=>{
          const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d'),metrics=JSON.parse(document.getElementById('lyricFontMetrics').textContent),p=copyProject(projectStore.state);
          Object.assign(p.lyrics,{enabled:true,timeBase:'project',template:'karaoke',animation:'none',wordAnimation:'none',fontSize:64,font:'Arial',outline:0,glowIntensity:0,color:'#ffffff',glowColor:'#00ffff',lines:[{id:'cue',text:'İstanbul ışığı',start:0,end:4,words:[{text:'İstanbul',start:0,end:2},{text:'ışığı',start:2,end:4}]}]});
          const rows=[];for(const preset of PROJECT_SCHEMA.creativeTextPresets.slice(10,15)){p.lyrics.textFx=validateCreativeTextFx({preset:preset.id,parameters:preset.id==='TFX-14'?{fill:100}:{}});drawLyricLayer(canvas,p,1.7,metrics);const first=canvas.toDataURL(),data=ctx.getImageData(0,0,640,360).data;let highlight=0,normal=0;for(let i=0;i<data.length;i+=4)if(data[i+3]>8){if(data[i]<30&&data[i+1]>220&&data[i+2]>220)highlight++;if(data[i]>240&&data[i+1]>240&&data[i+2]>240)normal++;}drawLyricLayer(canvas,p,.1,metrics);drawLyricLayer(canvas,p,1.7,metrics);rows.push({id:preset.id,highlight,normal,repeat:canvas.toDataURL()===first});}
          const layer=validateProject({version:PROJECT_SCHEMA.version,tracks:{main:{}},visualLayers:[{id:'title',type:'title',title:{rows:[[{text:'İstanbul ',font:'Georgia',italic:true,color:'#f0b070',size:64},{text:'é',font:'Arial',bold:true,color:'#b5b9ff',size:44}]],enter:'none',exit:'none'}}]}).visualLayers[0],renderer=new TitleRenderer(),before=JSON.stringify(layer.title),styles=[];
          for(const preset of PROJECT_SCHEMA.creativeTextPresets.slice(10,15)){layer.textFx=validateCreativeTextFx({preset:preset.id});const first=renderer.source(layer,640,360,.37,4).toDataURL();renderer.source(layer,640,360,3.5,4);styles.push({repeat:renderer.source(layer,640,360,.37,4).toDataURL()===first,fonts:[...new Set(renderer.entries.get(layer.id).textParts.map(part=>part.run.font))]});}
          return {rows,styles,unchanged:JSON.stringify(layer.title)===before};
        }''')
        for row in result['rows']:
            with self.subTest(preset=row['id']):self.assertGreater(row['highlight'],0,row);self.assertGreater(row['normal'],0,row);self.assertTrue(row['repeat'])
        self.assertTrue(result['unchanged']);self.assertTrue(all(row['repeat'] and len(row['fonts'])==2 for row in result['styles']))
