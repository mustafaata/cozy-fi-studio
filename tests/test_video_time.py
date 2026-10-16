import copy
import unittest
from project import validate_project, validate_video_time_bounds


class VideoTimeContractTests(unittest.TestCase):
    def project(self, remap):
        return dict(version=1, tracks={'main': {}}, video=dict(start=1, end=5, timeRemap=remap),
                    videoClips=[dict(id='one', start=1, end=5, timeRemap=remap)],
                    visualLayers=[dict(id='layer', type='video', asset='a'*64, start=1, end=5, timeRemap=remap)])

    def test_legacy_defaults_and_all_scope_round_trips_are_independent(self):
        old=validate_project(dict(version=1, tracks={'main': {}}))
        self.assertEqual(old['video']['timeRemap'],dict(reverse=False,freezeAt=None,freezeDuration=1,smoothing='frames',ramp=[]))
        value=self.project(dict(reverse=True,smoothing='blend',ramp=[[1,.5,'smooth'],[5,2,'hold']]))
        result=validate_project(value)
        self.assertEqual(validate_project(result),result)
        value['video']['timeRemap']['ramp'][0][1]=3
        self.assertEqual(result['video']['timeRemap']['ramp'][0][1],.5)

    def test_external_types_order_spacing_rate_and_size_are_strict(self):
        invalid=[dict(reverse=1),dict(freezeDuration=True),dict(smoothing='optical'),dict(ramp=[[0,True,'linear']]),
                 dict(ramp=[[0,0,'linear']]),dict(ramp=[[0,5,'linear']]),dict(ramp=[[1,1,'linear'],[1,2,'smooth']]),
                 dict(ramp=[[1,1,'linear'],[1.0001,2,'smooth']]),dict(ramp=[[0,1,'bezier']]),
                 dict(ramp=[[i,1,'linear'] for i in range(33)]),dict(ramp=[[float('nan'),1,'smooth']]),
                 dict(ramp=[{}]),dict(ramp=[[0,1]]),dict(ramp=None)]
        for remap in invalid:
            with self.subTest(remap=remap),self.assertRaises(ValueError):validate_project(self.project(remap))

    def test_freeze_must_be_inside_source_cut_and_unknown_end_is_checked_against_metadata(self):
        for position in [0,5,6]:
            with self.subTest(position=position),self.assertRaises(ValueError):validate_project(self.project(dict(freezeAt=position)))
        result=validate_project(self.project(dict(freezeAt=2.5,freezeDuration=.05)))
        validate_video_time_bounds(result['video'],10)
        clip=copy.deepcopy(result['video']);clip['end']=None
        with self.assertRaises(ValueError):validate_video_time_bounds(clip,2)

    def test_minimum_video_cut_accepts_float_roundoff_and_rejects_shorter_sources(self):
        for start,stop in [(3.95,4),(9.95,10)]:
            with self.subTest(start=start):
                value=self.project({})
                value['video'].update(start=start,end=stop)
                value['videoClips'][0].update(start=start,end=stop)
                result=validate_project(value)
                self.assertEqual(validate_project(result),result)
                validate_video_time_bounds(result['video'],10)
                for scope in ['video','videoClips']:
                    invalid=copy.deepcopy(value)
                    clip=invalid[scope][0] if scope=='videoClips' else invalid[scope]
                    clip['start']+=.0001
                    with self.assertRaises(ValueError):validate_project(invalid)

    def test_render_rejects_corrupt_time_data_before_reserving_a_job(self):
        from app import app
        from unittest.mock import patch
        with app.test_client() as client,patch('app.RENDER_SLOT') as slot:
            # The request cannot reach media lookup or the render job.
            response=client.post('/render',data={'project':'{"version":1,"tracks":{"main":{}},"video":{"timeRemap":{"reverse":1}}}'})
            self.assertEqual(response.status_code,400)
            slot.acquire.assert_not_called()


if __name__=='__main__':unittest.main()
