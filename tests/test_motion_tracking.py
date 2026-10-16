import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image
from scipy.io import wavfile
from app import app, MEDIA_SLOT
import engine
import media_assets
from motion_tracking import track_translation, decode_tracking_frames
from overlay_assets import prepare_overlay, overlay_path
from project import validate_project


class MotionTrackingTests(unittest.TestCase):
    def frames(self, count=16):
        pattern=np.random.default_rng(42).integers(40,240,size=(16,16),dtype=np.uint8)
        frames=np.zeros((count,96,128),dtype=np.uint8)
        for i,frame in enumerate(frames):frame[30+i:46+i,20+2*i:36+2*i]=pattern
        return frames

    def test_textured_translation_reverse_and_occlusion(self):
        frames=self.frames();times=np.arange(16)/10
        result=track_translation(frames,times,[20/128*100,30/96*100,12.5,16/96*100],20)
        self.assertIsNone(result['lostAt']);self.assertEqual(len(result['points']),16)
        for i,point in enumerate(result['points']):self.assertAlmostEqual(point[1],(28+2*i)/128*100,delta=.3);self.assertAlmostEqual(point[2],(38+i)/96*100,delta=.3)
        reverse=track_translation(frames[::-1],times[::-1],[50/128*100,45/96*100,12.5,16/96*100],20)
        self.assertAlmostEqual(reverse['points'][-1][1],28/128*100,delta=.3)
        frames[8:]=0;lost=track_translation(frames,times,[20/128*100,30/96*100,12.5,16/96*100],20)
        self.assertEqual(lost['lostAt'],.8);self.assertEqual(len(lost['points']),8)
        with self.assertRaises(ValueError):track_translation(np.zeros((2,96,128),dtype=np.uint8),[0,1],[10,10,20,20],20)

    def test_api_actual_source_timestamps_budget_busy_and_rendered_tracking_path(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(media_assets,'ASSET_DIR',Path(folder)/'assets'):
            root=Path(folder);video=root/'object.mp4';ffmpeg=engine._ffmpeg_bin();frames=self.frames(30)
            subprocess.run([ffmpeg,'-v','error','-f','rawvideo','-pix_fmt','gray','-s','128x96','-r','30','-i','pipe:0','-c:v','libx264','-crf','0','-pix_fmt','yuv420p','-threads','2',str(video)],input=frames.tobytes(),check=True)
            info=media_assets.prepare_asset(video,video.name,ffmpeg);body=dict(asset=info['asset'],start=0,end=1,rate=4,reverse=False,region=[20/128*100,30/96*100,12.5,16/96*100],search=20)
            client=app.test_client();response=client.post('/api/media/track',json=body);self.assertEqual(response.status_code,200,response.json);result=response.json
            self.assertEqual(len(result['points']),4);self.assertIsNone(result['lostAt'])
            for time,x,y,score in result['points']:
                self.assertAlmostEqual(x,(28+60*time)/128*100,delta=.4);self.assertAlmostEqual(y,(38+30*time)/96*100,delta=.4);self.assertGreater(score,.8)
            with MEDIA_SLOT:self.assertEqual(client.post('/api/media/track',json=body).status_code,429)
            for update in [dict(asset='../source'),dict(end=70),dict(rate=True),dict(region=[95,0,10,10]),dict(search=float('nan')),dict(extra=1)]:
                self.assertEqual(client.post('/api/media/track',json={**body,**update}).status_code,400)
            main=root/'main.wav';wavfile.write(main,44100,np.zeros(44100,dtype=np.int16));blob=io.BytesIO();Image.new('RGB',(16,16),'red').save(blob,format='PNG');overlay=prepare_overlay(blob.getvalue(),'dot.png')
            p=validate_project(dict(version=1,tracks=dict(main=dict(source=dict(name=main.name,size=main.stat().st_size,lastModified=0,duration=1),end=1)),effects=dict(speed=1,reverb=0),background=dict(asset=info['asset']),
                visualLayers=[dict(id='follower',type='image',asset=overlay['asset'],width=8,until=1,motionPath=dict(enabled=True,nodes=[[t,x-50,y-50,0,0,0,0,'linear','linear'] for t,x,y,_ in result['points']]))]))
            target=root/'follow.mp4';ok,message=engine.process_and_render(p,dict(main=str(main),background=str(media_assets.source_path(info['asset'])),visual_paths=dict(follower=overlay_path(overlay['asset']))),str(target));self.assertTrue(ok,message)
            for time in [0,.5]:
                raw=subprocess.run([ffmpeg,'-v','error','-ss',str(time),'-i',str(target),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],capture_output=True,check=True)
                frame=np.frombuffer(raw.stdout,dtype=np.uint8).reshape(96,128,3);y,x=np.where((frame[:,:,0]>180)&(frame[:,:,1]<50)&(frame[:,:,2]<50));self.assertGreater(len(x),40)
                self.assertAlmostEqual(x.mean(),28+60*time-.5,delta=1);self.assertAlmostEqual(y.mean(),38+30*time-.5,delta=1)
