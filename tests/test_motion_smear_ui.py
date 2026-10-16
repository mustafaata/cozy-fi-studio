"""Motion-selective histories on the real GPU, fallback and production-CSP UI."""
import base64
import json
from pathlib import Path
import unittest
from browser_helpers import wait_for_browser
import test_temporal_video_ui as temporal_ui


class MotionSmearUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):temporal_ui.TemporalVideoUI.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls):temporal_ui.TemporalVideoUI.tearDownClass.__func__(cls)
    setUp=temporal_ui.TemporalVideoUI.setUp
    tearDown=temporal_ui.TemporalVideoUI.tearDown
    show=temporal_ui.TemporalVideoUI.show
    load_video=temporal_ui.TemporalVideoUI.load_video

    def test_actual_gpu_cpu_parity_for_transparent_edges_all_counts_thresholds_and_mix(self):
        result=self.page.evaluate('''()=>{
          const make=t=>{const canvas=document.createElement('canvas');canvas.width=127;canvas.height=95;const ctx=canvas.getContext('2d');ctx.fillStyle='rgba(35,75,130,.4)';ctx.fillRect(4,4,119,87);ctx.fillStyle='rgba(240,70,30,.75)';ctx.fillRect(12+t*60,18,22,52);ctx.fillStyle='rgba(20,230,100,.5)';ctx.fillRect(80,12+t*30,18,20);return canvas;},source=make(1),gpu=new CreativeVideoRenderer(),cpu=new CreativeVideoRenderer({backend:'cpu'}),rows=[];
          const pixels=image=>{const c=document.createElement('canvas');c.width=127;c.height=95;const ctx=c.getContext('2d');ctx.fillStyle='#223344';ctx.fillRect(0,0,127,95);ctx.drawImage(image,0,0);return ctx.getImageData(0,0,127,95).data;};
          for(const count of [1,3,6])for(const threshold of [0,12,60])for(const amount of [35,100]){const s=validateCreativeVideoFx({preset:'VFX-34',amount,parameters:{count,threshold,trail:.7}}),frames=temporalVideoSamples(s,1).map(f=>({...f,source:make(f.time)}));gpu.beginFrame();cpu.beginFrame();const g=pixels(gpu.source(source,s,1,frames)),c=pixels(cpu.source(source,s,1,frames)),d=Array.from(g,(v,i)=>Math.abs(v-c[i])).sort((a,b)=>a-b);rows.push({count,threshold,amount,gpu:!!gpu.smear?.gl,mean:d.reduce((a,b)=>a+b)/d.length,p99:d[Math.floor(d.length*.99)],max:d.at(-1)});}return rows;
        }''')
        for row in result:
            with self.subTest(**row):self.assertTrue(row['gpu'],row);self.assertLessEqual(row['mean'],.8,row);self.assertLessEqual(row['p99'],4,row)
        (Path(__file__).resolve().parents[1]/'.local/motion-smear-parity.json').write_text(json.dumps(result,indent=2),encoding='utf-8')

    def test_motion_mask_preserves_static_region_and_stationary_frames(self):
        result=self.page.evaluate('''()=>{
          const make=x=>{const c=document.createElement('canvas');c.width=128;c.height=72;const ctx=c.getContext('2d');ctx.fillStyle='#173957';ctx.fillRect(0,0,128,72);ctx.fillStyle='#efb03d';ctx.fillRect(x,20,16,32);return c;},source=make(90),past=make(30),s=validateCreativeVideoFx({preset:'VFX-34',parameters:{count:1,threshold:5,trail:.5}}),r=new CreativeVideoRenderer();r.beginFrame();const output=r.source(source,s,1,[{source:past,weight:1}]),original=source.getContext('2d').getImageData(0,0,128,72).data,changed=output.getContext('2d').getImageData(0,0,128,72).data;
          let staticMax=0,echo=0;for(let y=0;y<72;y++)for(let x=0;x<128;x++)for(let k=0;k<4;k++){const at=(y*128+x)*4+k,d=Math.abs(changed[at]-original[at]);if(x<20)staticMax=Math.max(staticMax,d);if(x>=30&&x<46&&y>=20&&y<52)echo+=d;}
          r.beginFrame();const still=r.source(source,s,1,[{source:make(90),weight:1}]).getContext('2d').getImageData(0,0,128,72).data;const stillMax=Math.max(...Array.from(still,(v,i)=>Math.abs(v-original[i])));
          return {staticMax,echo,stillMax,zero:r.source(source,{...s,amount:0},1,[{source:past}])===source,off:r.source(source,{...s,enabled:false},1,[{source:past}])===source,threshold:r.source(source,{...s,parameters:{...s.parameters,threshold:100}},1,[{source:past}])===source,trail:r.source(source,{...s,parameters:{...s.parameters,trail:0}},1,[{source:past}])===source,noFrame:r.source(source,s,1)===source};
        }''')
        self.assertLessEqual(result['staticMax'],1);self.assertLessEqual(result['stillMax'],1);self.assertGreater(result['echo'],1000)
        self.assertTrue(all(result[k] for k in ['zero','off','threshold','trail','noFrame']))

    def test_every_control_changes_output_seek_repeats_and_contact_sheet(self):
        result=self.page.evaluate('''()=>{
          const make=t=>{const c=document.createElement('canvas');c.width=240;c.height=135;const ctx=c.getContext('2d');ctx.fillStyle='#193b58';ctx.fillRect(0,0,240,135);ctx.fillStyle='#dfa748';ctx.fillRect(12+t*130,24,28,76);ctx.fillStyle='rgba(60,205,165,.7)';ctx.fillRect(185,15+t*50,30,26);return c;},r=new CreativeVideoRenderer(),s=validateCreativeVideoFx({preset:'VFX-34'}),render=(settings,t)=>{r.beginFrame();return r.source(make(t),settings,t,temporalVideoSamples(settings,t).map(f=>({...f,source:make(f.time)})));},base=render(s,1).toDataURL(),controls=[];
          for(const [key,value] of [['count',1],['trail',.8],['threshold',80]]){const next=copyProject(s);next.parameters[key]=value;controls.push({key,changed:render(next,1).toDataURL()!==base});}controls.push({key:'amount',changed:render({...s,amount:30},1).toDataURL()!==base});render(s,1.5);const repeat=render(s,1).toDataURL()===base;
          const sheet=document.createElement('canvas');sheet.width=960;sheet.height=350;const ctx=sheet.getContext('2d');ctx.fillStyle='#141e38';ctx.fillRect(0,0,960,350);const variants=[{count:1,trail:.35},{count:3,trail:.35},{count:6,trail:.35},{count:6,trail:.8},{count:6,threshold:0},{count:6,threshold:50},{count:6,threshold:90},{count:6,threshold:100}],images=[];
          variants.forEach((p,i)=>{const next=validateCreativeVideoFx({preset:'VFX-34',parameters:p}),image=render(next,1),x=i%4*240,y=Math.floor(i/4)*175;images.push(image.toDataURL());ctx.fillStyle='#ccd5e2';ctx.font='13px Arial';ctx.fillText(next.parameters.count+' örnek · '+next.parameters.trail+' sn · eşik '+next.parameters.threshold+'%',x+8,y+24);ctx.drawImage(image,x,y+36);});return {controls,repeat,distinct:new Set(images).size,sheet:sheet.toDataURL().split(',')[1]};
        }''')
        self.assertTrue(result['repeat']);self.assertGreaterEqual(result['distinct'],7)
        for control in result['controls']:self.assertTrue(control['changed'],control)
        (Path(__file__).resolve().parents[1]/'.local/motion-smear-contact-sheet.png').write_bytes(base64.b64decode(result['sheet']))

    def test_actual_context_loss_restore_and_upload_failure_use_the_cpu_fallback(self):
        result=self.page.evaluate('''async()=>{
          const make=x=>{const c=document.createElement('canvas');c.width=96;c.height=72;const ctx=c.getContext('2d');ctx.fillStyle='rgba(20,70,120,.4)';ctx.fillRect(0,0,96,72);ctx.fillStyle='rgba(220,160,60,.8)';ctx.fillRect(x,20,20,32);return c;},source=make(60),past=make(20),r=new CreativeVideoRenderer(),s=validateCreativeVideoFx({preset:'VFX-34'}),frames=[{source:past,weight:1}],read=()=>{r.beginFrame();return r.source(source,s,1,frames).getContext('2d').getImageData(0,0,96,72).data.slice();},first=read(),engine=r.smear,extension=engine.gl?.getExtension('WEBGL_lose_context');if(!extension)return {supported:false};
          const lost=new Promise(resolve=>engine.surface.addEventListener('webglcontextlost',resolve,{once:true}));extension.loseContext();await lost;const fallback=!engine.gl,cpu=read();let sum=0;for(let i=0;i<first.length;i++)sum+=Math.abs(first[i]-cpu[i]);
          const restored=new Promise(resolve=>engine.surface.addEventListener('webglcontextrestored',resolve,{once:true}));await new Promise(resolve=>setTimeout(resolve,0));extension.restoreContext();await Promise.race([restored,new Promise((_,reject)=>setTimeout(()=>reject(new Error('GPU restore timed out')),10000))]);const again=read(),repeat=again.every((v,i)=>v===first[i]);
          engine.gl.texImage2D=()=>{throw new Error('forced upload failure')};const failed=read(),reference=new CreativeVideoRenderer({backend:'cpu'}).source(source,s,1,frames).getContext('2d').getImageData(0,0,96,72).data;return {supported:true,fallback,mean:sum/first.length,repeat,uploadFallback:!engine.gl&&failed.every((v,i)=>v===reference[i])};
        }''')
        self.assertTrue(result['supported']);self.assertTrue(result['fallback']);self.assertLessEqual(result['mean'],.8);self.assertTrue(result['repeat']);self.assertTrue(result['uploadFallback'])

    def test_authoring_drafts_curves_integer_samples_custom_copy_history_and_layout(self):
        with self.workspace.open_visual_layers():
            self.page.evaluate('videoClipEditor.select(projectStore.state.videoClips[0].id)');self.show('#creativeVideoPresets');panel=self.page.locator('#creativeVideoPresets');panel.locator('[data-preset="VFX-34"]').click()
            history=self.page.evaluate('projectStore.past.length');slider=panel.locator('input[type=range][data-fx-parameter="trail"]');slider.evaluate("e=>{e.value=.65;e.dispatchEvent(new Event('input',{bubbles:true}));}")
            self.assertEqual(self.page.evaluate('videoPreview.creativeFxDraft.videoClips[0].creativeFx.parameters.trail'),.65);slider.dispatch_event('pointercancel');self.assertEqual(self.page.evaluate('projectStore.past.length'),history)
            number=panel.locator('input[type=number][data-fx-parameter="trail"]');number.fill('.65');number.press('Tab');self.assertEqual(self.page.evaluate('projectStore.past.length'),history+1)
            threshold=panel.locator('input[type=number][data-fx-parameter="threshold"]');threshold.fill('25.5');threshold.press('Tab');self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.parameters.threshold'),25.5)
            self.page.evaluate('projectStore.undo()');self.assertEqual(threshold.input_value(),'12');self.page.evaluate('projectStore.redo()')
            panel.locator('.fx-keys').evaluate('(e)=>e.open=true');self.assertFalse(panel.locator('.fx-key-param option[value="count"]').count());self.assertTrue(panel.locator('.fx-key-param option[value="threshold"]').count())
            panel.locator('.fx-key-param').select_option('trail');panel.locator('.fx-key-time').fill('.5');panel.locator('.fx-key-value').fill('.1');panel.locator('.fx-key-add').click()
            self.assertEqual(self.page.evaluate('projectStore.state.videoClips[0].creativeFx.automation.trail[0][1]'),.1)
            panel.locator('.fx-save-name').fill('Hareket izim');panel.locator('.fx-save').click();self.assertEqual(self.page.evaluate('videoPresetBrowser.library.custom[0].settings.automation'),{})
            panel.locator('.fx-target').select_option('scene');panel.locator('[data-preset="VFX-34"]').click();self.assertEqual(self.page.evaluate('projectStore.state.video.creativeFx.preset'),'VFX-34')
            for theme in ('dark','light'):
                self.page.emulate_media(color_scheme=theme)
                for width in (320,375,768,1024,1440):
                    self.page.set_viewport_size(dict(width=width,height=900));self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),width)
            self.page.evaluate('projectStore.update(p=>{p.video.groupLocked=true;})');self.assertTrue(panel.locator('[data-preset="VFX-34"]').is_disabled())

    def test_actual_seek_repeat_maximum_portrait_color_comparison_and_render_budget(self):
        self.load_video()
        self.page.evaluate("projectStore.update(p=>{p.output.aspect='9:16';p.output.resolution='720';p.video.creativeFx=validateCreativeVideoFx({preset:'VFX-34',parameters:{count:6,trail:1.5,threshold:0}});});audioEngine.seekProjectTime(1.3)")
        settled='videoPreview.temporalSettled()&&!videoPreview.temporalPending&&!videoPreview.video.seeking'
        wait_for_browser(self.page,settled);first=self.page.evaluate('videoPreview.canvas.toDataURL()')
        self.page.evaluate('audioEngine.seekProjectTime(.3);videoPreview.draw();audioEngine.seekProjectTime(1.3);videoPreview.draw()');wait_for_browser(self.page,settled)
        self.assertEqual(self.page.evaluate('videoPreview.canvas.toDataURL()'),first)
        self.page.evaluate('videoPreview.temporalFrames.clear();videoPreview.temporalReady=null;videoPreview.draw()');wait_for_browser(self.page,settled)
        self.assertEqual(self.page.evaluate('videoPreview.canvas.toDataURL()'),first)
        self.page.evaluate("videoPreview.colorDraft={clipId:null,color:validateClipColor({enabled:true,brightness:.2})};videoPreview.colorComparison={clipId:null,position:.5};videoPreview.draw()")
        wait_for_browser(self.page,settled)
        comparison=self.page.evaluate('''()=>{const r=videoPreview.temporalReady.result;return {before:r.globalBefore.length,after:r.global.length,different:r.globalBefore[0].source.toDataURL()!==r.global[0].source.toDataURL()};}''')
        self.assertEqual(comparison,dict(before=6,after=6,different=True))
        self.page.evaluate('videoPreview.colorComparison=null;videoPreview.colorDraft=null;videoPreview.draw()');wait_for_browser(self.page,settled)
        result=self.page.evaluate('''()=>({history:videoPreview.temporalReady.result.global.length,bytes:videoPreview.temporalFrames.media.bytes,decoders:videoPreview.temporalFrames.media.decoders.size,gpu:!!videoPreview.renderer.creative.smear.gl,temporalMs:videoPreview.stats().temporalMs,width:videoPreview.canvas.width,height:videoPreview.canvas.height,png:videoPreview.canvas.toDataURL().split(',')[1]})''')
        self.assertTrue(result['gpu']);self.assertEqual(result['history'],6);self.assertLessEqual(result['bytes'],64*1024*1024);self.assertLessEqual(result['decoders'],4);self.assertAlmostEqual(result['width']/result['height'],9/16,delta=.01)
        result['colorComparison']=comparison;root=Path(__file__).resolve().parents[1]/'.local';(root/'motion-smear-max-portrait.png').write_bytes(base64.b64decode(result.pop('png')))
        result['kernel']=self.page.evaluate('''()=>{
          const make=i=>{const c=document.createElement('canvas');c.width=1280;c.height=720;const ctx=c.getContext('2d');ctx.fillStyle='#16395a';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#e8b23d';ctx.fillRect(100+i*100,80,160,560);return c;},source=make(6),frames=Array.from({length:6},(_,i)=>({source:make(5-i),weight:motionSmearHistoryWeight(i,6)})),s=validateCreativeVideoFx({preset:'VFX-34',parameters:{count:6,threshold:0}}),gpu=new CreativeVideoRenderer(),cpu=new CreativeVideoRenderer({backend:'cpu'}),times={gpu:[],cpu:[]};
          for(const [key,r] of [['gpu',gpu],['cpu',cpu]])for(let i=0;i<4;i++){r.beginFrame();const start=performance.now(),image=r.source(source,s,1,frames);image.getContext('2d').getImageData(0,0,1,1);if(i)times[key].push(performance.now()-start);}
          return {gpu:!!gpu.smear.gl,cpu:!cpu.smear.gl,textures:gpu.smear.textures.length,gpuMs:times.gpu,cpuMs:times.cpu,gpuMedian:times.gpu.sort((a,b)=>a-b)[1],cpuMedian:times.cpu.sort((a,b)=>a-b)[1]};
        }''')
        self.assertTrue(result['kernel']['gpu'] and result['kernel']['cpu']);self.assertEqual(result['kernel']['textures'],7)
        (root/'motion-smear-profile.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        self.page.evaluate('projectStore.update(p=>{p.video.creativeFx.parameters.threshold=100;})');wait_for_browser(self.page,'!videoPreview.temporalPending&&videoPreview.temporalRenderedTime===null&&videoPreview.temporalFrames.media.decoders.size===0')
        self.assertNotEqual(self.page.evaluate('videoPreview.canvas.toDataURL()'),first)
