import unittest
import io
import tempfile
from pathlib import Path
import numpy as np
from pedalboard.io import AudioFile
import engine
from audio_render import render_project_audio
from project_package import build_package, unpack_package
from project import validate_project, track_audible
from audio_controls import apply_channel_controls
from audio_routing import AudioRoutingProcessor


def routing_project(kind='delay'):
    source = dict(name='source.wav', size=100, lastModified=0, duration=1)
    return validate_project(dict(version=1, tracks=dict(main=dict(source=source), rain=dict(
        source=source, bus='group', pan=1, sends=dict(aux=50))),
        audioBuses=[dict(id='group',name='Group',volume=50,pan=-1,sends=dict(aux=50))],
        audioReturns=[dict(id='aux',name='Wet',type=kind,delayTime=.05,feedback=50,decay=.1,predelay=.01)]))


class AudioRoutingTests(unittest.TestCase):
    def test_package_and_real_mix_preserve_group_level_pan_and_shared_delay(self):
        p=routing_project();p['effects'].update(speed=1,reverb=0);p['master']['ceiling']=0
        for track in p['tracks'].values():track.update(loop=False,fadeIn=0,fadeOut=0)
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);files={}
            for kind in ['main','rain']:
                path=root/(kind+'.wav');samples=np.zeros((2,44100),np.float32)
                if kind=='rain':samples[:,4410]=[.2,.1]
                with AudioFile(str(path),'w',44100,2,bit_depth=24) as handle:handle.write(samples)
                files[kind]=str(path);p['tracks'][kind]['source'].update(name=path.name,size=path.stat().st_size)
            archive=io.BytesIO();build_package(archive,p,{f'media/{k}':v for k,v in files.items()});archive.seek(0);(root/'opened').mkdir()
            opened,_=unpack_package(archive,root/'opened');self.assertEqual(opened,validate_project(p))
            mixed=render_project_audio(p,files,str(root),engine._ffmpeg_bin(),lambda data,_:data)
            with AudioFile(mixed) as handle:samples=handle.read(handle.frames)
            np.testing.assert_allclose(samples[:,4410],[.15,0],atol=2e-5)
            np.testing.assert_allclose(samples[:,6615],[.075,.15],atol=2e-5)

    def test_post_fader_sends_wet_only_delay_and_stream_continuity(self):
        p=routing_project(); sr=44100
        source=np.zeros((2,22050),np.float32);source[:,20]=[.2,.1]
        source=apply_channel_controls(source,p['tracks']['rain'],np.arange(source.shape[1])/sr)
        result=AudioRoutingProcessor(p,sr).process(dict(rain=source),0,source.shape[1])
        np.testing.assert_allclose(result[:,20],[.15,0],atol=1e-7)
        np.testing.assert_allclose(result[:,2225],[.075,.15],atol=1e-7)
        np.testing.assert_allclose(result[:,4558],[.0375,.075],atol=1e-7)
        for kind in ['delay','reverb']:
            p['audioReturns'][0]['type']=kind
            p['audioBuses'][0]['effectChain']['eq'][1]['gain']=6
            expected=AudioRoutingProcessor(p,sr).process(dict(rain=source),0,source.shape[1])
            processor=AudioRoutingProcessor(p,sr)
            chunks=[processor.process(dict(rain=source[:,first:first+257]),first,min(257,source.shape[1]-first)) for first in range(0,source.shape[1],257)]
            np.testing.assert_allclose(np.concatenate(chunks,axis=1),expected,atol=2e-7)

    def test_group_solo_mute_and_strict_references(self):
        p=routing_project();p['audioBuses'][0]['solo']=True
        self.assertTrue(track_audible(p,'rain'));self.assertFalse(track_audible(p,'main'))
        p['audioBuses'][0]['muted']=True;self.assertFalse(track_audible(p,'rain'))
        p=routing_project();p['tracks']['rain']['sends']['missing']=10
        with self.assertRaises(ValueError):validate_project(p)
        p=routing_project();p['audioReturns'][0]['automation']={'cutoff':[[0,100]]}
        with self.assertRaises(ValueError):validate_project(p)
