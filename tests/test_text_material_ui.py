"""Text materials sample actual scene pixels and keep bounded, seekable glyph surfaces."""
import base64
import json
from pathlib import Path
import unittest
import test_controller_ui as controller_ui


class TextMaterialUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):controller_ui.ControllerUI.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls):controller_ui.ControllerUI.tearDownClass.__func__(cls)
    setUp=controller_ui.ControllerUI.setUp
    tearDown=controller_ui.ControllerUI.tearDown
    show=controller_ui.ControllerUI.show

    def test_distinct_materials_seek_repeat_macros_and_contact_sheet(self):
        result=self.page.evaluate('''()=>{
          const canvas=document.createElement('canvas'),back=document.createElement('canvas');canvas.width=back.width=420;canvas.height=back.height=180;const ctx=canvas.getContext('2d'),bg=back.getContext('2d');
          bg.fillStyle='#244d76';bg.fillRect(0,0,420,180);for(let x=0;x<420;x+=17){bg.fillStyle=x%2?'#d4a555':'#46846e';bg.fillRect(x,0,7,180);}
          const render=(settings,time)=>{ctx.clearRect(0,0,420,180);ctx.font='bold 56px Arial';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillStyle='#fff';paintTextFx(ctx,'İstanbul O',210,55,{settings,time,local:time,duration:4,size:56,lineHeight:70,backdrop:{source:back}},(target,text,x,y)=>target.fillText(text,x,y));return canvas.toDataURL();};
          const rows=[],images=[],repeat=[];for(const preset of PROJECT_SCHEMA.creativeTextPresets.slice(15,20)){
            const s=validateCreativeTextFx({preset:preset.id}),times=[.2,.7,1.5],base=times.map(t=>render(s,t));images.push(base[0]);render(s,3.9);repeat.push(render(s,.2)===base[0]);
            const controls=[];for(const key of preset.parameterOrder.filter(key=>!preset.parameters[key].advanced)){const spec=preset.parameters[key],next=copyProject(s);next.parameters[key]=s.parameters[key]===spec.max?spec.min:spec.max;controls.push({key,changed:times.some((t,i)=>render(next,t)!==base[i])});}rows.push({id:preset.id,controls});
          }
          const sheet=document.createElement('canvas');sheet.width=1600;sheet.height=240;const target=sheet.getContext('2d');target.fillStyle='#121820';target.fillRect(0,0,1600,240);
          PROJECT_SCHEMA.creativeTextPresets.slice(15,20).forEach((preset,i)=>{render(validateCreativeTextFx({preset:preset.id}),.7);target.fillStyle='#b9c0cd';target.font='14px Arial';target.fillText(preset.id+' · '+preset.name,i*320+16,26);target.drawImage(back,i*320+8,45,304,170);target.drawImage(canvas,i*320+8,45,304,170);});
          return {distinct:new Set(images).size,repeat,rows,sheet:sheet.toDataURL().split(',')[1]};
        }''')
        output=Path(__file__).resolve().parents[1]/'.local'/'text-material-contact-sheet.png';output.write_bytes(base64.b64decode(result['sheet']))
        self.assertEqual(result['distinct'],5);self.assertTrue(all(result['repeat']))
        for row in result['rows']:
            for control in row['controls']:
                with self.subTest(preset=row['id'],control=control['key']):self.assertTrue(control['changed'],row)

    def test_glass_samples_lower_scene_transforms_title_perspective_and_mask(self):
        result=self.page.evaluate('''()=>{
          const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d'),renderer=new VisualLayerRenderer();
          const base=validateProject({version:PROJECT_SCHEMA.version,tracks:{main:{end:4}},visualLayers:[]});
          const fx={preset:'TFX-18',parameters:{refraction:0,edge:0,tint:0,blur:0,opacity:100}};
          const sample=(kind,color,rotation=0,mask=false,perspective=false)=>{ctx.clearRect(0,0,640,360);ctx.fillStyle=color;ctx.fillRect(0,0,640,360);
            base.visualLayers=validateProject({...base,visualLayers:[{id:'glass',type:kind,text:'OOOO',fontSize:140,width:80,rotation,textFx:fx,mask:{enabled:mask},perspective:{enabled:perspective,points:[[4,3],[96,0],[85,97],[5,90]]},title:{rows:[[{text:'OOOO',size:140}]],background:false,accentWidth:0,enter:'none',exit:'none'}}]}).visualLayers;
            renderer.draw(ctx,base,1);const data=ctx.getImageData(0,0,640,360).data,bg=color==='#f02020'?[240,32,32]:[32,32,240];let error=0,count=0;for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++){error+=Math.abs(data[i+c]-bg[c]);count++;}return error/count;};
          const rows=[];for(const kind of ['text','title'])for(const color of ['#f02020','#2020f0'])for(const rotate of [0,23])rows.push({kind,color,rotate,error:sample(kind,color,rotate,true,kind==='title')});
          ctx.clearRect(0,0,640,360);ctx.fillStyle='#ff0000';ctx.fillRect(0,0,640,360);ctx.globalAlpha=.3;const snap=textMaterialCompositeBackdrop(canvas,{source:canvas});ctx.globalAlpha=1;
          return {rows,snapshot:snap.source.getContext('2d').getImageData(0,0,1,1).data[3]};
        }''')
        for row in result['rows']:
            with self.subTest(row=row):self.assertLess(row['error'],.25,row)
        self.assertEqual(result['snapshot'],255)

    def test_refraction_uses_image_detail_and_glass_has_no_fake_opaque_background(self):
        result=self.page.evaluate('''()=>{
          const canvas=document.createElement('canvas'),back=document.createElement('canvas');canvas.width=back.width=400;canvas.height=back.height=180;const ctx=canvas.getContext('2d'),bg=back.getContext('2d');
          const draw=(source,refraction)=>{ctx.clearRect(0,0,400,180);ctx.font='bold 72px Arial';ctx.textBaseline='top';ctx.fillStyle='white';paintTextFx(ctx,'OOOO',50,50,{settings:validateCreativeTextFx({preset:'TFX-18',parameters:{refraction,edge:0,tint:0,blur:0,opacity:100}}),time:1,local:1,duration:4,size:72,backdrop:source?{source}:null},(c,t,x,y)=>c.fillText(t,x,y));return ctx.getImageData(0,0,400,180).data;};
          const empty=draw(null,15);let emptyAlpha=0;for(let i=3;i<empty.length;i+=4)emptyAlpha+=empty[i];
          bg.fillStyle='#204b96';bg.fillRect(0,0,400,180);for(let x=0;x<400;x+=8){bg.fillStyle=x%16?'#28c864':'#dc5032';bg.fillRect(x,0,4,180);}
          const flat=draw(back,0),refracted=draw(back,25);let changed=0;for(let i=0;i<flat.length;i+=4)if(flat[i+3]>240&&Math.abs(flat[i]-refracted[i])+Math.abs(flat[i+1]-refracted[i+1])+Math.abs(flat[i+2]-refracted[i+2])>30)changed++;
          bg.clearRect(0,0,400,180);const transparent=draw(back,25);let transparentAlpha=0;for(let i=3;i<transparent.length;i+=4)transparentAlpha+=transparent[i];return {emptyAlpha,transparentAlpha,changed};
        }''')
        self.assertEqual(result['emptyAlpha'],0);self.assertEqual(result['transparentAlpha'],0);self.assertGreater(result['changed'],200)

    def test_glyph_holes_unicode_cache_budget_fonts_amount_and_performance(self):
        result=self.page.evaluate('''async()=>{
          const painter=new TextMaterialPainter(),canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');ctx.font='72px Arial';ctx.textBaseline='alphabetic';
          const g=painter.glyph(ctx,'O',72),center=g.alpha[Math.floor(g.height/2)*g.width+Math.floor(g.width/2)];
          const fonts=[];for(const font of ['Arial','Poppins','Caveat','Playfair Display','Syne']){await document.fonts.load(`700 56px "${font}"`);ctx.font=`700 56px "${font}"`;fonts.push(painter.glyph(ctx,'İ ğ ş é 👨‍👩‍👧‍👦',56).alpha.some(v=>v>128));}
          for(let i=0;i<40;i++)painter.glyph(ctx,'Metin '+i,56);ctx.font='800px Arial';const huge=painter.glyph(ctx,'W'.repeat(200),800),entries=painter.cache.size,pixels=painter.cachePixels;document.fonts.dispatchEvent(new Event('loadingdone'));
          const render=s=>{ctx.clearRect(0,0,640,360);ctx.font='72px Arial';ctx.fillStyle='white';paintTextFx(ctx,'İstanbul',40,160,{settings:s,time:.7,local:.7,duration:4,size:72},(c,t,x,y)=>c.fillText(t,x,y));return canvas.toDataURL();};
          const neutral=render(validateCreativeTextFx({})),bypass=render(validateCreativeTextFx({preset:'TFX-20',amount:0})),durations=[];for(let i=0;i<8;i++){const start=performance.now();render(validateCreativeTextFx({preset:'TFX-20'}));durations.push(performance.now()-start);}
          return {center,fonts,entries,pixels,hugePixels:huge.alpha.length,hugeWidth:huge.width,after:painter.cache.size,bypass:neutral===bypass,median:durations.sort((a,b)=>a-b)[4]};
        }''')
        self.assertEqual(result['center'],0);self.assertTrue(all(result['fonts']));self.assertLessEqual(result['entries'],16);self.assertLessEqual(result['pixels'],1048576);self.assertLessEqual(result['hugePixels'],131072+1024);self.assertLessEqual(result['hugeWidth'],1024);self.assertEqual(result['after'],0);self.assertTrue(result['bypass'])
        # A broad guard against accidental multi-second full-scene CPU kernels;
        # the measured value is recorded separately, not a claim of phone FPS.
        self.assertLess(result['median'],500,result)
        (Path(__file__).resolve().parents[1]/'.local'/'text-material-profile.json').write_text(json.dumps(result,indent=2),encoding='utf-8')

    def test_sampler_maps_animated_local_coordinates_through_title_homography(self):
        result=self.page.evaluate('''()=>{
          const source=document.createElement('canvas');source.width=640;source.height=360;const ctx=source.getContext('2d'),frame=ctx.createImageData(640,360);
          for(let y=0;y<360;y++)for(let x=0;x<640;x++){const i=(y*640+x)*4;frame.data[i]=x/3;frame.data[i+1]=y/2;frame.data[i+2]=80;frame.data[i+3]=255;}ctx.putImageData(frame,0,0);
          const settings={enabled:true,keys:[],points:[[5,3],[95,0],[85,97],[3,90]]},projection=textMaterialForwardProjection(settings,1),outer=new DOMMatrix().translate(160,70).rotate(19).scale(1.3),local=new DOMMatrix().translate(12,8).scale(.85);
          const sampler=new TextMaterialSampler(),sample=sampler.prepare({source,transform:outer,projection,width:200,height:100},local,{left:0,top:0,width:200,height:100});
          const corners=[[0,0],[1,0],[1,1],[0,1]].map(([x,y],i)=>{const point=perspectivePosition(projection,x,y);return Math.hypot(point[0]*100-settings.points[i][0],point[1]*100-settings.points[i][1]);});
          const errors=[[20,20],[90,45],[160,70]].map(([x,y])=>{const q=local.transformPoint({x,y}),uv=perspectivePosition(projection,q.x/200,q.y/100),world=outer.transformPoint({x:uv[0]*200,y:uv[1]*100}),rgba=sample(x,y);return Math.max(Math.abs(rgba[0]-world.x/3),Math.abs(rgba[1]-world.y/2),Math.abs(rgba[3]-1));});
          return {corners,errors};
        }''')
        self.assertTrue(all(error<1e-6 for error in result['corners']),result)
        self.assertTrue(all(error<1.5 for error in result['errors']),result)

    def test_material_authoring_curves_cancel_locked_target_search_and_responsive(self):
        self.workspace.load_audio();self.show('#creativeTextPresets');panel=self.page.locator('#creativeTextPresets');panel.locator('.fx-search').fill('malzeme')
        self.assertEqual(panel.locator('.fx-preset').count(),5);panel.locator('[data-preset="TFX-18"]').click();history=self.page.evaluate('projectStore.past.length')
        slider=panel.locator('input[type=range][data-fx-parameter="refraction"]');slider.evaluate("e=>{e.value=25;e.dispatchEvent(new Event('input',{bubbles:true}));}")
        self.assertEqual(self.page.evaluate('lyricsPreview.textFxDraft.lyrics.textFx.parameters.refraction'),25);slider.dispatch_event('pointercancel');self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
        field=panel.locator('input[type=number][data-fx-parameter="refraction"]');field.fill('25');field.press('Tab');self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
        panel.locator('.fx-keys').evaluate('(e)=>e.open=true');panel.locator('.fx-key-param').select_option('refraction');panel.locator('.fx-key-time').fill('.5');panel.locator('.fx-key-value').fill('5');panel.locator('.fx-key-add').click()
        self.assertEqual(self.page.evaluate('projectStore.state.lyrics.textFx.automation.refraction[0][1]'),5)
        self.page.evaluate("window.change(p=>{p.visualLayers=[{id:'glass-title',type:'title'}];});visualLayerEditor.select('glass-title');")
        self.show('#creativeTextPresets');panel.locator('.fx-target').select_option('layer');panel.locator('[data-preset="TFX-19"]').click();self.assertEqual(self.page.evaluate('projectStore.state.visualLayers[0].textFx.preset'),'TFX-19')
        history=self.page.evaluate('projectStore.past.length');self.page.keyboard.press('Control+k');query=self.page.locator('#studioToolQuery');query.fill('Chrome Shine');self.assertEqual(self.page.locator('.tool-result').count(),1);query.press('Enter');self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
        for theme in ('dark','light'):
            self.page.emulate_media(color_scheme=theme)
            for width in [320,375,768,1024,1440]:
                self.page.set_viewport_size(dict(width=width,height=900));self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
        self.page.evaluate("window.change(p=>p.visualLayers[0].locked=true)");self.assertTrue(panel.locator('[data-preset="TFX-16"]').is_disabled())
