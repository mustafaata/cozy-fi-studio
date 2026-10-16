"""Controller contracts against Waitress with the application's production CSP."""
import threading
import unittest
import secrets
import test_workspace_ui as workspace_ui
from browser_helpers import wait_for_browser


@unittest.skipIf(workspace_ui.sync_playwright is None, 'Playwright is required.')
class ControllerUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app import app
        from waitress import create_server
        # Port 0 can select browser-blocked service ports on this Windows host.
        # Bind directly within the dynamic/private range; never relax browser security.
        for attempt in range(20):
            try:
                cls.service=create_server(app,host='127.0.0.1',port=49152+secrets.randbelow(16384),threads=8)
                break
            except OSError as error:
                if error.errno not in (13,48,98,10013,10048) and getattr(error,'winerror',None) not in (10013,10048):
                    raise
                if attempt==19:
                    raise
        try:workspace_ui.WorkspaceUI.setUpClass()
        except Exception:
            cls.service.close();raise
        base=workspace_ui.WorkspaceUI
        base.server.shutdown();base.server.server_close();base.thread.join(5)
        cls.thread=threading.Thread(target=cls.service.run,daemon=True);cls.thread.start()
        base.url=f'http://127.0.0.1:{cls.service.effective_port}'

    @classmethod
    def tearDownClass(cls):
        base=workspace_ui.WorkspaceUI
        base.browser.close();base.pw.stop();cls.service.close();cls.thread.join(timeout=5);base.temporary.cleanup()

    def setUp(self):
        self.workspace=workspace_ui.WorkspaceUI('runTest');self.workspace.setUp();self.page=self.workspace.page
        self.page.route('**/api/lyrics/search?**',lambda route:route.fulfill(json=dict(items=[])))
        response=self.page.reload(wait_until='networkidle')
        self.assertIn('content-security-policy',response.headers)

    def tearDown(self):
        self.workspace.tearDown()

    def show(self,selector):
        self.page.evaluate('''selector=>{const node=document.querySelector(selector),view=node.closest('.sidebar-view');
          if(view)selectSidebarTab(view.id.replace('inspector-',''));let parent=node.parentElement;
          while(parent){if(parent.tagName==='DETAILS')parent.open=true;parent=parent.parentElement;}}''',selector)
        self.page.locator(selector).scroll_into_view_if_needed()

    def drag_number(self,selector,pixels=30,shift=False):
        self.show(selector);box=self.page.locator(selector).bounding_box();x=box['x']+5;y=box['y']+box['height']/2
        if shift:self.page.keyboard.down('Shift')
        self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+pixels,y,steps=3)
        if shift:self.page.keyboard.up('Shift')

    def test_marker_zoom_drag_cancel_keyboard_and_value_editor(self):
        self.workspace.load_audio()
        self.page.evaluate('''()=>{projectStore.update(p=>{p.effects.speed=1;p.markers=[{id:'audit',time:1.25,name:'Bölüm'}];});timelineView.set(3,1);}''')
        marker=self.page.locator('[data-marker-id="audit"]');marker.scroll_into_view_if_needed()
        box=marker.bounding_box();ruler=self.page.locator('#timelineMarkers').bounding_box()
        self.page.mouse.move(box['x']+box['width']/2,box['y']+8);self.page.mouse.down()
        self.page.mouse.move(ruler['x']+ruler['width']*.75,box['y']+8,steps=5);self.page.mouse.up()
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.markers[0].time'),1.75,places=2)
        self.page.evaluate('projectStore.undo()');self.assertAlmostEqual(self.page.evaluate('projectStore.state.markers[0].time'),1.25)
        box=marker.bounding_box();self.page.mouse.move(box['x']+16,box['y']+8);self.page.mouse.down()
        self.page.mouse.move(box['x']+60,box['y']+8);self.page.keyboard.press('Escape');self.page.mouse.up()
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.markers[0].time'),1.25)
        fps=self.page.evaluate('Number(projectStore.state.output.fps)')
        marker.focus();marker.press('ArrowRight');self.assertAlmostEqual(self.page.evaluate('projectStore.state.markers[0].time'),1.25+1/fps,places=7)
        marker.press('Enter');self.page.locator('.marker-name').fill('Yeni bölüm');self.page.locator('.marker-name').dispatch_event('change')
        self.page.locator('.marker-time').fill('1.6');self.page.locator('.marker-time').dispatch_event('change')
        self.assertEqual(self.page.evaluate('projectStore.state.markers[0].name'),'Yeni bölüm')
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.markers[0].time'),1.6)
        self.page.locator('.marker-delete').click();self.assertEqual(self.page.evaluate('projectStore.state.markers.length'),0)
        self.page.evaluate('projectStore.undo()');self.assertEqual(self.page.evaluate('projectStore.state.markers[0].name'),'Yeni bölüm')

    def test_numeric_escape_cancel_precision_and_readonly_warp(self):
        self.workspace.load_audio();self.page.evaluate('projectStore.past=[];projectStore.future=[];')
        self.drag_number('#mainVolOut');self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.volume'),110)
        self.page.keyboard.press('Escape');self.page.mouse.up()
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.volume'),100)
        self.assertEqual(self.page.evaluate('projectStore.past.length'),0)
        self.drag_number('#mainVolOut');self.page.locator('#mainVolOut').dispatch_event('pointercancel',dict(pointerId=1));self.page.mouse.up()
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.volume'),100)
        self.page.evaluate('projectStore.update(p=>{p.tracks.main.end=2.5;});')
        self.drag_number('#main-end',4,shift=True);self.page.mouse.up()
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.main.end'),2.501,places=6)
        self.page.evaluate('audioWarpEditor.openNew()');selector='[data-warp-field="source:0"]'
        self.assertTrue(self.page.locator(selector).evaluate('el=>el.readOnly'))
        before=self.page.evaluate('audioWarpEditor.draft.markers[0][0]');self.drag_number(selector);self.page.mouse.up()
        self.assertEqual(self.page.evaluate('audioWarpEditor.draft.markers[0][0]'),before)

    def test_slip_numeric_scrub_updates_draft_and_escape_restores(self):
        with self.workspace.open_visual_layers():
            self.page.evaluate('''()=>{projectStore.update(p=>{p.videoClips[0].end=1;});videoClipEditor.select(projectStore.state.videoClips[0].id);}''')
            self.drag_number('.slip-delta')
            self.assertAlmostEqual(float(self.page.locator('.slip-delta').input_value()),.1)
            self.assertAlmostEqual(self.page.evaluate('videoClipEditor.slip.delta'),.1)
            self.page.keyboard.press('Escape');self.page.mouse.up()
            self.assertAlmostEqual(self.page.evaluate('videoClipEditor.slip.delta'),0)
            self.drag_number('.slip-delta');self.page.mouse.up()
            self.assertAlmostEqual(self.page.evaluate('videoClipEditor.slip.delta'),.1)
            self.assertTrue(self.page.locator('.slip-apply').is_enabled())

    def test_selected_video_source_clocks_precision_and_select_shortcut(self):
        self.show('#video-start');self.assertTrue(self.page.locator('#video-start').is_disabled())
        self.page.locator('.precision-parameter').select_option('start')
        self.assertTrue(self.page.locator('.precision-value').is_disabled())
        with self.workspace.open_visual_layers():
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id)')
            self.page.evaluate('projectStore.update(p=>{p.videoClips[0].end=null;})')
            self.drag_number('#video-end',-30);self.page.mouse.up()
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[0].end'),1.9)
            self.show('#video-speed');self.page.locator('#video-speed').fill('1.75');self.page.locator('#video-speed').dispatch_event('change')
            self.page.locator('#video-start').fill('.4');self.page.locator('#video-start').dispatch_event('change')
            self.assertEqual(self.page.evaluate('projectStore.state.video.speed'),1)
            self.assertAlmostEqual(self.page.evaluate('videoClipEditor.timeline()[0].rate'),1.75)
            self.assertAlmostEqual(self.page.evaluate('videoClipEditor.timeline()[0].timeMap.sourceAt(.25)'),.8375)
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[1].id)')
            self.page.locator('.precision-parameter').select_option('start');self.page.locator('.precision-value').fill('.2');self.page.locator('.precision-value').dispatch_event('change')
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[1].start'),.2)
            self.assertAlmostEqual(self.page.evaluate('projectStore.state.videoClips[0].start'),.4)
            self.page.evaluate("projectStore.update(p=>p.videoClips[1].name='İkinci kaynak')")
            self.assertEqual(self.page.locator('.video-source-scope').text_content(),'Kaynak: İkinci kaynak')
            self.page.locator('#video-fit').focus();before=self.page.evaluate('audioEngine.isMuted');self.page.keyboard.press('m')
            self.assertEqual(self.page.evaluate('audioEngine.isMuted'),before)
            self.page.locator('#video-linkSpeed').check();self.assertTrue(self.page.locator('#video-speed').is_disabled())

    def test_slider_units_fill_overlay_limits_and_choice_semantics(self):
        with self.workspace.open_visual_layers():
            self.page.evaluate('''()=>{const el=document.getElementById('bassSlider');el.value=15;el.dispatchEvent(new Event('input',{bubbles:true}));}''')
            self.assertEqual(self.page.evaluate('projectStore.state.effects.bass'),100)
            self.assertEqual(self.page.locator('#bassBadge').text_content(),'+15.0 dB')
            self.assertEqual(self.page.locator('#bassSlider').get_attribute('aria-label'),'Bas kazancı · dB')
            self.page.evaluate('''()=>{const el=document.querySelector('input[type=range][aria-label="Yakınlık · ×"]');el.value=2;el.dispatchEvent(new Event('input',{bubbles:true}));}''')
            fill=self.page.evaluate('getComputedStyle(document.querySelector("input[type=range][aria-label=\\"Yakınlık · ×\\"]")).getPropertyValue("--fill")')
            self.assertAlmostEqual(float(fill.rstrip('%')),48.72,places=2)
            self.page.evaluate('''()=>{const el=document.getElementById('overlayScaleOut');el.value=300;el.dispatchEvent(new Event('change',{bubbles:true}));}''')
            self.assertEqual(self.page.locator('#overlayScale').input_value(),'300')
            self.page.evaluate('''()=>{const el=document.getElementById('overlayScaleOut');el.value='';el.dispatchEvent(new Event('change',{bubbles:true}));}''')
            self.assertEqual(self.page.locator('#overlayScaleOut').input_value(),'300')
            self.assertEqual(self.page.evaluate('projectStore.state.overlay.scale'),300)
            self.page.locator('[data-inspect="videofx"]').click();button=self.page.locator('[data-bass-id="zoom"]');button.click()
            self.assertEqual(button.get_attribute('role'),'checkbox');self.assertEqual(button.get_attribute('aria-checked'),'true')
            button.click();self.assertEqual(button.get_attribute('aria-checked'),'false')
            self.assertEqual(self.page.locator('.automation-time-zoom').first.get_attribute('aria-label'),'Otomasyon zaman yakınlığı')

    def test_waveform_snap_pixel_radius_and_wheel_scroll_contract(self):
        self.workspace.load_audio()
        self.page.evaluate('''()=>{projectStore.update(p=>{p.effects.speed=1.5;p.tracks.main.start=.5;p.tracks.main.end=2.5;p.markers=[{id:'target',name:'Hedef',time:1}];});const region=audioEngine.getMainRegion();region.setOptions({start:.5,end:2.02});audioEngine.regMain.emit('region-updated',region,'end');}''')
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.main.end'),2)
        self.page.evaluate('''()=>{projectStore.update(p=>{p.effects.speed=1;p.tracks.main.start=0;p.tracks.main.end=3;p.markers=[{id:'target',name:'Hedef',time:2}];});audioEngine.zoomLevel.main=1000;const region=audioEngine.getMainRegion();region.setOptions({start:0,end:2.04});audioEngine.regMain.emit('region-updated',region,'end');}''')
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.tracks.main.end'),2.04)
        self.assertFalse(self.page.evaluate('''()=>{const event=new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true});document.getElementById('waveform-main').dispatchEvent(event);return event.defaultPrevented;}'''))
        self.assertTrue(self.page.evaluate('''()=>{const event=new WheelEvent('wheel',{deltaY:120,ctrlKey:true,bubbles:true,cancelable:true});document.getElementById('waveform-main').dispatchEvent(event);return event.defaultPrevented;}'''))

    def test_unrelated_volume_change_keeps_clip_controls_and_viewport_stable(self):
        with self.workspace.open_visual_layers():
            result=self.page.evaluate('''()=>{timelineView.set(2,0);const clip=document.querySelector('.clip-select[data-clip]');let changes=0;const listener=()=>changes++;timelineView.addEventListener('change',listener);projectStore.update(p=>{p.tracks.main.volume=92;});const same=clip===document.querySelector('.clip-select[data-clip]');timelineView.removeEventListener('change',listener);return {same,changes};}''')
            self.assertTrue(result['same']);self.assertEqual(result['changes'],0)
            self.page.evaluate('selectSidebarTab("main")')
            nav=self.page.locator('.inspector-tool-nav')
            nav.locator('select').select_option('audioWarpEditor');nav.locator('button').click()
            self.assertTrue(self.page.locator('#audioWarpEditor').evaluate('el=>el.open'))
            self.assertEqual(self.page.evaluate('document.activeElement.closest("details")?.id'),'audioWarpEditor')
            for theme in ['dark','light']:
                self.page.emulate_media(color_scheme=theme)
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900))
                    self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)

    def test_precision_source_metadata_bounds_and_focused_refresh(self):
        self.show('.precision-parameter');self.page.locator('.precision-parameter').select_option('start')
        self.assertTrue(self.page.locator('.precision-minus').is_disabled())
        self.assertTrue(self.page.locator('.precision-plus').is_disabled())
        with self.workspace.open_visual_layers():
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id)')
            self.page.locator('.precision-parameter').select_option('end')
            self.page.evaluate("Object.defineProperty(videoClipEditor,'infos',{value:new Map(),configurable:true});document.dispatchEvent(new Event('video-selection-changed'))")
            try:
                self.assertTrue(self.page.locator('.precision-value').is_disabled())
                self.assertTrue(self.page.locator('.precision-plus').is_disabled())
            finally:
                self.page.evaluate("delete videoClipEditor.infos;document.dispatchEvent(new Event('video-selection-changed'))")
            self.page.locator('.precision-parameter').select_option('start')
            value=self.page.locator('.precision-value');value.fill('.3');value.dispatch_event('change')
            self.page.evaluate('projectStore.undo()')
            self.assertEqual(float(value.input_value()),0)
            value.fill('');value.dispatch_event('change')
            self.assertEqual(float(value.input_value()),0)
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].start'),0)
            self.page.locator('.precision-parameter').select_option('zoom')
            value.fill('400');value.dispatch_event('change')
            self.assertTrue(self.page.locator('.precision-plus').is_disabled())
            self.assertEqual(self.page.evaluate('projectStore.state.video.zoom'),4)
            value.fill('10');value.dispatch_event('change')
            self.assertTrue(self.page.locator('.precision-minus').is_disabled())
            self.assertEqual(self.page.evaluate('projectStore.state.video.zoom'),.1)

    def test_marker_delete_keeps_focus_and_announces_last_removal(self):
        self.workspace.load_audio()
        self.page.evaluate("projectStore.update(p=>{p.markers=[{id:'first',name:'Bir',time:.25},{id:'second',name:'İki',time:.5}]})")
        first=self.page.locator('[data-marker-id="first"]');first.focus();first.press('Delete')
        self.assertEqual(self.page.evaluate('document.activeElement.dataset.markerId'),'second')
        self.page.keyboard.press('Delete')
        self.assertEqual(self.page.evaluate('projectStore.state.markers.length'),0)
        self.assertEqual(self.page.evaluate('document.activeElement.textContent'),'＋ İşaretçi')
        self.assertIn('İşaretçi silindi',self.page.locator('#statusText').text_content())
        self.page.evaluate('projectStore.undo()')
        marker=self.page.locator('[data-marker-id="second"]');marker.focus();marker.press('Enter')
        self.page.locator('.marker-delete').click()
        self.assertEqual(self.page.evaluate('document.activeElement.textContent'),'＋ İşaretçi')

    def test_frame_scrub_survives_lyric_row_replacement_and_cancels(self):
        self.workspace.load_audio()
        self.page.evaluate("projectStore.update(p=>{p.lyrics.timeBase='project';p.lyrics.lines=[{id:'frame-row',text:'Deneme',start:.5,end:2}]});selectSidebarTab('lyrics')")
        group=self.page.locator('.lyric-row .time-unit-control').first
        group.locator('select').select_option('frames')
        frame=group.locator('input').nth(1);frame.scroll_into_view_if_needed();box=frame.bounding_box()
        x=box['x']+5;y=box['y']+box['height']/2
        self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+30,y,steps=6);self.page.mouse.up()
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.lyrics.lines[0].start'),22/24)
        self.assertEqual(frame.input_value(),'22')
        history=self.page.evaluate('projectStore.past.length');box=frame.bounding_box();x=box['x']+5;y=box['y']+box['height']/2
        self.page.mouse.move(x,y);self.page.mouse.down();self.page.mouse.move(x+15,y,steps=4)
        self.page.keyboard.press('Escape');self.page.mouse.up()
        self.assertAlmostEqual(self.page.evaluate('projectStore.state.lyrics.lines[0].start'),22/24)
        self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
        self.page.evaluate('projectStore.undo()');self.assertAlmostEqual(self.page.evaluate('projectStore.state.lyrics.lines[0].start'),.5)

    def test_unit_mirrors_preserve_readonly_refresh_and_visible_validation(self):
        self.workspace.load_audio();self.show('#main-start')
        group=self.page.locator('#main-start').locator('..');group.locator('select').select_option('frames')
        frame=group.locator('input').nth(1)
        self.page.evaluate("document.getElementById('main-start').readOnly=true;projectStore.notify()")
        self.assertTrue(frame.evaluate('el=>el.readOnly'))
        self.page.evaluate("document.getElementById('main-start').readOnly=false;projectStore.update(p=>p.tracks.main.start=.5)")
        frame.focus();self.page.evaluate("projectStore.update(p=>p.output.fps='60')")
        self.assertEqual(frame.input_value(),'30')
        frame.fill('-1');frame.dispatch_event('change')
        self.assertEqual(frame.input_value(),'30')
        self.assertIn('kare',self.page.locator('#statusText').text_content().lower())
        level=self.page.locator('#mainVolOut').locator('..').locator('.level-unit-controls')
        level.locator('select').select_option('dB');db=level.locator('input')
        db.fill('10');db.dispatch_event('change')
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.volume'),100)
        self.assertIn('dB',self.page.locator('#statusText').text_content())
        self.page.evaluate("document.getElementById('mainVolOut').readOnly=true;projectStore.notify()")
        self.assertTrue(db.evaluate('el=>el.readOnly'))

    def test_db_silence_scrub_starts_quietly_and_keeps_full_gain_range(self):
        self.workspace.load_audio()
        level=self.page.locator('#mainVolOut').locator('..').locator('.level-unit-controls')
        level.locator('select').select_option('dB');db=level.locator('input')
        self.page.evaluate('projectStore.update(p=>p.tracks.main.volume=0)')
        history=self.page.evaluate('projectStore.past.length')
        self.drag_number('#inspect-main .level-unit-controls input')
        gain=self.page.evaluate('projectStore.state.tracks.main.volume')
        self.assertGreater(gain,0);self.assertLess(gain,.001)
        self.page.keyboard.press('Escape');self.page.mouse.up()
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.volume'),0)
        self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
        self.page.evaluate('projectStore.update(p=>p.tracks.main.volume=.00001)')
        self.assertEqual(db.input_value(),'-140');self.assertTrue(db.evaluate('el=>el.validity.valid'))
        db.fill('');db.dispatch_event('change')
        self.assertEqual(self.page.evaluate('projectStore.state.tracks.main.volume'),0)


    def test_short_clip_frames_respect_representable_bounds_without_changing_seconds(self):
        with self.workspace.open_visual_layers():
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id);projectStore.update(p=>p.videoClips[0].end=.05)')
            self.show('#video-end');group=self.page.locator('#video-end').locator('..')
            group.locator('select').select_option('frames');frame=group.locator('input').nth(1)
            self.assertTrue(frame.evaluate('el=>el.validity.valid'))
            self.assertEqual(frame.input_value(),'2')
            self.assertIn('yaklaşık',frame.get_attribute('aria-label'))
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].end'),.05)
            group.locator('select').select_option('seconds')
            self.assertEqual(float(self.page.locator('#video-end').input_value()),.05)
            group.locator('select').select_option('frames');frame.focus()
            self.page.evaluate("Object.defineProperty(videoClipEditor,'infos',{value:new Map([[projectStore.state.videoClips[0].asset,{duration:.06}]]),configurable:true});document.dispatchEvent(new Event('video-selection-changed'))")
            try:
                self.assertTrue(frame.is_disabled());self.assertTrue(group.locator('select').is_enabled())
                self.assertTrue(group.locator('select').evaluate('el=>el===document.activeElement'))
                self.assertIn('sn',frame.get_attribute('title'))
                group.locator('select').select_option('seconds')
                self.assertTrue(self.page.locator('#video-end').is_enabled())
            finally:
                self.page.evaluate("delete videoClipEditor.infos;document.dispatchEvent(new Event('video-selection-changed'))")

    def test_precision_fractional_boundaries_remain_valid_in_frames(self):
        with self.workspace.open_visual_layers():
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id);projectStore.update(p=>{p.videoClips[0].start=.000001;p.videoClips[0].end=.050001;})')
            self.show('.precision-parameter');self.page.locator('.precision-parameter').select_option('end')
            self.page.locator('.precision-unit').select_option('frames')
            value=self.page.locator('.precision-value')
            self.assertTrue(value.evaluate('el=>el.validity.valid'))
            self.assertAlmostEqual(float(value.input_value()),.050001*24,places=8)
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].end'),.050001)


    def test_precision_negative_pixel_axis_and_unit_switch_preserve_geometry(self):
        with self.workspace.open_visual_layers():
            self.page.evaluate("projectStore.update(p=>{p.output.aspect='16:9';p.video.fit='cover';p.video.zoom=1;p.video.positionY=1;})")
            self.show('.precision-parameter');self.page.locator('.precision-parameter').select_option('positionY')
            value=self.page.locator('.precision-value')
            self.assertLess(float(value.input_value()),0)
            self.assertTrue(value.evaluate('el=>el.validity.valid'))
            self.assertTrue(self.page.locator('.precision-minus').is_disabled())
            geometry='videoRect(videoPreview.info,videoOutputSize(videoPreview.info,projectStore.state.output),projectStore.state.video).y'
            before=self.page.evaluate(geometry);self.page.locator('.precision-plus').click()
            self.assertAlmostEqual(self.page.evaluate(geometry)-before,1,places=5)
            position=self.page.evaluate('projectStore.state.video.positionY')
            self.page.locator('.precision-unit').select_option('percent')
            self.assertAlmostEqual(float(value.input_value()),position*100,places=4)
            self.assertEqual(self.page.evaluate('projectStore.state.video.positionY'),position)
            self.page.locator('.precision-unit').select_option('pixels')
            self.page.evaluate("projectStore.update(p=>p.output.aspect='source')")
            self.assertTrue(value.is_disabled())
            for theme in ['dark','light']:
                self.page.emulate_media(color_scheme=theme)
                for width in [320,375,768,1024,1440]:
                    self.page.set_viewport_size(dict(width=width,height=900))
                    self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)


if __name__=='__main__':
    unittest.main()
