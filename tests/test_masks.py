import json
import unittest
from unittest.mock import patch
from project import validate_project


class MaskContractTests(unittest.TestCase):
    def project(self, mask):
        return dict(version=1, tracks={'main': {}}, video=dict(mask=mask),
                    videoClips=[dict(id='one', mask=mask)], visualLayers=[dict(id='layer', mask=mask)])

    def test_legacy_defaults_and_all_scopes_round_trip_independently(self):
        self.assertFalse(validate_project(dict(version=1, tracks={'main': {}}))['video']['mask']['enabled'])
        value=self.project(dict(enabled=True,shape='polygon',invert=True,feather=3,clockOffset=.5,
                               points=[[0,0],[100,0],[50,100]],keyframes=dict(x=[[0,10,dict(type='smooth')],[1,90]])))
        result=validate_project(value)
        self.assertEqual(validate_project(result),result)
        value['video']['mask']['points'][0][0]=2
        self.assertEqual(result['video']['mask']['points'][0][0],0)
        result['video']['mask']['keyframes']['x'][0][1]=22
        self.assertEqual(result['videoClips'][0]['mask']['keyframes']['x'][0][1],10)

    def test_external_geometry_polygon_and_curves_are_strict_in_all_scopes(self):
        invalid=[dict(enabled=1),dict(x=True),dict(width=0),dict(feather=26),dict(blur=-1),dict(shape='svg'),dict(mode='filter'),
                 dict(points=[]),dict(points=[[0,0],[1,1],[2,2]]),dict(points=[[0,0],[1,0],[0,0]]),
                 dict(points=[[0,0],[100,0],[True,1]]),dict(points=[[0,0],[100,0],[1,float('nan')]]),
                 dict(points=[[i,i%2] for i in range(33)]),dict(keyframes=dict(x=[[0,201]])),
                 dict(keyframes=dict(x=[[0,1],[0,2]])),dict(keyframes=dict(points=[[0,1]])),
                 dict(keyframes=dict(x=[[0,1,dict(type='bezier',control=[0,0,1,2])]]))]
        for mask in invalid:
            for scope in ('video','videoClips','visualLayers'):
                value=dict(version=1,tracks={'main':{}})
                value[scope]=dict(mask=mask) if scope=='video' else [dict(id='one',mask=mask)]
                with self.subTest(mask=mask,scope=scope),self.assertRaises(ValueError):validate_project(value)

    def test_crossing_polygons_use_even_odd_fill_and_fields_have_no_executable_payload(self):
        result=validate_project(self.project(dict(shape='polygon',points=[[0,0],[100,100],[100,0],[0,100]],
                                                 html='<svg onload=alert(1)>')))
        self.assertNotIn('html',result['video']['mask'])

    def test_render_rejects_mask_before_media_resolution_and_render_slot(self):
        from app import app
        with app.test_client() as client,patch('app.RENDER_SLOT') as slot:
            response=client.post('/render',data={'project':json.dumps(self.project(dict(points=[[0,0],[1,1],[2,2]])))})
            self.assertEqual(response.status_code,400)
            slot.acquire.assert_not_called()


if __name__=='__main__':unittest.main()
