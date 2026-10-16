"""All final video algorithms render in the studio, including source alpha and local clocks."""
import base64
from pathlib import Path
import unittest
from browser_helpers import wait_for_browser
import test_temporal_video_ui as temporal_ui

class FinishVideoUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):temporal_ui.TemporalVideoUI.setUpClass.__func__(cls)
    @classmethod
    def tearDownClass(cls):temporal_ui.TemporalVideoUI.tearDownClass.__func__(cls)
    setUp=temporal_ui.TemporalVideoUI.setUp
    tearDown=temporal_ui.TemporalVideoUI.tearDown
    load_video=temporal_ui.TemporalVideoUI.load_video

    def test_all_fifteen_distinct_bypass_seek_and_contact_sheet(self):
        result=self.page.evaluate('''()=>{
          const src=document.createElement('canvas');src.width=240;src.height=135;const c=src.getContext('2d'),g=c.createLinearGradient(0,0,240,135);g.addColorStop(0,'#182d57');g.addColorStop(.5,'#f8c568');g.addColorStop(1,'#e04679');c.fillStyle=g;c.fillRect(0,0,240,135);c.fillStyle='#171727';c.fillRect(70,30,60,75);c.fillStyle='white';c.fillRect(170,40,20,40);
          const r=new CreativeVideoRenderer(),sheet=document.createElement('canvas');sheet.width=1200;sheet.height=525;const ctx=sheet.getContext('2d');ctx.fillStyle='#141e38';ctx.fillRect(0,0,1200,525);const rows=[];
          for(let j=36;j<=50;j++){const s=validateCreativeVideoFx({preset:'VFX-'+j}),read=()=>{r.beginFrame();return r.source(src,s,.37,[],0);},image=read(),png=image.toDataURL();r.beginFrame();r.source(src,s,2);const repeat=read().toDataURL()===png;rows.push({id:s.preset,changed:png!==src.toDataURL(),repeat,off:r.source(src,{...s,enabled:false},.37)===src,zero:r.source(src,{...s,amount:0},.37)===src,png});const x=(j-36)%5*240,y=Math.floor((j-36)/5)*175;ctx.fillStyle='#ccd5e2';ctx.font='14px Arial';ctx.fillText(PROJECT_SCHEMA.creativeVideoPresets[j-1].name,x+8,y+24);ctx.drawImage(read(),x,y+36);}
          return {rows:rows.map(({png,...row})=>row),distinct:new Set(rows.map(r=>r.png)).size,sheet:sheet.toDataURL().split(',')[1]};
        }''')
        self.assertEqual(result['distinct'],15)
        for row in result['rows']:self.assertTrue(row['changed'] and row['repeat'] and row['off'] and row['zero'],row)
        (Path(__file__).resolve().parents[1]/'.local/finish-video-contact-sheet.png').write_bytes(base64.b64decode(result['sheet']))

    def test_reveals_start_at_exposure_zero_finish_and_preserve_transparent_alpha(self):
        result=self.page.evaluate('''()=>{
          const src=document.createElement('canvas');src.width=64;src.height=64;const c=src.getContext('2d');c.fillStyle='rgba(240,130,60,.5)';c.fillRect(0,0,64,64);const r=new CreativeVideoRenderer(),rows=[];
          for(const id of ['VFX-48','VFX-49','VFX-50']){const s=validateCreativeVideoFx({preset:id}),read=(time,start)=>{r.beginFrame();return r.source(src,s,time,[],start).getContext('2d').getImageData(0,0,64,64).data;},begin=read(3,3),end=read(10,3),local=read(.3,0),shift=read(3.3,3);rows.push({id,empty:begin.every(v=>v===0),alpha:Array.from(end).filter((_,i)=>i%4===3).every(a=>a===128),local:local.every((v,i)=>v===shift[i])});}return rows;
        }''')
        for row in result:self.assertTrue(row['empty'] and row['alpha'] and row['local'],row)

    def test_split_panel_uses_a_real_delayed_source_and_releases_at_zero(self):
        self.load_video();self.page.evaluate("projectStore.update(p=>{p.video.creativeFx=validateCreativeVideoFx({preset:'VFX-47',parameters:{delay:.3}});});audioEngine.seekProjectTime(.7)")
        wait_for_browser(self.page,'videoPreview.temporalSettled()&&!videoPreview.temporalPending')
        self.assertAlmostEqual(self.page.evaluate('videoPreview.temporalReady.result.global[0].time'),.4,delta=1e-8)
        first=self.page.evaluate('videoPreview.canvas.toDataURL()')
        self.page.evaluate('audioEngine.seekProjectTime(1.3);videoPreview.draw();audioEngine.seekProjectTime(.7);videoPreview.draw()');wait_for_browser(self.page,'videoPreview.temporalSettled()&&!videoPreview.temporalPending')
        self.assertEqual(self.page.evaluate('videoPreview.canvas.toDataURL()'),first)
        self.page.evaluate('projectStore.update(p=>{p.video.creativeFx.parameters.delay=0;})');wait_for_browser(self.page,'!videoPreview.temporalPending&&videoPreview.temporalRenderedTime===null')
        self.assertNotEqual(self.page.evaluate('videoPreview.canvas.toDataURL()'),first)
