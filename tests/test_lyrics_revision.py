import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
import sys
from unittest.mock import patch, MagicMock

if 'faster_whisper' not in sys.modules:
    fw = MagicMock()
    fw_audio = MagicMock()
    fw.audio = fw_audio
    sys.modules['faster_whisper'] = fw
    sys.modules['faster_whisper.audio'] = fw_audio

import numpy as np
import requests

import app
import lyric_search
from lyric_alignment import align_reference
from lyrics import repair_lines, validate_lines
from project import SCHEMA
from transcription_worker import transcribe


class RevisionTests(unittest.TestCase):
    def test_review_acknowledgment_roundtrip_and_repair(self):
        row=dict(id='a',text='Reviewed',start=1,end=3,confidence=.4,review=False,reviewed=True)
        self.assertTrue(validate_lines([row],SCHEMA['lyricLimits'])[0]['reviewed'])
        self.assertTrue(repair_lines([row],5)[0]['reviewed'])
        self.assertNotIn('reviewed',repair_lines([row],2)[0])
        with self.assertRaises(ValueError):validate_lines([dict(row,reviewed='yes')],SCHEMA['lyricLimits'])

    def test_repair_preserves_invalid_rows_and_orders_valid_cues(self):
        rows = [dict(id='late',text='Late',start=8,end=20), dict(id='first',text='First',start=-1,end=9),
                dict(id='bad',text='Keep this',start=11,end=12)]
        result=validate_lines(repair_lines(rows,10),SCHEMA['lyricLimits'])
        self.assertEqual([(r['start'],r['end']) for r in result],[(0,8),(8,10),(None,None)])
        self.assertTrue(all(r['review'] for r in result))
        result=validate_lines(repair_lines([dict(id='numpy',text='Model timing',start=np.float64(1.2),end=np.float32(2.5))],10),SCHEMA['lyricLimits'])
        self.assertEqual(result[0]['start'],1.2)
        self.assertEqual(type(result[0]['end']),float)

    def test_reference_alignment_keeps_text_and_unmatched_rows(self):
        rows=[dict(id='a',text='Işıklar yanar',start=None,end=None),dict(id='b',text='Eksik bir satır',start=None,end=None),
              dict(id='c',text='Yeniden ışıklar',start=None,end=None)]
        words=[dict(word=w,start=t,end=t+.4,probability=.9) for w,t in [('ışıklar',1),('yanar',2),('yeniden',8),('ışıklar',9)]]
        result=validate_lines(align_reference(rows,words,12),SCHEMA['lyricLimits'])
        by_id={r['id']:r for r in result}
        self.assertEqual(by_id['a']['text'],'Işıklar yanar')
        self.assertEqual(by_id['a']['start'],1)
        self.assertEqual(by_id['c']['end'],9.4)
        self.assertIsNone(by_id['b']['start'])
        self.assertTrue(all(r['review'] for r in result))

    def test_all_audio_windows_and_last_window_are_processed(self):
        calls=[]
        def recognize(chunk,**options):
            calls.append((len(chunk),options))
            word=SimpleNamespace(word=' Merhaba',start=3,end=4,probability=.8)
            segment=SimpleNamespace(words=[word],start=3,end=4,text=' Merhaba',no_speech_prob=.9,avg_logprob=-.7,compression_ratio=4)
            return iter([segment]),SimpleNamespace(language='tr')
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)/'result.json'
            with patch('transcription_worker.prepare',return_value=SimpleNamespace(transcribe=recognize)), patch('faster_whisper.audio.decode_audio',return_value=np.ones(70*16000,np.float32)*.01),patch('transcription_worker.emit'):
                transcribe('source','large-v3-turbo','tr',output)
            result=json.loads(output.read_text(encoding='utf-8'))
            self.assertEqual(result['analyzedSeconds'],70)
            self.assertEqual(result['windows'],3)
            self.assertEqual(len(calls),3)
            self.assertTrue(all(not options['vad_filter'] for _,options in calls))
            self.assertEqual([r['start'] for r in result['lines']],[3,25,49])
            self.assertTrue(all(r['review'] for r in result['lines']))

    def test_lrclib_rank_timeout_and_validation(self):
        lyric_search._CACHE.clear()
        records=[dict(id=1,trackName='Song live',artistName='Artist',duration=300,syncedLyrics='[00:01]live'),
                 dict(id=2,trackName='Song',artistName='Artist',duration=200,plainLyrics='Words',syncedLyrics='[00:01]Words')]
        class Response:
            status_code=200
            def __enter__(self):return self
            def __exit__(self,*_):pass
            def iter_content(self,*_):yield json.dumps(records).encode()
        with patch('lyric_search.requests.get',return_value=Response()) as get:
            result=lyric_search.search('Song','Artist',201)
            self.assertEqual(result[0]['id'],2)
            self.assertTrue(result[0]['closeMatch'])
            self.assertEqual(result[0]['difference'],-1)
            self.assertEqual(get.call_args.args[0],'https://lrclib.net/api/search')
            lyric_search.search('Song','Artist',201)
            self.assertEqual(get.call_count,1)
        client=app.app.test_client()
        self.assertEqual(client.get('/api/lyrics/search?track=Song&duration=nan').status_code,400)
        with patch('lyric_search.requests.get',side_effect=requests.Timeout('timeout')):
            self.assertEqual(client.get('/api/lyrics/search?track=Uncached').status_code,502)


if __name__=='__main__':unittest.main()
