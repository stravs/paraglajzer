import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inGorenjska } from '../src/lib/gorenjska.ts';
import { parseVetr, parseSkytech, parseFrames, parseThermals, parseArso, parseArsoHistory, parseLuftarHistory, keepMissing, nextVetrCheck, arsoStations, ljubljanaTime, clockSkew, sourceFor } from '../src/lib/sources.ts';

test('vetr exposes only normalized weather, not device credentials',()=>{
  const data=[{station:{active:true,name:'test',full_name:'Test',imsi:'secret'},prefsData:{prefs:{send_data_interval_min:'20',phoneNum:'secret'}},windData:{avg:0,max:2,dir:0,timestamp:'2026-10-26T12:00:00+01:00'}}];
  const stations=parseVetr(`const data = ${JSON.stringify(data)};`);
  assert.equal(stations.length,1);assert.equal(stations[0].avg,0);assert.equal(stations[0].direction,'S');assert.equal(stations[0].interval,20);
  assert.ok(!JSON.stringify(stations).includes('secret'));
  assert.throws(()=>parseVetr('<html>changed</html>'));
});
test('vetr uses the send time, not the 15-min bin end',()=>{
  const entry=(wind:string,status:string)=>({station:{active:true,name:'peter'},windData:{avg:1,timestamp:wind},statusData:{timestamp:status}});
  const [fresh,old]=parseVetr(`const data = ${JSON.stringify([entry('2026-10-29T10:45:00+01:00','2026-10-29T10:37:44.922+01:00'),entry('2026-10-29T09:00:00+01:00','2026-10-29T10:37:44.922+01:00')])};`);
  assert.equal(fresh.observedAt,'2026-10-29T09:37:44.922Z');
  assert.equal(old.observedAt,'2026-10-29T08:00:00.000Z');
});
test('vetr checks follow the home stations\' sends',()=>{
  const at=(time:string)=>Date.parse(`2026-10-29T${time}+01:00`);
  const station=(id:string,sent:string,interval=10)=>({id:`vetr-${id}`,interval,sentAt:new Date(at(sent)).toISOString()});
  const stations=[station('peter','19:48:03'),station('stol','19:45:24'),station('gozd','19:43:33'),station('kamnik','19:41:00',20)];
  // Just after Peter's send: next is Gozd's send at 19:53:33, checked 30 s later.
  assert.equal(nextVetrCheck(stations,at('19:48:40')),at('19:54:03'));
  // Gozd sent on time: then Stol (19:55:24 + 30 s).
  assert.equal(nextVetrCheck([...stations.slice(0,2),station('gozd','19:53:30')],at('19:54:04')),at('19:55:54'));
  // Gozd is late: retry 90 s after its expected send.
  assert.equal(nextVetrCheck(stations,at('19:54:04')),at('19:55:03'));
  // A missed send rolls on to the next slot.
  assert.equal(nextVetrCheck([station('peter','19:48:03')],at('20:00:00')),at('20:08:33'));
  // Never more than 10 min, and nothing without home stations.
  assert.equal(nextVetrCheck([station('peter','19:48:03',30)],at('19:49:00')),at('19:59:00'));
  assert.equal(nextVetrCheck([station('kamnik','19:41:00')],at('19:49:00')),undefined);
});
test('vetr keeps the send time',()=>{
  const [peter]=parseVetr(`const data = ${JSON.stringify([{station:{active:true,name:'peter'},windData:{timestamp:'2026-10-29T19:45:00+01:00'},statusData:{timestamp:'2026-10-29T19:48:03.227000+01:00'}}])};`);
  assert.equal(peter.sentAt,'2026-10-29T18:48:03.227Z');
});
test('vetr rose photo is a vetr.si image, or none',()=>{
  const entry=(img:string)=>({station:{active:true,name:'peter',wind_rose_img:img},windData:{}});
  const [good,bad]=parseVetr(`const data = ${JSON.stringify([entry('peter_wide.jpg'),entry('../x" onerror="')])};`);
  assert.equal(good.roseImage,'https://vetr.si/static/img/peter_wide.jpg');assert.equal(bad.roseImage,undefined);
});
test('Skytech parses table rows and preserves missing wind as null',()=>{
  const html=`<h1>Primorska</h1><table><tr><th>Header</th></tr><tr><td><a onclick="show('graf','abcdef')">Kovk</a></td><td>0.0 m/s</td><td>--</td><td>JZ</td><td>8&deg;C</td><td>12:34 26.10.2026</td></tr></table>`;
  const [station]=parseSkytech(html);assert.equal(station.name,'Kovk');assert.equal(station.region,'Primorska');assert.equal(station.avg,0);assert.equal(station.gust,null);assert.equal(station.observedAt,'2026-10-26T11:34:00.000Z');
  assert.throws(()=>parseSkytech('<html>changed</html>'));
});
test('Ljubljana local timestamps use winter and summer offsets',()=>{
  assert.equal(ljubljanaTime('12:00 15.01.2026'),'2026-01-15T11:00:00.000Z');
  assert.equal(ljubljanaTime('12:00 15.07.2026'),'2026-07-15T10:00:00.000Z');
  assert.equal(ljubljanaTime('offline'),null);
});
test('A fast provider clock is measured in whole minutes and taken off its times',()=>{
  const received=Date.parse('2026-10-28T17:13:41Z');
  assert.equal(clockSkew('Wed, 28 Oct 2026 17:18:39 GMT',received),300000); // Skytech, 4 min 58 s fast
  assert.equal(clockSkew('Wed, 28 Oct 2026 17:13:52 GMT',received),0); // seconds of network delay
  assert.equal(clockSkew(null,received),0);
  assert.equal(ljubljanaTime('18:15 28.10.2026',300000),'2026-10-28T17:10:00.000Z');
  const html=`<h1>Gorenjska</h1><table><tr><td><a onclick="show('graf','abcdef')">Vogel</a></td><td>1 m/s</td><td>2 m/s</td><td>S</td><td>8&deg;C</td><td>18:15 28.10.2026</td></tr></table>`;
  assert.equal(parseSkytech(html,300000)[0].observedAt,'2026-10-28T17:10:00.000Z');
});
test('Zaladin uses only newest model run and normalizes to HTTPS',()=>{
  const html=['as_20261025-1200_r-t-vf850_si-neighbours_006.png','as_20261026-0000_r-t-vf850hPa_si-neighbours_012.png','as_20261026-0000_r-t-vf850hPa_si-neighbours_006.png'].map(f=>`<img src="http://meteo.arso.gov.si/uploads/probase/www/model/aladin/field/${f}">`).join('');
  const frames=parseFrames(html);assert.equal(frames.length,2);assert.equal(frames[0].validAt,'2026-10-26T06:00:00.000Z');assert.ok(frames.every(f=>f.url.startsWith('https://')));
  assert.throws(()=>parseFrames('no frames'));
});
test('thermal HTML is reduced to text, never returned for execution',()=>{
  const data=parseThermals('<rss><channel><pubDate>today</pubDate><item><title>Test</title><description><![CDATA[<b>Lift</b> 1.5 m/s]]></description></item></channel></rss>');
  assert.equal(data.items[0].text,'Lift 1.5 m/s');assert.equal(data.items.length,1);
});
test('source keys cannot alias a cache entry or request arbitrary URLs',()=>{
  for(const key of ['thermal:constructor','thermal:LJU:extra','zaladin:2:extra','zaladin:toString','https://example.com','frame:../../private','frame:evil.png']) assert.equal(sourceFor(key),null,key);
  assert.equal(sourceFor('vetr')?.interval,600);assert.equal(sourceFor('thermal:LJU')?.interval,600);assert.equal(sourceFor('zaladin:2')?.interval,1800);
});
test('stations carry map positions from the source or the local table',()=>{
  const data=[{station:{active:true,name:'peter',location:{lat:'46.38',lon:'14.19'}},windData:{}},{station:{active:true,name:'gozd'},windData:{}},{station:{active:true,name:'nowhere'},windData:{}}];
  const [peter,gozd,nowhere]=parseVetr(`const data = ${JSON.stringify(data)};`);
  assert.deepEqual(peter.location,[46.38,14.19]);assert.ok(gozd.location);assert.equal(nowhere.location,null);
  const html=`<h1>Primorska</h1><table><tr><td><a onclick="show('graf','6fed709b92e76afc3924951e8f9eacde')">Lijak</a></td><td>1</td><td>2</td><td>J</td><td>8</td><td>12:34 26.10.2026</td></tr></table>`;
  assert.ok(parseSkytech(html)[0].location);
});
test('ARSO keeps only wind stations and reads recent history newest first',()=>{
  const block=(id:string,time:string,avg:string,dir:string)=>`<metData><domain_longTitle>Kanin &amp; test</domain_longTitle><domain_meteosiId>${id}</domain_meteosiId><domain_lat>46.36</domain_lat><domain_lon>13.53</domain_lon><domain_altitude>2260</domain_altitude><tsValid_issued_RFC822>${time}</tsValid_issued_RFC822><ddavg_val>${dir}</ddavg_val><ffavg_val>${avg}</ffavg_val><ffmax_val>3.5</ffmax_val></metData>`;
  const stations=parseArso(`<data>${block('KANIN_','26 Oct 2026 19:50:00 +0000','1.2','147')}${block('RAIN_ONLY_','26 Oct 2026 19:50:00 +0000','','')}</data>`);
  assert.equal(stations.length,1);
  assert.deepEqual([stations[0].id,stations[0].name,stations[0].direction,stations[0].avg,stations[0].gust,stations[0].observedAt],['arso-KANIN_','Kanin & test','JV',1.2,3.5,'2026-10-26T19:50:00.000Z']);
  assert.throws(()=>parseArso('<html>changed</html>'));
  const history=parseArsoHistory(['26 Oct 2026 19:50:00 +0000','26 Oct 2026 19:40:00 +0000','26 Oct 2026 10:00:00 +0000'].map((t,i)=>block('KANIN_',t,String(i),'350')).join(''));
  assert.deepEqual(history.map(s=>s.timestamp),['2026-10-26T19:40:00.000Z','2026-10-26T19:50:00.000Z']);
  assert.equal(history[1].direction,350);
  assert.equal(sourceFor('history:arso:../x'),null);
  assert.ok(sourceFor('history:arso:KANIN_')?.url.endsWith('/recent/observationAms_KANIN_history.xml'));
});
test('Luftar history uses Ljubljana wall-clock times and exact degrees',()=>{
  const body=JSON.stringify([{timestamp:'2026-10-26T22:01:49',wind_speed:1.3,wind_speed_max:2,wind_direction:154.9},{timestamp:'2026-10-26T21:51:58',wind_speed:-1,wind_speed_max:null,wind_direction:400},{timestamp:'bad'}]);
  const samples=parseLuftarHistory(body);
  assert.deepEqual(samples.map(s=>s.timestamp),['2026-10-26T20:51:00.000Z','2026-10-26T21:01:00.000Z']);
  assert.deepEqual([samples[0].avg,samples[0].gust,samples[0].direction],[null,null,null]);
  assert.equal(samples[1].direction,154.9);
  assert.throws(()=>parseLuftarHistory('{}'));
  assert.ok(sourceFor('history:luftar:kriska')?.url.endsWith('wsDataKriskaHiCharts.json'));
  assert.equal(sourceFor('history:luftar:other'),null);
});
test('Luftar listing skips newest rows without wind',async t=>{
  const body=JSON.stringify([{timestamp:'2026-10-29T10:22:07',wind_speed:1.8,wind_speed_max:2,wind_direction:356},{timestamp:'2026-10-29T10:42:07',wind_speed:null,wind_speed_max:null,wind_direction:null}]);
  t.mock.method(globalThis,'fetch',async()=>new Response(body));
  const kriska=(await sourceFor('luftar')!.load!() as {id:string;avg:number|null;observedAt:string}[]).find(s=>s.id==='luftar-kriska')!;
  assert.equal(kriska.avg,1.8);assert.equal(kriska.observedAt,'2026-10-29T09:22:00.000Z');
});
test('Skytech leaves out the offline Kriška gora and Kranjska gora (launch) stations',()=>{
  const row=(id:string,name:string)=>`<tr><td><a onclick="show('graf','${id}')">${name}</a></td><td>1.0 m/s</td><td>2.0 m/s</td><td>J</td><td>8&deg;C</td><td>12:34 26.10.2026</td></tr>`;
  const stations=parseSkytech(`<h1>Gorenjska</h1><table>${row('ef075856fd59824786203959f9c8c45c','Kriška gora na servisu')}${row('663c0360a78bbf835b350de0b7c2231c','Kranjska gora')}${row('660959a9154c11d3799f9477438e850c','Kranjska Gora landing')}${row('cd48780dbbc7a7c9c4efb5e7466754b0','Gozd')}</table>`);
  assert.deepEqual(stations.map(s=>s.name),['Kranjska Gora landing','Gozd']);
});
test('Gorenjska + Kamnik boundary keeps home sites and leaves out neighbours',()=>{
  for(const [lat,lon] of [[46.3829,14.1928],[46.4314,14.1747],[46.3395,14.3313],[46.362,14.1718],[46.2973,14.5333],[46.2977,14.6433],[46.2882,14.5722]]) assert.equal(inGorenjska([lat,lon]),true,`${lat},${lon}`);
  for(const [lat,lon] of [[46.2727,13.4733],[46.3703,14.9208],[46.2627,15.7422],[46.0569,14.5058]]) assert.equal(inGorenjska([lat,lon]),false,`${lat},${lon}`);
});
test('station listings keep a missing station while its reading is under 2 h old',()=>{
  const now=Date.parse('2026-10-27T10:00:00Z');
  const station=(id:string,observedAt:string|null)=>({id,name:id,region:'Gorenjska',source:'skytech' as const,url:'',avg:1,gust:2,direction:'S',observedAt,interval:30,note:'',location:[46.36,14.17] as [number,number]});
  const merged=keepMissing([station('a','2026-10-27T09:50:00Z')],[station('a','2026-10-27T09:20:00Z'),station('b','2026-10-27T09:30:00Z'),station('c','2026-10-27T07:00:00Z'),station('d',null)],now);
  assert.deepEqual(merged.map(s=>[s.id,s.observedAt]),[['a','2026-10-27T09:50:00Z'],['b','2026-10-27T09:30:00Z']]);
  assert.equal(keepMissing([station('a',null)],null,now).length,1);
  // Outside Gorenjska only Skytech stations are kept.
  assert.equal(keepMissing([],[{...station('far','2026-10-27T09:50:00Z'),source:'vetr' as const,location:[46.26,15.74]}],now).length,0);
  assert.equal(keepMissing([],[{...station('far','2026-10-27T09:50:00Z'),location:[46.26,15.74]}],now).length,1);
});
test('ARSO stations come from per-station latest files, Lesce included',()=>{
  assert.ok(arsoStations.includes('LESCE_'));
  assert.ok(arsoStations.every(id=>/^[A-Z0-9_-]{1,40}$/.test(id)));
  assert.equal(typeof sourceFor('arso')?.load,'function');
});
test('ARSO Vogel is left out (Skytech Vogel is shown) and does not linger from an older listing',()=>{
  assert.ok(!arsoStations.includes('VOGEL_'));
  const now=Date.parse('2026-10-27T10:00:00Z');
  const vogel={id:'arso-VOGEL_',name:'Vogel',region:'Gorenjska',source:'arso' as const,url:'',avg:1,gust:2,direction:'S',observedAt:'2026-10-27T09:50:00Z',interval:30,note:'',location:[46.2594,13.8396] as [number,number]};
  assert.equal(keepMissing([],[vogel],now).length,0);
});
test('vetr raw readings: 10 min before the last one, gust is the top reading, direction weighted by speed',async()=>{
  const { parseVetrRaw }=await import('../src/lib/vetr-raw.ts');
  const at=(s:number)=>new Date(Date.parse('2026-10-29T19:48:00+01:00')-s*1000).toISOString();
  // Newest first, like vetr. The reading 11 min back is outside the window.
  const winds=[{timestamp:at(0),value:1},{timestamp:at(5),value:3},{timestamp:at(10),value:2},{timestamp:at(15),value:6},{timestamp:at(660),value:9}];
  const dirs=[{timestamp:at(0),value:350},{timestamp:at(5),value:30},{timestamp:at(10),value:30},{timestamp:at(15),value:30},{timestamp:at(660),value:180}];
  const raw=parseVetrRaw(JSON.stringify({winds,dirs}));
  assert.equal(raw.samples,4);assert.equal(raw.avg,3);assert.equal(raw.gust,6);
  assert.equal(raw.to,'2026-10-29T18:48:00.000Z');assert.equal(raw.from,'2026-10-29T18:38:00.000Z');
  // 11 parts at 30° against 1 part at 350°: a bit below 30°.
  assert.ok(raw.direction!>20&&raw.direction!<30,String(raw.direction));
  assert.throws(()=>parseVetrRaw('{}'));
});
