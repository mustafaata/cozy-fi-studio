import copy
import json
import subprocess
import unittest
import tempfile
from pathlib import Path
import numpy as np
from pedalboard.io import AudioFile
import engine
from audio_render import render_project_audio
from project import validate_project
from audio_dynamics import DynamicsProcessor


class AudioDynamicsTests(unittest.TestCase):
    def test_real_output_applies_track_compression_then_group_limiter(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'source.wav'
            with AudioFile(str(path),'w',44100,2,bit_depth=24) as handle:handle.write(np.full((2,44100),.8,np.float32))
            p=validate_project(dict(version=1,effects=dict(speed=1,reverb=0),master=dict(ceiling=0),tracks=dict(main=dict(
                source=dict(name=path.name,size=path.stat().st_size,lastModified=0,duration=1),bus='group',fadeIn=0,fadeOut=0,
                dynamics=dict(compressor=dict(enabled=True,threshold=-20,ratio=4,knee=0,attack=1,makeup=12)))),
                audioBuses=[dict(id='group',name='Group',dynamics=dict(limiter=dict(enabled=True,ceiling=-6)))]))
            result=render_project_audio(p,dict(main=str(path)),folder,engine._ffmpeg_bin(),lambda samples,_:samples)
            with AudioFile(result) as handle:samples=handle.read(handle.frames)
            self.assertLessEqual(float(np.max(np.abs(samples))),10**(-6/20)+1e-6)
            self.assertAlmostEqual(float(samples[0,-100]),10**(-6/20),places=5)

    def settings(self, **stages):
        return validate_project(dict(version=1,tracks=dict(main=dict(dynamics=stages))))['tracks']['main']['dynamics']

    def test_strict_controls_legacy_defaults_and_peak_limit(self):
        neutral=self.settings();self.assertFalse(any(stage['enabled'] for stage in neutral.values()))
        for bad in [dict(compressor=None),dict(compressor=dict(ratio=0)),dict(gate=dict(enabled=1)),dict(limiter=dict(ceiling=1)),dict(unknown={}),dict(compressor=dict(attack=float('nan')))]:
            with self.subTest(bad=bad),self.assertRaises(ValueError):self.settings(**bad)
        source=np.random.default_rng(10).normal(0,2,(2,20000)).astype(np.float32)
        processor=DynamicsProcessor(self.settings(limiter=dict(enabled=True,ceiling=-3)),44100)
        result=processor.process(source)
        self.assertLessEqual(np.max(np.abs(result)),10**(-3/20)+1e-7)
        self.assertGreater(processor.reduction['limiter'],10)
        np.testing.assert_array_equal(DynamicsProcessor(neutral,44100).process(source),source)

    def test_compressor_settling_gate_hold_and_block_continuity(self):
        settings=self.settings(compressor=dict(enabled=True,threshold=-20,ratio=4,knee=0,attack=1,release=50))
        source=np.full((2,44100),.8,np.float32)
        result=DynamicsProcessor(settings,44100).process(source)
        self.assertAlmostEqual(float(result[0,-1]),.8*10**((-20-20*np.log10(.8))*.75/20),places=6)
        settings=self.settings(gate=dict(enabled=True,threshold=-30,range=-80,hold=10,attack=1,release=5),compressor=dict(enabled=True),limiter=dict(enabled=True))
        source=np.zeros((2,30000),np.float32);source[:,:5000]=.5;source[:,5000:]=.001
        full=DynamicsProcessor(settings,44100).process(source)
        processor=DynamicsProcessor(settings,44100)
        split=np.concatenate([processor.process(source[:,first:first+173]) for first in range(0,source.shape[1],173)],axis=1)
        np.testing.assert_array_equal(split,full)
        self.assertLess(abs(full[0,-1]),1e-6)

    def test_javascript_dsp_matches_export_sample_for_sample(self):
        settings=self.settings(gate=dict(enabled=True,hold=3),compressor=dict(enabled=True,knee=12,makeup=5),limiter=dict(enabled=True,ceiling=-2))
        samples=np.random.default_rng(12).normal(0,.5,(2,12000)).astype(np.float32);samples[:,4000:8000]*=.001
        script="""const fs=require('node:fs'),vm=require('node:vm'),value=JSON.parse(fs.readFileSync(0,'utf8'));vm.runInThisContext(fs.readFileSync('static/js/sidechain-dsp.js','utf8'));vm.runInThisContext(fs.readFileSync('static/js/dynamics-dsp.js','utf8'));const dsp=new DynamicsDSP(44100);dsp.configure(value.settings);const input=value.samples.map(x=>new Float32Array(x)),output=input.map(x=>new Float32Array(x.length));dsp.process(input,output);process.stdout.write(JSON.stringify(output.map(x=>Array.from(x))));"""
        result=subprocess.run(['node','-e',script],input=json.dumps(dict(settings=settings,samples=samples.tolist())),text=True,capture_output=True,check=True)
        expected=DynamicsProcessor(settings,44100).process(samples)
        np.testing.assert_allclose(json.loads(result.stdout),expected,atol=6e-8)
