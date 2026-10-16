import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
from pedalboard.io import AudioFile
import engine
import media_assets
from project import validate_project,SCHEMA
from audio_spectral import apply_spectral,spectral_patch
from audio_render import render_project_audio
from project_package import build_package,unpack_package


class SpectralAudioTests(unittest.TestCase):
    def test_real_mp4_visual_analysis_uses_cleaned_source(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(media_assets,'ASSET_DIR',Path(folder)/'assets'):
            root=Path(folder);main=root/'main.wav';video=root/'black.mp4';ffmpeg=engine._ffmpeg_bin();t=np.arange(44100)/44100
            with AudioFile(str(main),'w',44100,2,bit_depth=24) as handle:handle.write(np.stack([.5*np.sin(2*np.pi*440*t)]*2).astype(np.float32))
            subprocess.run([ffmpeg,'-v','error','-f','lavfi','-i','color=c=black:s=96x64:r=24:d=1','-c:v','libx264','-threads','2',str(video)],check=True)
            info=media_assets.prepare_asset(video,video.name,ffmpeg)
            p=validate_project(dict(version=1,tracks=dict(main=dict(source=dict(name=main.name,size=main.stat().st_size,lastModified=0,duration=1),end=1,spectral=dict(enabled=True,start=0,end=1,regions=[dict(start=.5,end=1,low=200,high=800,gain=-80,feather=0)]))),effects=dict(speed=1,reverb=0),video=dict(vizType='none',bassEffects=[]),lyrics=dict(glowIntensity=0,bassEffects=[]),background=dict(asset=info['asset']),visualLayers=[dict(id='p',type='particles',width=100,until=1,particles=dict(style='snow',band='mid',size=25,density=300,reactivity=100,ratio=2/3))]))
            target=root/'cleaned.mp4';ok,message=engine.process_and_render(p,dict(main=str(main),background=str(media_assets.source_path(info['asset']))),str(target));self.assertTrue(ok,message)
            counts=[]
            for time in [.25,.92]:
                raw=subprocess.run([ffmpeg,'-v','error','-ss',str(time),'-i',str(target),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],capture_output=True,check=True);counts.append(int((np.frombuffer(raw.stdout,dtype=np.uint8)>40).sum()))
            self.assertGreater(counts[0],50);self.assertEqual(counts[1],0)

    def settings(self, **values):
        return validate_project(dict(version=1,tracks=dict(main=dict(spectral=values))))['tracks']['main']['spectral']

    def test_strict_regions_profile_bounds_and_source_limits(self):
        for invalid in [dict(end=121),dict(regions=[dict(start=.8,end=.2)]),dict(regions=[dict(low=1000,high=100)]),dict(noiseEnabled=True,profileStart=.9,profileEnd=1.1),dict(regions=[dict(gain=True)]),dict(enabled=1),dict(unknown=1)]:
            with self.subTest(invalid=invalid),self.assertRaises(ValueError):self.settings(**invalid)
        p=validate_project(dict(version=1,tracks=dict(main=dict(source=dict(name='a.wav',size=1,lastModified=0,duration=.5)))))
        p['tracks']['main']['spectral'].update(enabled=True,end=1)
        with self.assertRaises(ValueError):validate_project(p)

    def test_identity_selected_frequency_reduction_and_profile_preserve_other_audio(self):
        sr=44100;t=np.arange(sr*2)/sr
        samples=np.stack([.1*np.sin(2*np.pi*200*t)+.1*np.sin(2*np.pi*4000*t)]*2).astype(np.float32)
        neutral=self.settings(enabled=True,end=2);np.testing.assert_allclose(apply_spectral(samples,neutral,sr),samples,atol=1e-7)
        settings=self.settings(enabled=True,start=.5,end=1.5,regions=[dict(start=.5,end=1.5,low=3800,high=4200,gain=-40,feather=.01)])
        result=apply_spectral(samples,settings,sr)
        np.testing.assert_array_equal(result[:,:15000],samples[:,:15000]);np.testing.assert_array_equal(result[:,70000:],samples[:,70000:])
        def amplitude(data,frequency):return abs(np.mean(data[0,30000:50000]*np.exp(-2j*np.pi*frequency*t[30000:50000])))*2
        self.assertLess(amplitude(result,4000),.002);self.assertGreater(amplitude(result,200),.095)
        source=np.stack([.03*np.sin(2*np.pi*1000*t)+.2*np.sin(2*np.pi*200*t)*(t>.5)]*2).astype(np.float32)
        settings=self.settings(enabled=True,end=2,noiseEnabled=True,profileStart=0,profileEnd=.4,strength=1.2,floor=-40)
        result=apply_spectral(source,settings,sr)
        self.assertLess(amplitude(result,1000),.002);self.assertGreater(amplitude(result,200),.18)

    def test_browser_fft_processor_matches_python_for_noise_and_overlapping_regions(self):
        sr=44100;samples=np.random.default_rng(6).normal(0,.1,(2,22050)).astype(np.float32)
        settings=self.settings(enabled=True,end=.5,regions=[dict(start=.1,end=.4,low=200,high=3000,gain=-12,feather=.02),dict(start=.2,end=.3,low=1000,high=8000,gain=-9,feather=0)],noiseEnabled=True,profileStart=0,profileEnd=.05,strength=.7)
        first,expected=spectral_patch(samples,settings,sr)
        script="""const fs=require('node:fs'),vm=require('node:vm'),v=JSON.parse(fs.readFileSync(0,'utf8'));for(const name of ['audio-fft','spectral-audio'])vm.runInThisContext(fs.readFileSync('static/js/'+name+'.js','utf8'));const result=processSpectralAudio({...v,channels:v.channels.map(c=>new Float32Array(c))});process.stdout.write(JSON.stringify(result.channels.map(c=>Array.from(c))));"""
        response=subprocess.run(['node','-e',script],input=json.dumps(dict(channels=samples.tolist(),sampleRate=sr,origin=0,settings=settings,limits=SCHEMA['spectralLimits'])),text=True,capture_output=True,check=True)
        np.testing.assert_allclose(json.loads(response.stdout),expected,atol=3e-8)

    def test_package_and_main_montage_output_process_source_before_cut_tempo(self):
        sr=44100;t=np.arange(sr*2)/sr;samples=np.stack([.1*np.sin(2*np.pi*200*t)+.1*np.sin(2*np.pi*4000*t)]*2).astype(np.float32)
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'source.wav'
            with AudioFile(str(path),'w',sr,2,bit_depth=24) as handle:handle.write(samples)
            p=validate_project(dict(version=1,effects=dict(speed=1,reverb=0),master=dict(ceiling=0),tracks=dict(main=dict(source=dict(name=path.name,size=path.stat().st_size,lastModified=0,duration=2),fadeIn=0,fadeOut=0,spectral=dict(enabled=True,start=1,end=2,regions=[dict(start=1,end=2,low=3800,high=4200,gain=-40,feather=0)]))),mainClips=[dict(id='clip',start=1,end=2,offset=0)]))
            archive=io.BytesIO();build_package(archive,p,{'media/main':str(path)});archive.seek(0);(Path(folder)/'opened').mkdir();opened,_=unpack_package(archive,Path(folder)/'opened');self.assertEqual(opened,p)
            output=render_project_audio(p,dict(main=str(path)),folder,engine._ffmpeg_bin(),lambda data,_:data)
            with AudioFile(output) as handle:result=handle.read(handle.frames)
            expected=apply_spectral(samples,p['tracks']['main']['spectral'],sr)[:,sr:]
            np.testing.assert_allclose(result,expected,atol=1e-6)
