import copy
import unittest
from project import SCHEMA, validate_project, validate_clip_color


class ClipColorContractTests(unittest.TestCase):
    def test_legacy_identity_and_round_trip_in_both_scopes(self):
        project = validate_project({'version': 1, 'tracks': {'main': {}}, 'videoClips': [{'asset': 'a'*64}]})
        self.assertEqual(project['video']['color'], project['videoClips'][0]['color'])
        for channel in SCHEMA['clipColorChannels']:
            self.assertEqual(project['video']['color']['curves'][channel], [[0, 0], [1, 1]])
        project['video']['color'].update(exposure=1.23, temperature=34.5, tint=-12)
        project['videoClips'][0]['color']['curves']['rgb'] = [[0, .1], [.001, .5], [1, .9]]
        self.assertEqual(validate_project(project), project)
        self.assertEqual(project['video']['color']['curves']['rgb'], [[0, 0], [1, 1]])

    def test_invalid_scalars_rejected_on_server_in_both_scopes(self):
        for key, spec in SCHEMA['clipColor'].items():
            values = [None, [], {}, '1', 1] if key == 'enabled' else []
            if spec['type'] == 'number':
                values = [None, True, '1', float('nan'), float('inf'), spec['min']-1, spec['max']+1]
            for value in values:
                for scope in ['video', 'clip']:
                    project = {'version': 1, 'tracks': {'main': {}}, 'video': {}, 'videoClips': [{}]}
                    target = project['video'] if scope == 'video' else project['videoClips'][0]
                    target['color'] = {key: value}
                    with self.subTest(key=key, value=value, scope=scope), self.assertRaises(ValueError):
                        validate_project(project)

    def test_curve_contract_rejects_malformed_and_excessive_points(self):
        for curves in [None, [], {'alpha': [[0, 0], [1, 1]]}, {'rgb': []}, {'rgb': [[0, 0]]},
                       {'rgb': [[.1, 0], [1, 1]]}, {'rgb': [[0, 0], [.9, 1]]},
                       {'rgb': [[0, 0], [.5, 1], [.5001, 0], [1, 1]]},
                       {'rgb': [[0, 0], [.5, True], [1, 1]]}, {'rgb': [[0, 0], [1, 1, 0]]},
                       {'rgb': [[0, 0], [.5, float('nan')], [1, 1]]},
                       {'rgb': [[i/16, i/16] for i in range(17)]}]:
            with self.subTest(curves=curves), self.assertRaises(ValueError):
                validate_clip_color({'curves': curves})

    def test_profiles_copy_without_aliasing_or_changing_clip_metadata(self):
        color = {'curves': {'red': [[0, .2], [1, .8]]}, 'shadows': 12.5}
        data = {'version': 1, 'tracks': {'main': {}}, 'videoClips': [dict(
            asset='a'*64, id=str(i), offset=i*2, start=.2, end=2, speed=.8, color=color) for i in range(2)]}
        result = validate_project(data)
        saved = copy.deepcopy(result)
        result['videoClips'][0]['color']['curves']['red'][0][1] = .7
        self.assertEqual(result['videoClips'][1], saved['videoClips'][1])
        self.assertEqual(data['videoClips'][0]['color'], color)
