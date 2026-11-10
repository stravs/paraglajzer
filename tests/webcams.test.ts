import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWebcams, sourceFor } from '../src/lib/sources.ts';

test('webcams pair the newest valid capture with its dated image',()=>{
  const frame=(time:string)=>({path:`/uploads/probase/www/observ/webcam/KREDA-ICA_dir/siwc_20261110-${time}_KREDA-ICA_se.jpg`,valid:`2026-11-10T${time.slice(0,2)}:${time.slice(2)}:00Z`});
  const newest=frame('0850');
  const frames=parseWebcams(JSON.stringify({webcam_list:{features:[]},series:[newest,frame('0840'),{...frame('0900'),valid:'bad'},{path:'https://example.com/unsafe.jpg',valid:newest.valid}]}));
  assert.deepEqual(frames,{'https://meteo.arso.gov.si/uploads/probase/www/observ/webcam/KREDA-ICA_dir/siwc_KREDA-ICA_se.jpg':{url:`https://meteo.arso.gov.si${newest.path}`,at:newest.valid}});
  assert.throws(()=>parseWebcams('{}'));
  assert.equal(sourceFor('webcam:METEO-1403_se')?.interval,600);
  assert.equal(sourceFor('webcam:../../unsafe'),null);
});
