"""Genuine geometry/digital FX and GPU/fallback compositing under production CSP."""
import base64
import json
from pathlib import Path
import unittest
import test_controller_ui as controller_ui
from browser_helpers import wait_for_browser


class VideoGeometryUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):controller_ui.ControllerUI.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls):controller_ui.ControllerUI.tearDownClass.__func__(cls)
    setUp=controller_ui.ControllerUI.setUp
    tearDown=controller_ui.ControllerUI.tearDown
    show=controller_ui.ControllerUI.show

    def test_gpu_cpu_rgba_parity_and_real_shader_for_all_ten(self):
        result=self.page.evaluate('''()=>{
          const source=document.createElement('canvas');source.width=128;source.height=96;const ctx=source.getContext('2d');const gradient=ctx.createLinearGradient(10,10,100,80);gradient.addColorStop(0,'rgba(240,30,80,.3)');gradient.addColorStop(1,'rgba(30,170,240,.8)');ctx.fillStyle=gradient;ctx.fillRect(10,10,105,74);ctx.fillStyle='rgba(240,240,240,.8)';ctx.fillRect(40,24,12,50);
          const gpu=new CreativeVideoRenderer(),cpu=new CreativeVideoRenderer({backend:'cpu'}),rows=[];
          const pixels=image=>{const canvas=document.createElement('canvas');canvas.width=128;canvas.height=96;const target=canvas.getContext('2d');target.fillStyle='#333';target.fillRect(0,0,128,96);target.drawImage(image,0,0);return target.getImageData(0,0,128,96).data;};
          for(const preset of PROJECT_SCHEMA.creativeVideoPresets.slice(20,30)){const s=validateCreativeVideoFx({preset:preset.id}),time=geometryVideoPreviewTime(s);gpu.beginFrame();cpu.beginFrame();const g=pixels(gpu.source(source,s,time)),c=pixels(cpu.source(source,s,time)),differences=[];let sum=0,max=0;for(let i=0;i<g.length;i++){const d=Math.abs(g[i]-c[i]);max=Math.max(max,d);sum+=d;differences.push(d);}differences.sort((a,b)=>a-b);rows.push({id:preset.id,gpu:!!gpu.geometry?.gl,cpuSort:preset.id==='VFX-28',max,mean:sum/g.length,p99:differences[Math.floor(differences.length*.99)]});}
          return rows;
        }''')
        (Path(__file__).resolve().parents[1]/'.local'/'video-geometry-parity.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        for row in result:
            with self.subTest(preset=row['id']):
                self.assertTrue(row['gpu'] or row['cpuSort'],row);self.assertLessEqual(row['mean'],.8,row);self.assertLessEqual(row['p99'],5,row)
                if row['cpuSort']:self.assertEqual(row['max'],0)

    def test_distinct_images_all_macros_seek_repeat_and_contact_sheet(self):
        result=self.page.evaluate('''()=>{
          const source=document.createElement('canvas');source.width=320;source.height=180;const ctx=source.getContext('2d'),image=ctx.createImageData(320,180);for(let y=0;y<180;y++)for(let x=0;x<320;x++){const i=(y*320+x)*4;image.data[i]=(x*3+y*7)%256;image.data[i+1]=(x*11+y*2)%256;image.data[i+2]=x%40<20?210:45;image.data[i+3]=255;}ctx.putImageData(image,0,0);
          const r=new CreativeVideoRenderer(),render=(s,t)=>{r.beginFrame();return r.source(source,s,t).toDataURL();},rows=[],images=[],repeat=[];
          for(const preset of PROJECT_SCHEMA.creativeVideoPresets.slice(20,30)){const s=validateCreativeVideoFx({preset:preset.id}),times=[.07,.37,.83,1.4,2.23,geometryVideoPreviewTime(s)],base=times.map(t=>render(s,t));images.push(base.at(-1));render(s,4.1);repeat.push(render(s,times.at(-1))===base.at(-1));const controls=[];
            for(const key of preset.parameterOrder.filter(key=>!preset.parameters[key].advanced)){const spec=preset.parameters[key];controls.push({key,changed:[spec.min,spec.max].some(value=>{const next=copyProject(s);next.parameters[key]=value;return times.some((t,i)=>render(next,t)!==base[i]);})});}rows.push({id:preset.id,controls});}
          const sheet=document.createElement('canvas');sheet.width=1600;sheet.height=450;const target=sheet.getContext('2d');target.fillStyle='#121820';target.fillRect(0,0,1600,450);
          PROJECT_SCHEMA.creativeVideoPresets.slice(20,30).forEach((preset,i)=>{const s=validateCreativeVideoFx({preset:preset.id}),x=i%5*320,y=Math.floor(i/5)*225;target.font='14px Arial';target.fillStyle='#b9c0cd';target.fillText(preset.id+' · '+preset.name,x+12,y+24);r.beginFrame();target.drawImage(r.source(source,s,geometryVideoPreviewTime(s)),x+8,y+40,304,171);});return {rows,repeat,distinct:new Set(images).size,sheet:sheet.toDataURL().split(',')[1]};
        }''')
        (Path(__file__).resolve().parents[1]/'.local'/'video-geometry-contact-sheet.png').write_bytes(base64.b64decode(result['sheet']))
        self.assertEqual(result['distinct'],10);self.assertTrue(all(result['repeat']))
        for row in result['rows']:
            for control in row['controls']:
                with self.subTest(preset=row['id'],control=control['key']):self.assertTrue(control['changed'],row)

    def test_scene_clip_image_authoring_drafts_curves_history_locks_and_responsive(self):
        with self.workspace.open_visual_layers() as visual:
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id)');self.show('#creativeVideoPresets');panel=self.page.locator('#creativeVideoPresets');self.assertEqual(panel.locator('.fx-preset').count(),50)
            panel.locator('[data-preset="VFX-21"]').click();history=self.page.evaluate('projectStore.past.length')
            slider=panel.locator('input[type=range][data-fx-parameter="refraction"]');slider.evaluate("e=>{e.value=25;e.dispatchEvent(new Event('input',{bubbles:true}));}");self.assertEqual(self.page.evaluate('videoPreview.creativeFxDraft.videoClips[0].creativeFx.parameters.refraction'),25)
            slider.dispatch_event('pointercancel');self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            number=panel.locator('input[type=number][data-fx-parameter="refraction"]');number.fill('25');number.press('Tab');self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            panel.locator('.fx-keys').evaluate('(e)=>e.open=true');self.assertFalse(panel.locator('.fx-key-param option[value="facets"]').count());panel.locator('.fx-key-param').select_option('refraction');panel.locator('.fx-key-time').fill('.5');panel.locator('.fx-key-value').fill('10');panel.locator('.fx-key-add').click();self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.automation.refraction[0][1]'),10)
            panel.locator('.fx-save-name').fill('Prizmam');panel.locator('.fx-save').click();self.assertEqual(self.page.evaluate('videoPresetBrowser.library.custom[0].settings.automation'),{})
            panel.locator('.fx-target').select_option('scene');panel.locator('[data-preset="VFX-29"]').click();panel.locator('select[data-fx-parameter="palette"]').select_option('3');self.assertEqual(self.page.evaluate('projectStore.state.video.creativeFx.parameters.palette'),3)
            self.page.evaluate('projectStore.undo()');self.assertEqual(panel.locator('select[data-fx-parameter="palette"]').input_value(),'0');self.page.evaluate('projectStore.redo()')
            visual.locator('.visual-files').set_input_files(str(self.workspace.visual_image));wait_for_browser(self.page,"projectStore.state.visualLayers.some(l=>l.type==='image')&&videoPreview.visuals.isReady()")
            self.show('#creativeVideoPresets');panel.locator('.fx-target').select_option('layer');panel.locator('[data-preset="VFX-23"]').click();self.assertEqual(self.page.evaluate('projectStore.state.visualLayers.at(-1).creativeFx.preset'),'VFX-23')
            history=self.page.evaluate('projectStore.past.length');self.page.keyboard.press('Control+k');query=self.page.locator('#studioToolQuery');query.fill('Pixel Sort Ribbons');self.assertEqual(self.page.locator('.tool-result').count(),1);query.press('Enter');self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            for theme in ('dark','light'):
                self.page.emulate_media(color_scheme=theme)
                for width in (320,375,768,1024,1440):
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
            self.page.evaluate('window.change(p=>p.visualLayers.at(-1).locked=true)');self.assertTrue(panel.locator('[data-preset="VFX-25"]').is_disabled())

    def test_pixel_sort_partial_amount_bypass_and_720h_cpu_budget(self):
        result=self.page.evaluate('''()=>{
          const source=document.createElement('canvas');source.width=1280;source.height=720;const ctx=source.getContext('2d'),frame=ctx.createImageData(1280,720);for(let i=0;i<frame.data.length;i+=4){const v=(i*37)%256;frame.data[i]=v;frame.data[i+1]=255-v;frame.data[i+2]=100;frame.data[i+3]=200;}ctx.putImageData(frame,0,0);
          const r=new CreativeVideoRenderer(),s=validateCreativeVideoFx({preset:'VFX-28',parameters:{threshold:0,length:512}}),times=[];for(let i=0;i<5;i++){r.beginFrame();const start=performance.now();r.source(source,s,.37);times.push(performance.now()-start);}r.beginFrame();const full=r.source(source,s,.37).getContext('2d').getImageData(0,0,1280,720).data.slice();r.beginFrame();const half=r.source(source,{...s,amount:50},.37).getContext('2d').getImageData(0,0,1280,720).data,neutral=ctx.getImageData(0,0,1280,720).data;let max=0;for(let i=0;i<half.length;i++)max=Math.max(max,Math.abs(half[i]-(full[i]+neutral[i])/2));return {max,bypass:r.source(source,{...s,amount:0},.37)===source,median:times.sort((a,b)=>a-b)[2]};
        }''')
        (Path(__file__).resolve().parents[1]/'.local'/'video-geometry-profile.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        self.assertTrue(result['bypass']);self.assertLessEqual(result['max'],3);self.assertLess(result['median'],1000,result)

    def test_actual_context_loss_restore_and_forced_upload_failure_fall_back(self):
        result=self.page.evaluate('''async()=>{
          const source=document.createElement('canvas');source.width=128;source.height=72;const c=source.getContext('2d');c.fillStyle='#153658';c.fillRect(0,0,128,72);c.fillStyle='#eab475';c.fillRect(30,10,50,50);
          const r=new CreativeVideoRenderer(),s=validateCreativeVideoFx({preset:'VFX-25'}),read=()=>{r.beginFrame();return r.source(source,s,.37).getContext('2d').getImageData(0,0,128,72).data.slice();},first=read(),engine=r.geometry,extension=engine.gl?.getExtension('WEBGL_lose_context');if(!extension)return {supported:false};window.__geometryRecovery=r;
          const lost=new Promise(resolve=>engine.surface.addEventListener('webglcontextlost',resolve,{once:true}));extension.loseContext();await lost;const fallback=!engine.gl,cpu=read();let sum=0;for(let i=0;i<first.length;i++)sum+=Math.abs(first[i]-cpu[i]);
          const restored=new Promise(resolve=>engine.surface.addEventListener('webglcontextrestored',resolve,{once:true}));await new Promise(resolve=>setTimeout(resolve,0));extension.restoreContext();await Promise.race([restored,new Promise((_,reject)=>setTimeout(()=>reject(new Error('GPU restore timed out')),10000))]);const again=read(),repeat=again.every((v,i)=>v===first[i]);
          engine.gl.texImage2D=()=>{throw new Error('forced upload failure')};const degraded=read(),reference=new CreativeVideoRenderer({backend:'cpu'}).source(source,s,.37).getContext('2d').getImageData(0,0,128,72).data;delete window.__geometryRecovery;return {supported:true,fallback,mean:sum/first.length,repeat,failureFallback:!engine.gl&&degraded.every((v,i)=>v===reference[i])};
        }''')
        self.assertTrue(result['supported']);self.assertTrue(result['fallback']);self.assertLessEqual(result['mean'],.8);self.assertTrue(result['repeat']);self.assertTrue(result['failureFallback'])
