// Skytech's own ads ("Oglasi" on skytech.si), shown under the graph of a Skytech station as thanks for the data.
// Copied from skytech.si/skytechsys/ogl.js on 2026-10-28: two slots, each rotating its own ads (300×250).
export interface Ad { image: string; url: string; }
const sky = 'https://skytech.si/wp-content/uploads/';
export const skytechAds: Ad[][] = [
  [
    { image: `${sky}2026/03/OGLAS-SKY.jpg`, url: 'http://www.kimfly.si' },
    { image: `${sky}2014/10/bener-pri-martinu-p.jpg`, url: 'http://www.julijana.info/sl/gostilna-pri-martinu' },
    { image: `${sky}2018/03/Misty_baner.jpg`, url: 'http://www.nova.eu/si/domaca-stran/' },
  ],
  [
    { image: `${sky}2024/10/777.jpg`, url: 'https://777gliders.com' },
    { image: `${sky}2016/02/jelkin_hram.jpg`, url: 'http://www.jelkin-hram.com' },
  ],
];
