"""Validate browser-authored ripple edits against actual export mixer samples."""
import json
from pathlib import Path
import shutil
import subprocess
import unittest

import numpy as np

from audio_render import SAMPLE_RATE, track_block
from project import validate_project


@unittest.skipUnless(shutil.which('node'), 'Node required for authored-project parity.')
class RippleExportTests(unittest.TestCase):
    def test_authored_ripple_audio_matches_removed_and_inserted_samples(self):
        root=Path(__file__).resolve().parents[1]
        script="""const fs=require('fs'),vm=require('vm');
          const schema=fs.readFileSync('static/project-schema.json','utf8');
          const c=vm.createContext({EventTarget,Event,crypto:require('crypto').webcrypto,window:{},document:{getElementById:()=>({textContent:schema})}});
          for(const file of ['project','parameter-curves','editing','main-editing','lyrics','ripple-editing'])
            vm.runInContext(fs.readFileSync('static/js/'+file+'.js','utf8'),c);
          process.stdout.write(vm.runInContext(`
            const source={name:'sample.wav',size:1,lastModified:0,duration:5};
            const before=validateProject({version:1,effects:{speed:1},tracks:{main:{source},
              rain:{source:{...source,duration:2},offset:.25,phase:.25,loop:true,fadeIn:1,fadeOut:1,
                automation:{volume:[[0,20,{type:'bezier',control:[.8,.1,.2,.9]}],[5,180]],pan:[[0,-.5,{type:'smooth'}],[5,.5]]}}}});
            const projects=['remove','insert'].map(operation=>{
              const p=copyProject(before);applyRippleEdit(p,new Map(),{operation,start:1,end:2,
                lanes:{main:true,audio:['rain'],automation:['rain']}});return validateProject(p);
            });JSON.stringify({before,projects});`,c));"""
        result=subprocess.run(['node','-e',script],cwd=root,text=True,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)
        data=json.loads(result.stdout)
        before=validate_project(data['before'])
        count=SAMPLE_RATE*5
        samples=np.tile(np.sin(np.arange(SAMPLE_RATE*2,dtype=np.float64)*.015).astype(np.float32)*.1,(2,1))
        baseline=track_block(samples,before['tracks']['rain'],count,0,count)
        expected=[np.concatenate((baseline[:,:SAMPLE_RATE],baseline[:,2*SAMPLE_RATE:]),axis=1),
                  np.concatenate((baseline[:,:SAMPLE_RATE],np.zeros((2,SAMPLE_RATE)),baseline[:,SAMPLE_RATE:]),axis=1)]
        for raw,target in zip(data['projects'],expected):
            with self.subTest(frames=target.shape[1]):
                project=validate_project(raw)
                frames=target.shape[1]
                output=sum(track_block(samples,track,frames,0,frames) for key,track in project['tracks'].items()
                           if key!='main' and track['source'])
                np.testing.assert_allclose(output,target,atol=1e-7,rtol=1e-6)
