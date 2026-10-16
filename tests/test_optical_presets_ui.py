"""Optical GPU/fallback and creative authoring on production WSGI/CSP."""
import unittest
import test_controller_ui as controller_ui
from browser_helpers import wait_for_browser


class OpticalPresetsUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):controller_ui.ControllerUI.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls):controller_ui.ControllerUI.tearDownClass.__func__(cls)
    setUp=controller_ui.ControllerUI.setUp
    tearDown=controller_ui.ControllerUI.tearDown
    show=controller_ui.ControllerUI.show

    def test_optical_presets_clip_scene_layer_advanced_curves_and_history(self):
        with self.workspace.open_visual_layers() as visual_panel:
            history=self.page.evaluate('projectStore.past.length')
            self.page.keyboard.press('Control+k');query=self.page.locator('#studioToolQuery');query.fill('Halation Red')
            self.assertEqual(self.page.locator('.tool-result').count(),1)
            query.press('Enter');self.assertFalse(self.page.locator('#studioToolDialog').is_visible())
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id)');self.show('#creativeVideoPresets')
            panel=self.page.locator('#creativeVideoPresets');panel.locator('.fx-search').fill('odak')
            self.assertGreater(panel.locator('.fx-preset').count(),0);panel.locator('.fx-search').fill('')
            self.assertEqual(panel.locator('.fx-preset').count(),50)
            panel.locator('[data-preset="VFX-14"]').click();history=self.page.evaluate('projectStore.past.length')
            panel.locator('.fx-advanced').evaluate('(e)=>e.open=true')
            number=panel.locator('input[type=number][data-fx-parameter="centerAY"]');number.fill('35');number.press('Tab')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.parameters.centerAY'),35)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            panel.locator('.fx-keys').evaluate('(e)=>e.open=true');panel.locator('.fx-key-param').select_option('centerAY')
            panel.locator('.fx-key-time').fill('.5');panel.locator('.fx-key-value').fill('65');panel.locator('.fx-key-add').click()
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.automation.centerAY[0][1]'),65)
            panel.locator('.fx-target').select_option('scene');panel.locator('[data-preset="VFX-20"]').click()
            self.assertEqual(self.page.evaluate('projectStore.state.video.creativeFx.preset'),'VFX-20')
            visual_panel.locator('.visual-files').set_input_files(str(self.workspace.visual_image))
            wait_for_browser(self.page,"projectStore.state.visualLayers.some(layer=>layer.type==='image')&&videoPreview.visuals.isReady()")
            self.show('#creativeVideoPresets');panel.locator('.fx-target').select_option('layer');panel.locator('[data-preset="VFX-16"]').click()
            panel.locator('select[data-fx-parameter="fill"]').select_option('2')
            self.assertEqual(self.page.evaluate('projectStore.state.visualLayers.at(-1).creativeFx.parameters.fill'),2)
            self.assertFalse(panel.locator('.fx-key-param option[value="fill"]').count())
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.preset'),'VFX-14')
            self.page.evaluate('projectStore.undo()');self.assertEqual(self.page.evaluate('projectStore.state.visualLayers.at(-1).creativeFx.parameters.fill'),1)
            self.page.evaluate('projectStore.redo()');self.assertEqual(self.page.evaluate('projectStore.state.visualLayers.at(-1).creativeFx.parameters.fill'),2)

    def test_transparent_optics_gpu_cpu_compositing_and_actual_shader(self):
        result=self.page.evaluate('''()=>{
          const source=document.createElement('canvas');source.width=160;source.height=120;const ctx=source.getContext('2d');ctx.fillStyle='rgba(255,120,50,.65)';ctx.fillRect(30,20,100,80);ctx.fillStyle='rgba(255,255,255,.9)';ctx.beginPath();ctx.arc(80,60,8,0,Math.PI*2);ctx.fill();
          const gpu=new CreativeVideoRenderer(),cpu=new CreativeVideoRenderer({backend:'cpu'}),rows=[];
          const composite=image=>{const canvas=document.createElement('canvas');canvas.width=160;canvas.height=120;const c=canvas.getContext('2d');c.fillStyle='#333';c.fillRect(0,0,160,120);c.drawImage(image,0,0);return c.getImageData(0,0,160,120).data;};
          for(const preset of PROJECT_SCHEMA.creativeVideoPresets.slice(10,20)){const settings=validateCreativeVideoFx({preset:preset.id});gpu.beginFrame();cpu.beginFrame();const ga=composite(gpu.source(source,settings,.37)),ca=composite(cpu.source(source,settings,.37));let max=0,sum=0;for(let i=0;i<ga.length;i++){const delta=Math.abs(ga[i]-ca[i]);max=Math.max(max,delta);sum+=delta;}rows.push({id:preset.id,max,mean:sum/ga.length});}
          return {gpu:!!gpu.optics?.gl,rows};
        }''')
        self.assertTrue(result['gpu'])
        for row in result['rows']:
            with self.subTest(preset=row['id']):self.assertLessEqual(row['max'],5);self.assertLessEqual(row['mean'],.8)

    def test_all_optics_are_distinct_and_macro_controls_change_the_image(self):
        result=self.page.evaluate('''()=>{
          const source=document.createElement('canvas');source.width=320;source.height=180;const ctx=source.getContext('2d');ctx.fillStyle='#101827';ctx.fillRect(0,0,320,180);for(let y=0;y<180;y+=12)for(let x=0;x<320;x+=12){ctx.fillStyle=(x+y)%24?'#fff':'#7e9dc7';ctx.fillRect(x,y,6,6);}const renderer=new CreativeVideoRenderer(),images=[],changed=[];
          for(const preset of PROJECT_SCHEMA.creativeVideoPresets.slice(10,20)){const settings=validateCreativeVideoFx({preset:preset.id});renderer.beginFrame();const initial=renderer.source(source,settings,.37).toDataURL();images.push(initial);const controls=[];
            for(const key of preset.parameterOrder.filter(key=>!preset.parameters[key].advanced).slice(0,4)){const spec=preset.parameters[key],next=copyProject(settings);next.parameters[key]=settings.parameters[key]===spec.max?spec.min:spec.max;renderer.beginFrame();controls.push(renderer.source(source,next,.37).toDataURL()!==initial);}changed.push({id:preset.id,controls});}
          return {distinct:new Set(images).size,changed};
        }''')
        self.assertEqual(result['distinct'],10)
        for row in result['changed']:
            with self.subTest(preset=row['id']):self.assertGreaterEqual(sum(row['controls']),3)

    def test_streak_context_loss_fallback_and_restore_rebuilds_offscreen_targets(self):
        result=self.page.evaluate('''async()=>{
          const source=document.createElement('canvas');source.width=128;source.height=72;const ctx=source.getContext('2d');ctx.fillStyle='#172033';ctx.fillRect(0,0,128,72);ctx.fillStyle='#fff';ctx.fillRect(58,25,12,22);
          const renderer=new CreativeVideoRenderer(),settings=validateCreativeVideoFx({preset:'VFX-11'}),pixels=()=>{renderer.beginFrame();return renderer.source(source,settings,.37).getContext('2d').getImageData(0,0,source.width,source.height).data;};
          const first=pixels(),optics=renderer.optics,targets=optics.streakTargets,extension=optics.gl.getExtension('WEBGL_lose_context');if(!extension)return {supported:false};
          // Like window.videoPreview, keep the owner rooted while native events
          // are pending; an isolated unresolved Promise does not root a canvas.
          window.__opticalRecoveryRenderer=renderer;
          const lost=new Promise(resolve=>optics.surface.addEventListener('webglcontextlost',resolve,{once:true}));extension.loseContext();await lost;const fallback=!optics.gl,cpu=pixels();
          let max=0,sum=0;for(let i=0;i<first.length;i++){const delta=Math.abs(first[i]-cpu[i]);max=Math.max(max,delta);sum+=delta;}
          const restored=new Promise(resolve=>optics.surface.addEventListener('webglcontextrestored',resolve,{once:true}));
          await new Promise(resolve=>setTimeout(resolve,0));extension.restoreContext();
          await Promise.race([restored,new Promise((_,reject)=>setTimeout(()=>reject(new Error('GPU restore event timed out')),10000))]);const again=pixels();
          const rebuilt=targets!==optics.streakTargets,error=optics.gl.getError(),repeat=first.every((v,i)=>v===again[i]);
          optics.gl.checkFramebufferStatus=()=>optics.gl.FRAMEBUFFER_UNSUPPORTED;source.height=74;ctx.fillStyle='#172033';ctx.fillRect(0,0,128,74);ctx.fillStyle='#fff';ctx.fillRect(58,25,12,22);
          const degraded=pixels(),reference=new CreativeVideoRenderer({backend:'cpu'}).source(source,settings,.37).getContext('2d').getImageData(0,0,128,74).data;
          const failureFallback=!optics.gl&&degraded.length===reference.length&&degraded.every((v,i)=>v===reference[i]);
          delete window.__opticalRecoveryRenderer;return {supported:true,fallback,max,mean:sum/first.length,rebuilt,repeat,error,failureFallback};
        }''')
        self.assertTrue(result['supported']);self.assertTrue(result['fallback']);self.assertTrue(result['rebuilt']);self.assertTrue(result['repeat'])
        self.assertLessEqual(result['max'],4);self.assertLessEqual(result['mean'],.8);self.assertEqual(result['error'],0)
        self.assertTrue(result['failureFallback'])
