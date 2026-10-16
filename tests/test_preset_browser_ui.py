"""Preset authoring and render parity against the production WSGI/CSP boundary."""
import unittest
import test_controller_ui as controller_ui


class PresetBrowserUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        controller_ui.ControllerUI.setUpClass.__func__(cls)

    @classmethod
    def tearDownClass(cls):
        controller_ui.ControllerUI.tearDownClass.__func__(cls)

    setUp=controller_ui.ControllerUI.setUp
    tearDown=controller_ui.ControllerUI.tearDown
    show=controller_ui.ControllerUI.show

    def test_catalog_target_history_curves_comparison_and_custom_save(self):
        with self.workspace.open_visual_layers():
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id)')
            self.show('#creativeVideoPresets')
            panel=self.page.locator('#creativeVideoPresets')
            history=self.page.evaluate('projectStore.past.length')
            panel.locator('[data-preset="VFX-02"]').click()
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.preset'),'VFX-02')
            self.assertEqual(self.page.evaluate('projectStore.state.video.creativeFx.preset'),'')
            panel.locator('.fx-compare').click()
            self.assertTrue(self.page.evaluate('videoPresetBrowser.comparing'))
            self.assertFalse(self.page.evaluate('videoPreview.creativeFxDraft.videoClips[0].creativeFx.enabled'))
            self.assertTrue(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.enabled'))
            panel.locator('.fx-compare').click()
            self.assertFalse(self.page.evaluate('videoPresetBrowser.comparing'))
            self.assertTrue(self.page.evaluate('videoPreview.creativeFxDraft===null'))
            number=panel.locator('input[type=number][data-fx-parameter="width"]')
            number.fill('35');number.press('Tab')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.parameters.width'),35)
            panel.locator('.fx-keys').evaluate('(e)=>e.open=true')
            panel.locator('.fx-key-param').select_option('width')
            panel.locator('.fx-key-time').fill('1.25');panel.locator('.fx-key-value').fill('45');panel.locator('.fx-key-add').click()
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.automation.width[0][0]'),1.25)
            panel.locator('[data-preset="VFX-03"]').click()
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.preset'),'VFX-02')
            self.assertIn('eğrilerini temizleme',panel.locator('.fx-status').inner_text())
            panel.locator('.fx-clear-curves input').check();panel.locator('[data-preset="VFX-03"]').click()
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.automation'),{})
            contrast=panel.locator('input[type=number][data-fx-parameter="contrast"]');contrast.fill('1.75');contrast.press('Tab')
            panel.locator('.fx-save-name').fill('Kendi sinemam');panel.locator('.fx-save').click()
            panel.locator('.fx-filter').select_option('custom')
            self.assertEqual(panel.locator('.fx-preset').count(),1)
            self.assertTrue(self.page.evaluate("videoPresetBrowser.thumbnails.get(videoPresetBrowser.library.custom[0].id).toDataURL()!==videoPresetBrowser.thumbnails.get('VFX-03').toDataURL()"))
            panel.locator('.fx-favorite').click();panel.locator('.fx-filter').select_option('favorites')
            self.assertEqual(panel.locator('.fx-preset').count(),1)
            panel.locator('.fx-favorite').click();self.assertEqual(panel.locator('.fx-preset').count(),0)
            self.assertTrue(panel.locator('.fx-filter').evaluate('(e)=>e===document.activeElement'))
            saved=self.page.evaluate('JSON.stringify(projectStore.snapshot())')
            self.page.evaluate('s=>projectStore.replace(JSON.parse(s))',saved)
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.preset'),'VFX-03')
            self.page.reload(wait_until='networkidle')
            self.assertEqual(self.page.evaluate('videoPresetBrowser.library.custom[0].name'),'Kendi sinemam')
            self.assertEqual(self.page.evaluate('videoPresetBrowser.library.custom[0].settings.parameters.contrast'),1.75)
            self.show('#creativeVideoPresets');panel.locator('.fx-filter').select_option('custom');panel.locator('.fx-remove-custom').click()
            self.assertEqual(self.page.evaluate('videoPresetBrowser.library.custom.length'),0)
            self.assertEqual(self.page.evaluate('JSON.parse(localStorage.getItem(VIDEO_PRESET_LIBRARY.key)).custom.length'),0)

    def test_slider_draft_cancel_single_commit_and_responsive_catalog(self):
        with self.workspace.open_visual_layers():
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id)')
            self.show('#creativeVideoPresets')
            panel=self.page.locator('#creativeVideoPresets');panel.locator('[data-preset="VFX-01"]').click()
            history=self.page.evaluate('projectStore.past.length')
            slider=panel.locator('input[type=range][data-fx-parameter="warmth"]')
            slider.evaluate("e=>{e.value='70';e.dispatchEvent(new Event('input',{bubbles:true}));}")
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.parameters.warmth'),45)
            self.assertEqual(self.page.evaluate('videoPreview.creativeFxDraft.videoClips[0].creativeFx.parameters.warmth'),70)
            slider.dispatch_event('pointercancel')
            self.assertTrue(self.page.evaluate('videoPreview.creativeFxDraft===null'))
            self.assertEqual(slider.input_value(),'45')
            slider.evaluate("e=>{e.value='75';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}")
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.parameters.warmth'),75)
            self.page.evaluate('projectStore.undo()')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.parameters.warmth'),45)
            slider.focus();slider.press('ArrowRight')
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.parameters.warmth'),45.1)
            for theme in ['dark','light']:
                self.page.emulate_media(color_scheme=theme)
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900))
                    self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
                    self.assertLessEqual(panel.evaluate('(e)=>e.scrollWidth'),panel.evaluate('(e)=>e.clientWidth')+1)
                    self.assertTrue(panel.evaluate("e=>[...e.querySelectorAll('.fx-preset')].every(b=>[...b.querySelectorAll('strong,span')].every(t=>t.getBoundingClientRect().bottom<=b.getBoundingClientRect().bottom+1))"),'Preset captions must fit inside cards rather than being clipped by shrunken grid rows')
            panel.locator('.fx-search').fill('crt')
            self.assertEqual(panel.locator('.fx-preset').count(),1)
            self.assertIn('CRT',panel.locator('.fx-preset').inner_text())

    def test_selection_change_locks_and_layer_target_do_not_edit_neighbor(self):
        with self.workspace.open_visual_layers():
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id)')
            self.show('#creativeVideoPresets');panel=self.page.locator('#creativeVideoPresets')
            panel.locator('[data-preset="VFX-01"]').click()
            slider=panel.locator('input[type=range][data-fx-parameter="warmth"]')
            slider.evaluate("e=>{e.value='80';e.dispatchEvent(new Event('input',{bubbles:true}));}")
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[1].id)')
            self.assertTrue(self.page.evaluate('videoPreview.creativeFxDraft===null'))
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.parameters.warmth'),45)
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[1].creativeFx.preset'),'')
            self.show('#creativeVideoPresets')
            self.page.evaluate('projectStore.update(p=>{p.video.groupLocked=true;})')
            self.assertTrue(panel.locator('[data-preset="VFX-02"]').is_disabled())
            self.page.evaluate("projectStore.update(p=>{p.video.groupLocked=false;});visualLayerEditor.add('video',projectStore.state.background.asset,'Efekt katmanı');")
            self.show('#creativeVideoPresets');panel.locator('.fx-target').select_option('layer')
            panel.locator('[data-preset="VFX-09"]').click()
            self.assertEqual(self.page.evaluate('projectStore.state.visualLayers.at(-1).creativeFx.preset'),'VFX-09')
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[1].creativeFx.preset'),'')
            self.page.evaluate('projectStore.update(p=>{p.visualLayers.at(-1).locked=true;})')
            self.assertTrue(panel.locator('[data-preset="VFX-02"]').is_disabled())

    def test_gpu_cpu_parity_time_addressing_and_export_script_allowlist(self):
        result=self.page.evaluate('''()=>{
          const source=document.createElement('canvas');source.width=96;source.height=720;const ctx=source.getContext('2d');
          const gradient=ctx.createLinearGradient(0,0,96,720);gradient.addColorStop(0,'#123a6c');gradient.addColorStop(.6,'#df2c40');gradient.addColorStop(1,'#ffe4a0');ctx.fillStyle=gradient;ctx.fillRect(0,0,96,720);
          const gpu=new CreativeVideoRenderer(),cpu=new CreativeVideoRenderer({backend:'cpu'}),differences=[];
          for(const preset of PROJECT_SCHEMA.creativeVideoPresets){
            const settings=validateCreativeVideoFx({preset:preset.id});gpu.beginFrame();cpu.beginFrame();
            const ga=gpu.source(source,settings,.37).getContext('2d').getImageData(0,0,96,720).data;
            const ca=cpu.source(source,settings,.37).getContext('2d').getImageData(0,0,96,720).data;
            let max=0,sum=0;for(let i=0;i<ga.length;i++){const d=Math.abs(ga[i]-ca[i]);max=Math.max(max,d);sum+=d;}
            gpu.beginFrame();gpu.source(source,settings,2);gpu.beginFrame();const repeat=gpu.source(source,settings,.37).getContext('2d').getImageData(0,0,96,720).data;
            differences.push({id:preset.id,max,mean:sum/ga.length,repeat:ga.every((v,i)=>v===repeat[i])});
          }return {gpu:!!gpu.gl,opticalGpu:!!gpu.optics?.gl,differences};
        }''')
        self.assertTrue(result['gpu'],'Exercise the shader rather than silently testing CPU twice')
        self.assertTrue(result['opticalGpu'],'Optical presets must exercise their dedicated GPU shader')
        for difference in result['differences']:
            with self.subTest(preset=difference['id']):
                self.assertLessEqual(difference['max'],4)
                self.assertLessEqual(difference['mean'],.8)
                self.assertTrue(difference['repeat'])
        from canvas_render import SCRIPTS
        for script in ['creative-video','creative-optics','creative-optics-renderer','creative-video-renderer']:
            self.assertIn(script,SCRIPTS)
