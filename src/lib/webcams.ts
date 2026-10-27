// Public webcams around the home sites (Sv. Peter, Stol, Gozd), checked live 2026-10-26.
// Images load straight from each operator only when a camera's popup is opened.
export interface Webcam {
  id: string; name: string; location: [number, number]; page: string;
  images: { title: string; url: string }[];
}
const dobrca = (n: number) => `https://trzic.tv/kamere/webcam.php?camera=Dobrca_${n}_last`;
export const webcams: Webcam[] = [
  { id:'klagenfurter', name:'Klagenfurter Hütte', location:[46.4469,14.1831], page:'https://www.klagenfurter-huette.at/',
    images:[1,2].map(n => ({ title:`Kamera ${n}`, url:`https://www.webcam.klagenfurter-huette.at/webcam/cam${n}.jpg` })) },
  { id:'bodental', name:'Bodental (Bodenbauer)', location:[46.4682,14.2149], page:'https://www.bergfex.at/bodental/webcams/c17914/',
    images:[{ title:'Proti Vrtači', url:'https://event.palmfriendly.at/webcam.bodenbauer.jpg' }] },
  { id:'zelenica', name:'Zelenica', location:[46.4290,14.2336], page:'https://www.zelenica.info/kamere-v-zivo/',
    images:[
      { title:'Dom na Zelenici', url:'https://trzic.tv/kamere/webcam.php?camera=DomZelenica_0_last' },
      { title:'ARSO · jugovzhod', url:'https://meteo.arso.gov.si/uploads/probase/www/observ/webcam/ZELENICA_dir/siwc_ZELENICA_se.jpg' },
      { title:'ARSO · zahod', url:'https://meteo.arso.gov.si/uploads/probase/www/observ/webcam/ZELENICA_dir/siwc_ZELENICA_w.jpg' },
    ] },
  { id:'ljubelj', name:'Ljubelj', location:[46.4392,14.2667], page:'https://www.promet.si/',
    images:[
      { title:'Ljubelj (DARS)', url:'https://kamere.dars.si/kamere/drsi_vgrc/Ljubelj_Lju1_0001.jpg' },
      { title:'Predor (DARS)', url:'https://kamere.dars.si/kamere/drsi_vgrc/LjubeljT_Ljt1_0001.jpg' },
      { title:'Loibltunnel (Koroška)', url:'https://ktncloud.winterdienst360.com/loibltunnel.jpg' },
    ] },
  { id:'dobrca', name:'Koča na Dobrči', location:[46.3762,14.2460], page:'https://www.dobrca.si/kamere-v-zivo/',
    images:[{ title:'Lesce, Radovljica, Triglav', url:dobrca(20) }, { title:'Proti Kranju', url:dobrca(2) }] },
  { id:'kriska', name:'Kriška gora', location:[46.3517,14.3334], page:'https://www.hribi.net/spletna_kamera/kriska_gora/2115',
    images:[2115,3134].map((n,i) => ({ title:`Kamera ${i+1}`, url:`https://www.hribi.net/kamere/kriska_gora_${n}.jpg` })) },
  { id:'sebenje', name:'Kriška gora iz Sebenj', location:[46.3310,14.3000], page:'https://www.luftar.si/',
    images:[{ title:'Sebenje', url:'https://www.luftar.si/img/webCam/KriskaSebenje.jpg' }] },
  { id:'trzic', name:'Tržič', location:[46.3636,14.3105], page:'https://meteotrzic.net/',
    images:[{ title:'Jugozahod', url:'https://meteotrzic.net/webcam/webcam-south-west/image.jpg' }] },
  { id:'vrba', name:'A2 Vrba (DARS)', location:[46.3890,14.1469], page:'https://www.promet.si/',
    images:[{ title:'Proti Jesenicam', url:'https://kamere.dars.si/kamere/Hrusica/Vrba_smer_Jesenice.jpg' }] },
];
