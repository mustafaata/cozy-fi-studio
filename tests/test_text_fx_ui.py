"""Text motion preserves editable layout and timed lyric painting under production CSP."""
import unittest
import test_controller_ui as controller_ui


class TextFxUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        controller_ui.ControllerUI.setUpClass.__func__(cls)

    @classmethod
    def tearDownClass(cls):
        controller_ui.ControllerUI.tearDownClass.__func__(cls)

    setUp=controller_ui.ControllerUI.setUp
    tearDown=controller_ui.ControllerUI.tearDown
    show=controller_ui.ControllerUI.show

    def test_lyrics_catalog_draft_cancel_history_curves_custom_and_layout(self):
        self.workspace.load_audio()
        self.show('#creativeTextPresets')
        panel=self.page.locator('#creativeTextPresets')
        self.assertEqual(panel.locator('.fx-preset').count(),50)
        panel.locator('[data-preset="TFX-01"]').click()
        history=self.page.evaluate('projectStore.past.length')
        slider=panel.locator('input[type=range][data-fx-parameter="distance"]')
        slider.evaluate("e=>{e.value=95;e.dispatchEvent(new Event('input',{bubbles:true}));}")
        self.assertEqual(self.page.evaluate('projectStore.state.lyrics.textFx.parameters.distance'),45)
        self.assertEqual(self.page.evaluate('lyricsPreview.textFxDraft.lyrics.textFx.parameters.distance'),95)
        slider.dispatch_event('pointercancel')
        self.assertTrue(self.page.evaluate('lyricsPreview.textFxDraft===null&&videoPreview.textFxDraft===null'))
        self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
        slider.evaluate("e=>{e.value=85;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}")
        self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
        self.assertEqual(self.page.evaluate('projectStore.state.lyrics.textFx.parameters.distance'),85)
        panel.locator('.fx-compare').click()
        self.assertFalse(self.page.evaluate('lyricsPreview.textFxDraft.lyrics.textFx.enabled'))
        panel.locator('.fx-compare').click()
        panel.locator('.fx-keys').evaluate('(e)=>e.open=true')
        panel.locator('.fx-key-param').select_option('distance')
        panel.locator('.fx-key-time').fill('.25');panel.locator('.fx-key-value').fill('90');panel.locator('.fx-key-add').click()
        self.assertEqual(self.page.evaluate('projectStore.state.lyrics.textFx.automation.distance[0][1]'),90)
        panel.locator('.fx-save-name').fill('Metnim');panel.locator('.fx-save').click()
        self.assertEqual(self.page.evaluate('textPresetBrowser.library.custom[0].settings.automation'),{})
        for theme in ('dark','light'):
            self.page.emulate_media(color_scheme=theme)
            for width in (320,375,768,1024,1440):
                self.page.set_viewport_size(dict(width=width,height=900))
                self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
                self.assertTrue(panel.locator('.fx-preset').first.evaluate('(e)=>{const s=e.querySelector("strong").getBoundingClientRect(),b=e.getBoundingClientRect();return s.bottom<=b.bottom+1&&s.right<=b.right+1;}'))

    def test_real_canvas_presets_unique_seek_repeat_and_settled_bypass(self):
        result=self.page.evaluate('''()=>{
          const canvas=document.createElement('canvas');canvas.width=640;canvas.height=180;const ctx=canvas.getContext('2d');
          const render=(settings,time)=>{ctx.clearRect(0,0,640,180);ctx.font='44px Arial';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillStyle='#fff';paintTextFx(ctx,'İstanbul 👨‍👩‍👧‍👦',320,65,{settings,time,local:time,duration:4,size:44,lineHeight:55},(target,text,x,y)=>target.fillText(text,x,y));return canvas.toDataURL();};
          const neutral=render(validateCreativeTextFx({}),1),images=[],repeat=[],settled=[];
          for(const preset of PROJECT_SCHEMA.creativeTextPresets.slice(0,10)){const s=validateCreativeTextFx({preset:preset.id});images.push(render(s,.37));render(s,2.8);repeat.push(render(s,.37)===images.at(-1));settled.push(render(s,1.5)===neutral);}
          return {distinct:new Set(images).size,repeat,settled,visible:images.map(image=>image!==render(validateCreativeTextFx({preset:'TFX-01'}),0))};
        }''')
        self.assertEqual(result['distinct'],10)
        self.assertTrue(all(result['repeat']))
        # Glyph painting is separately shaped; mask presets must settle pixel exactly.
        self.assertTrue(all(result['settled'][5:]))
        self.assertTrue(all(result['visible']),result)

    def test_layer_target_lock_rich_runs_and_timed_lyrics(self):
        self.workspace.load_audio()
        self.page.evaluate("window.change(p=>{p.visualLayers=[{id:'text-test',type:'text',text:'İstanbul é 👨‍👩‍👧‍👦',name:'Metnim'}];});visualLayerEditor.select('text-test');")
        self.show('#creativeTextPresets');panel=self.page.locator('#creativeTextPresets')
        panel.locator('.fx-target').select_option('layer')
        panel.locator('[data-preset="TFX-05"]').click()
        self.assertEqual(self.page.evaluate('projectStore.state.visualLayers[0].textFx.preset'),'TFX-05')
        self.assertEqual(self.page.evaluate('projectStore.state.lyrics.textFx.preset'),'')
        self.page.evaluate("window.change(p=>{p.visualLayers[0].locked=true;});")
        self.assertTrue(panel.locator('[data-preset="TFX-06"]').is_disabled())
        result=self.page.evaluate('''()=>{
          const project=copyProject(projectStore.state);project.visualLayers[0].locked=false;project.visualLayers[0].type='title';
          const layer=validateProject(project).visualLayers[0],renderer=new TitleRenderer();
          const source=renderer.source(layer,640,360,.2,4),first=source.toDataURL();renderer.source(layer,640,360,1.5,4);
          const repeat=renderer.source(layer,640,360,.2,4).toDataURL()===first;
          return {repeat,parts:renderer.entries.get(layer.id).textParts.length};
        }''')
        self.assertTrue(result['repeat']);self.assertGreater(result['parts'],0)

    def test_unicode_wrapping_karaoke_and_mask_boundary_controls(self):
        self.workspace.load_audio()
        result=self.page.evaluate('''()=>{
          const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const ctx=canvas.getContext('2d');
          const metrics=JSON.parse(document.getElementById('lyricFontMetrics').textContent),p=copyProject(projectStore.state);
          Object.assign(p.lyrics,{enabled:true,timeBase:'project',template:'karaoke',animation:'none',wordAnimation:'none',fontSize:52,font:'Arial',outline:0,glowIntensity:0,color:'#ffffff',glowColor:'#00ffff',lines:[{id:'cue',text:'İstanbul ışığı',start:0,end:3,words:[{text:'İstanbul',start:0,end:1.5},{text:'ışığı',start:1.5,end:3}]}]});
          const images=[],repeat=[];
          for(const preset of PROJECT_SCHEMA.creativeTextPresets.slice(0,10)){p.lyrics.textFx=validateCreativeTextFx({preset:preset.id});drawLyricLayer(canvas,p,.37,metrics);images.push(canvas.toDataURL());drawLyricLayer(canvas,p,1.2,metrics);drawLyricLayer(canvas,p,.37,metrics);repeat.push(canvas.toDataURL()===images.at(-1));}
          p.lyrics.textFx=validateCreativeTextFx({preset:'TFX-01'});drawLyricLayer(canvas,p,1,metrics);
          const data=ctx.getImageData(0,0,640,360).data;let highlight=0,normal=0;for(let i=0;i<data.length;i+=4){if(data[i+3]>100&&data[i]<50&&data[i+1]>180&&data[i+2]>180)highlight++;if(data[i+3]>100&&data[i]>180&&data[i+1]>180&&data[i+2]>180)normal++;}
          const sequence='👨‍👩‍👧‍👦',rows=visualTextLines({measureText:t=>({width:textFxGraphemes(t).length*10})},sequence.repeat(3),10);
          const lyricRows=wrapLyricText(sequence.repeat(3),{...p.lyrics,width:1,autoFit:false},640,360,metrics);
          const render=(id,parameters)=>{ctx.clearRect(0,0,640,360);ctx.font='52px Arial';ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='top';paintTextFx(ctx,'Mask sınırı',320,150,{settings:validateCreativeTextFx({preset:id,parameters}),time:.37,local:.37,duration:3,size:52,lineHeight:65},(target,text,x,y)=>target.fillText(text,x,y));return canvas.toDataURL();};
          const reverse=render('TFX-08',{reverse:0})!==render('TFX-08',{reverse:1}),sharp=render('TFX-07',{feather:0})!==render('TFX-07',{feather:100});
          return {distinct:new Set(images).size,repeat,highlight,normal,rows,lyricRows,sequence,reverse,sharp};
        }''')
        self.assertEqual(result['distinct'],10)
        self.assertTrue(all(result['repeat']))
        self.assertGreater(result['highlight'],0,result);self.assertGreater(result['normal'],0,result)
        self.assertEqual(result['rows'],[result['sequence']]*3)
        self.assertEqual(result['lyricRows'],[result['sequence']]*3)
        self.assertTrue(result['reverse']);self.assertTrue(result['sharp'])
