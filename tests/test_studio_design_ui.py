"""Workflow, geometry and keyboard regressions for the studio shell."""
import unittest
import test_controller_ui as controller_ui
from browser_helpers import wait_for_browser


class StudioDesignUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        controller_ui.ControllerUI.setUpClass.__func__(cls)

    @classmethod
    def tearDownClass(cls):
        controller_ui.ControllerUI.tearDownClass.__func__(cls)

    setUp=controller_ui.ControllerUI.setUp
    tearDown=controller_ui.ControllerUI.tearDown
    show=controller_ui.ControllerUI.show

    def test_layout_prioritizes_timeline_and_selected_editor_at_all_widths(self):
        with self.workspace.open_visual_layers():
            self.page.evaluate("visualLayerEditor.panel.open=false;document.querySelector('.sidebar-bottom-content').scrollTop=0")
            panel=self.page.locator('.sidebar-bottom-content').bounding_box()
            field=self.page.locator('.clip-editor .clip-offset').bounding_box()
            self.assertLessEqual(field['y']+field['height'],panel['y']+panel['height'])
            for theme in ['dark','light']:
                self.page.emulate_media(color_scheme=theme)
                ratios=self.page.evaluate('''()=>{
                  const css=getComputedStyle(document.documentElement);
                  const lum=key=>{const hex=css.getPropertyValue(key).trim().slice(1),rgb=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
                  const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
                  return {text:ratio('--text','--panel'),muted:ratio('--muted','--panel'),focus:ratio('--lamp','--panel'),boundary:ratio('--line-strong','--panel')};
                }''')
                self.assertGreaterEqual(ratios['text'],4.5);self.assertGreaterEqual(ratios['muted'],4.5)
                self.assertGreaterEqual(ratios['focus'],3);self.assertGreaterEqual(ratios['boundary'],3)
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900))
                    for mode,kind in [('mix','main'),('video','video'),('lyrics','lyrics'),('videofx','videofx'),('output','output')]:
                        self.page.locator(f'[data-mode="{mode}"]').click()
                        self.assertTrue(self.page.locator('#inspector-'+kind).is_visible())
                        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
                        if width>900:
                            preview=self.page.locator('.preview').bounding_box();inspector=self.page.locator('.inspector-pane').bounding_box()
                            self.assertLess(preview['x'],inspector['x'])
                            bottom=self.page.locator('#lyricsWorkbench' if mode=='lyrics' else '.timeline').bounding_box()
                            self.assertAlmostEqual(bottom['x'],preview['x'],delta=1)
                            self.assertAlmostEqual(bottom['x']+bottom['width'],inspector['x']+inspector['width'],delta=1)
            ids=self.page.evaluate('Array.from(document.querySelectorAll("[id]"),node=>node.id)')
            self.assertEqual(len(ids),len(set(ids)))

    def test_search_reveals_existing_tool_and_preserves_project_history(self):
        with self.workspace.open_visual_layers():
            self.page.evaluate('selectSidebarTab("main")')
            before=self.page.evaluate('JSON.stringify(projectStore.snapshot())');history=self.page.evaluate('projectStore.past.length')
            self.page.keyboard.press('Control+k');self.assertTrue(self.page.locator('#studioToolDialog').is_visible())
            query=self.page.locator('#studioToolQuery');query.fill('warp');query.press('ArrowDown')
            self.assertTrue(self.page.locator('.tool-result').first.evaluate('el=>el===document.activeElement'))
            muted=self.page.evaluate('audioEngine.isMuted');self.page.keyboard.press('m');self.page.keyboard.press(']')
            self.assertEqual(self.page.evaluate('audioEngine.isMuted'),muted)
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before)
            self.page.keyboard.press('Enter')
            wait_for_browser(self.page,'document.activeElement.closest("details")?.id==="audioWarpEditor"')
            self.assertTrue(self.page.locator('#audioWarpEditor').evaluate('el=>el.open'))
            self.assertEqual(self.page.locator('.inspector-tool-nav select').input_value(),'audioWarpEditor')
            self.assertEqual(self.page.evaluate('JSON.stringify(projectStore.snapshot())'),before)
            self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            self.page.locator('#studioToolSearch').click();query.fill('bu araç yok 123')
            self.assertEqual(self.page.locator('.tool-result').count(),0)
            self.assertIn('Sonuç bulunamadı',self.page.locator('#studioToolCount').text_content())
            self.page.keyboard.press('Escape')
            wait_for_browser(self.page,'document.activeElement===document.getElementById("studioToolSearch")')
            self.assertTrue(self.page.locator('#studioToolSearch').evaluate('el=>el===document.activeElement'))
            self.page.locator('#studioToolSearch').click();query.fill('anahtar kare');query.press('Enter')
            wait_for_browser(self.page,'!!document.activeElement.closest(".keyframe-editor")')
            self.assertEqual(self.page.locator('[data-mode="video"]').get_attribute('aria-pressed'),'true')

    def test_search_includes_added_channel_and_local_navigator_follows_context(self):
        self.workspace.load_audio();self.page.locator('.add-track-btn').click()
        kind=self.page.evaluate('Object.keys(projectStore.state.tracks).find(id=>id.startsWith("track_"))')
        self.page.locator('#studioToolSearch').click();self.page.locator('#studioToolQuery').fill('katman otomasyon')
        result=self.page.locator('.tool-result').filter(has_text='Ses otomasyonu')
        self.assertEqual(result.count(),1);result.click()
        wait_for_browser(self.page,'id=>document.querySelector(".sidebar-view.active-view").id==="inspector-"+id',arg=kind)
        self.assertTrue(self.page.locator('#inspect-'+kind+' .automation-editor').evaluate('el=>el.open'))
        self.assertEqual(self.page.locator('.inspector-tool-nav select').input_value(),kind+'-automation')
        self.page.locator('[data-mode="video"]').click()
        self.assertTrue(self.page.locator('.inspector-tool-nav select option[value="videoSource"]').count())
        self.assertFalse(self.page.locator('.inspector-tool-nav select option[value="audioWarpEditor"]').count())

    def test_dialog_keyboard_focus_and_audio_empty_state(self):
        with self.page.expect_file_chooser() as chooser:
            self.page.locator('#stageAudioBtn').click()
        chooser.value.set_files(str(self.workspace.audio));wait_for_browser(self.page,'!!audioEngine.files.main')
        self.assertTrue(self.page.locator('#playBtn').is_enabled())
        self.page.locator('#studioToolSearch').click()
        self.page.locator('#studioToolQuery').press('Shift+Tab')
        self.assertTrue(self.page.locator('#studioToolClose').evaluate('el=>el===document.activeElement'))
        for _ in range(8):
            self.page.keyboard.press('Shift+Tab')
            self.assertTrue(self.page.evaluate('document.getElementById("studioToolDialog").contains(document.activeElement)'))
        self.page.keyboard.press('Escape')
        self.assertFalse(self.page.locator('#studioToolDialog').is_visible())


if __name__=='__main__':
    unittest.main()
