import copy
import unittest

from project import SCHEMA, validate_project


class RhythmContractTests(unittest.TestCase):
    def test_legacy_defaults_and_authored_round_trip(self):
        legacy = {'version': 1, 'tracks': {'main': {}}}
        project = validate_project(legacy)
        self.assertEqual(project['rhythm'], {key: value['default'] for key, value in SCHEMA['rhythm'].items()})
        project['rhythm'] = dict(bpm=127.5, offset=.17, beatsPerBar=7, division='3', visible=True, snap=True)
        self.assertEqual(validate_project(project), project)
        self.assertNotIn('rhythm', legacy)

    def test_reject_invalid_external_rhythm_values(self):
        for rhythm in [None, [], '120', 0]:
            with self.subTest(rhythm=rhythm), self.assertRaises(ValueError):
                validate_project({'version': 1, 'tracks': {'main': {}}, 'rhythm': rhythm})
        for key, value in [('bpm', True), ('bpm', '120'), ('bpm', float('nan')), ('bpm', float('inf')),
                           ('bpm', 19), ('bpm', 301), ('offset', -1), ('offset', 1201),
                           ('beatsPerBar', 2.5), ('beatsPerBar', 0), ('division', '5'), ('snap', 1)]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                validate_project({'version': 1, 'tracks': {'main': {}}, 'rhythm': {key: value}})

    def test_grid_metadata_does_not_retime_authored_content(self):
        project = validate_project({'version': 1, 'tracks': {'main': {'automation': {'volume': [[.17, 50], [2.43, 130]]}}},
                                    'markers': [{'id': 'a', 'time': 2.43, 'name': 'A'}]})
        original = copy.deepcopy(project)
        project['rhythm'].update(bpm=300, offset=1200, beatsPerBar=12, division='8', visible=True, snap=True)
        result = validate_project(project)
        result['rhythm'] = original['rhythm']
        self.assertEqual(result, original)
