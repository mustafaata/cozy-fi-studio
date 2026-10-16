"""Word timing is a strict, source-time project contract, including ASR drafts."""
import copy
from types import SimpleNamespace
import unittest

from lyrics import repair_lines, validate_lines
from project import SCHEMA, validate_project
from transcription_worker import segment_lines


class LyricWordTests(unittest.TestCase):
    def row(self):
        return dict(id='one', text='İçimde ışık', start=1, end=4,
                    words=[dict(text='İçimde',start=1.2,end=2),dict(text='ışık',start=2.7,end=3.9)])

    def test_strict_word_contract_and_old_projects(self):
        row=self.row()
        self.assertEqual(validate_lines([row],SCHEMA['lyricLimits'])[0]['words'],row['words'])
        for update in [dict(text='Başka'),dict(start=True),dict(start=float('nan')),dict(start=.9),
                       dict(end=4.1),dict(end=1.2001)]:
            with self.subTest(update=update),self.assertRaises(ValueError):
                bad=copy.deepcopy(row);bad['words'][0].update(update);validate_lines([bad],SCHEMA['lyricLimits'])
        for words in [None,[],row['words'][::-1],row['words'][:1]]:
            with self.subTest(words=words),self.assertRaises(ValueError):
                validate_lines([dict(row,words=words)],SCHEMA['lyricLimits'])
        with self.assertRaises(ValueError):
            validate_lines([dict(row,start=None,end=None)],SCHEMA['lyricLimits'])
        del row['words']
        self.assertNotIn('words',validate_lines([row],SCHEMA['lyricLimits'])[0])
        p=validate_project(dict(version=1,tracks=dict(main={}),lyrics=dict(lines=[self.row()],wordAnimation='typewriter',wordEntrance=.24)))
        self.assertEqual(p,validate_project(p))
        unicode_row=dict(row,text='\ufeffBir\u0085iki\tson\ufeff',words=[dict(text='Bir\u0085iki',start=1,end=2),dict(text='son',start=3,end=4)])
        self.assertEqual(validate_lines([unicode_row],SCHEMA['lyricLimits'])[0]['text'],'Bir\u0085iki\tson')

    def test_repairs_preserve_relative_word_pauses(self):
        repaired=repair_lines([self.row()],3)[0]
        self.assertAlmostEqual(repaired['words'][0]['start'],1+.2*2/3)
        self.assertAlmostEqual(repaired['words'][1]['end'],1+2.9*2/3)
        self.assertEqual(validate_lines([repaired],SCHEMA['lyricLimits'])[0]['words'],repaired['words'])
        self.assertNotIn('words',repair_lines([self.row()],.5)[0])

    def test_transcription_pieces_retain_word_pauses_and_punctuation(self):
        segment=SimpleNamespace(no_speech_prob=.1,compression_ratio=1,avg_logprob=-.3,start=0,end=3,
            text='Merhaba, dünya',words=[SimpleNamespace(start=.1,end=.5,word='Merhaba',probability=.9),
                SimpleNamespace(start=.5,end=.6,word=',',probability=.9),
                SimpleNamespace(start=1.5,end=2,word=' dünya',probability=.9)])
        rows=segment_lines(segment,3,1)
        self.assertEqual(rows[0]['words'],[dict(text='Merhaba,',start=.1,end=.6),dict(text='dünya',start=1.5,end=2)])
        self.assertEqual(validate_lines(rows,SCHEMA['lyricLimits'])[0]['words'],rows[0]['words'])
        segment.words[2].start=.2
        self.assertNotIn('words',segment_lines(segment,3,1)[0])
