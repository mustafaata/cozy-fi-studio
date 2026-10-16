"""Reactive authoring and actual prepared audio on production Waitress/CSP."""
import unittest
import test_controller_ui as controller_ui
from browser_helpers import wait_for_browser


class ReactiveUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):controller_ui.ControllerUI.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls):controller_ui.ControllerUI.tearDownClass.__func__(cls)
    setUp=controller_ui.ControllerUI.setUp
    tearDown=controller_ui.ControllerUI.tearDown
    show=controller_ui.ControllerUI.show

    def test_catalog_draft_curves_custom_history_and_responsive_layout(self):
        self.workspace.load_audio();self.show('#creativeReactivePresets');panel=self.page.locator('#creativeReactivePresets')
        self.assertEqual(panel.locator('.fx-preset').count(),50)
        panel.locator('[data-preset="ARX-01"]').click();history=self.page.evaluate('projectStore.past.length')
        slider=panel.locator('input[type=range][data-fx-parameter="zoom"]')
        slider.evaluate("e=>{e.value=17;e.dispatchEvent(new Event('input',{bubbles:true}));}")
        self.assertEqual(self.page.evaluate('projectStore.state.video.reactiveFx.parameters.zoom'),8)
        self.assertEqual(self.page.evaluate('videoPreview.reactiveFxDraft.video.reactiveFx.parameters.zoom'),17)
        slider.dispatch_event('pointercancel');self.assertTrue(self.page.evaluate('videoPreview.reactiveFxDraft===null'))
        self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
        slider.evaluate("e=>{e.value=19;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}")
        self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
        panel.locator('.fx-compare').click();self.assertFalse(self.page.evaluate('videoPreview.reactiveFxDraft.video.reactiveFx.enabled'));panel.locator('.fx-compare').click()
        panel.locator('.fx-keys').evaluate('(e)=>e.open=true');panel.locator('.fx-key-param').select_option('zoom')
        panel.locator('.fx-key-time').fill('.25');panel.locator('.fx-key-value').fill('25');panel.locator('.fx-key-add').click()
        self.assertEqual(self.page.evaluate('projectStore.state.video.reactiveFx.automation.zoom[0][1]'),25)
        self.assertFalse(panel.locator('.fx-key-param option[value="bandLow"]').count())
        panel.locator('.fx-save-name').fill('Kadrajım');panel.locator('.fx-save').click()
        self.assertEqual(self.page.evaluate('reactivePresetBrowser.library.custom[0].settings.automation'),{})
        for theme in ('dark','light'):
            self.page.emulate_media(color_scheme=theme)
            for width in (320,375,768,1024,1440):
                self.page.set_viewport_size(dict(width=width,height=900))
                self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
                self.assertTrue(panel.locator('.fx-preset').first.evaluate('(e)=>{const s=e.querySelector("strong").getBoundingClientRect(),b=e.getBoundingClientRect();return s.bottom<=b.bottom+1&&s.right<=b.right+1;}'))

    def test_real_pre_post_track_bus_analysis_invalidation_and_undo(self):
        self.workspace.load_audio()
        self.page.evaluate("window.change(p=>{p.effects.speed=1;p.effects.reverb=0;p.tracks.main.fadeIn=p.tracks.main.fadeOut=0;p.audioBuses=[{id:'echo',name:'Echo',audioFx:{preset:'AFX-11',amount:100,parameters:{delay:100,tone:18000}}}];p.tracks.main.bus='echo';});")
        self.show('#creativeReactivePresets');panel=self.page.locator('#creativeReactivePresets')
        panel.locator('.reactive-source').select_option('b:echo');panel.locator('.reactive-point').select_option('pre')
        panel.locator('.reactive-prepare').click();wait_for_browser(self.page,'!!reactiveAnalysisEditor.analysis',timeout=60000)
        pre=self.page.evaluate('Array.from(reactiveAnalysisEditor.analysis.samples.slice(0,640))')
        self.assertTrue(any(pre));self.assertIn('FX öncesi',panel.locator('.reactive-status').inner_text())
        panel.locator('.reactive-point').select_option('post');self.assertTrue(self.page.evaluate('reactiveAnalysisEditor.analysis===null'))
        panel.locator('.reactive-prepare').click();wait_for_browser(self.page,'!!reactiveAnalysisEditor.analysis',timeout=60000)
        post=self.page.evaluate('Array.from(reactiveAnalysisEditor.analysis.samples.slice(0,640))')
        self.assertNotEqual(pre,post);self.assertFalse(any(post[:64*6]))
        panel.locator('[data-preset="ARX-02"]').click();self.assertTrue(self.page.evaluate('!!reactiveAnalysisEditor.analysis'))
        self.page.evaluate('projectStore.update(p=>p.tracks.main.volume=65)');self.assertTrue(self.page.evaluate('reactiveAnalysisEditor.analysis===null'))
        self.assertIn('yeniden',panel.locator('.reactive-status').inner_text())
        self.page.evaluate("window.change(p=>removeAudioBus(p,'echo'))")
        self.assertEqual(self.page.evaluate('projectStore.state.video.reactiveAnalysis.source'),'master')
        self.page.evaluate('projectStore.undo()');self.assertEqual(self.page.evaluate('projectStore.state.video.reactiveAnalysis.source'),'b:echo')

    def test_all_renderers_distinct_silent_neutral_and_seek_repeatable(self):
        result=self.page.evaluate('''()=>{
          const sample=document.createElement('canvas');sample.width=640;sample.height=360;const ctx=sample.getContext('2d');ctx.fillStyle='#19202c';ctx.fillRect(0,0,640,360);ctx.fillStyle='#b57a55';ctx.fillRect(150,65,130,230);ctx.strokeStyle='#eee';ctx.strokeRect(30,30,580,300);
          const renderer=new ReactiveRenderer(),analysis=reactiveExampleAnalysis(),silent={...analysis,samples:new Uint8Array(analysis.samples.length),stereo:{...analysis.stereo,samples:new Uint8Array(analysis.stereo.samples.length),moments:new Float32Array(analysis.stereo.moments.length)}},neutral=sample.toDataURL(),images=[],repeat=[],zero=[];
          for(const preset of PROJECT_SCHEMA.creativeReactivePresets.slice(0,30)){const s=validateCreativeReactiveFx({preset:preset.id});images.push(renderer.source(sample,s,.37,analysis).toDataURL());renderer.source(sample,s,2.2,analysis);repeat.push(renderer.source(sample,s,.37,analysis).toDataURL()===images.at(-1));zero.push(renderer.source(sample,s,.37,silent)===sample);}
          return {distinct:new Set(images).size,repeat,zero,changed:images.map(v=>v!==neutral)};
        }''')
        self.assertEqual(result['distinct'],30);self.assertTrue(all(result['repeat']));self.assertTrue(all(result['zero']));self.assertTrue(all(result['changed']))

    def test_cancel_stale_response_and_project_reload_require_preparation(self):
        self.workspace.load_audio();self.show('#creativeReactivePresets');panel=self.page.locator('#creativeReactivePresets')
        self.page.route('**/api/audio/reactive',lambda route:route.fulfill(status=400,json=dict(message='Temsili analiz hatası')))
        panel.locator('.reactive-prepare').click();wait_for_browser(self.page,'!reactiveAnalysisEditor.busy')
        self.assertIn('Temsili',panel.locator('.reactive-status').inner_text())
        self.assertTrue(self.page.evaluate('reactiveAnalysisEditor.analysis===null'))
        self.page.unroute('**/api/audio/reactive')
        panel.locator('.reactive-prepare').click();panel.locator('.reactive-cancel').click()
        self.assertFalse(self.page.evaluate('reactiveAnalysisEditor.busy'))
        self.assertTrue(self.page.evaluate('reactiveAnalysisEditor.analysis===null'))
        self.page.evaluate('projectStore.replace(projectStore.snapshot())')
        self.assertTrue(self.page.evaluate('reactiveAnalysisEditor.analysis===null'))
