// Map positions for stations whose source gives no coordinates (all Skytech, vetr "gozd").
// Marked "OSM launch/landing": the paragliding site in OpenStreetMap (free_flying tags), checked 2026-10.
// The rest are the named peak, airfield or place from OpenStreetMap, so treat them as approximate.
// Kamšak and Čoklečeva gora could not be located and are left off the map.
export const locations:Record<string,[number,number]> = {
  'vetr-gozd':[46.3395,14.3313],
  'skytech-5d5304a4b175fc49bba1dfa732e053d4':[46.3343,15.3864], // Konjiška gora
  'skytech-12ed4a5be07761ffa34673194c1dca4a':[46.3609,15.3338], // Mala Gora: the only Mala gora peak in Štajerska; no launch in OSM
  'skytech-0ad3eca9046d57297308fd14affd4647':[46.1822,15.2057], // Malič: OSM launch
  'skytech-876e9d0c50d8489842cba80e1997bad9':[46.5501,15.9250], // Čagona - Cerkvenjak
  'skytech-ae1a423e1b6adbcd09a9d8fb4d4a4d95':[46.5828,16.1627], // Veržej
  'skytech-194ce62a77982e0c37e106fd70e06a87':[46.4266,15.9877], // Letališče Ptuj
  'skytech-9d20c0fee5003106cb0c81fc9a00fc72':[46.2627,15.7422], // Donačka gora
  'skytech-0d1ae9bb901731ae60eddd32b5d1a87d':[46.1589,15.4817], // Žusem
  'skytech-508c877ca3534c25973aa6b19e37d8a7':[46.6801,15.6180], // Plač
  'skytech-00bf8801a7b005d7321b957a4a801eb8':[46.5163,15.5800], // Mariborsko Pohorje: OSM launch
  'skytech-2cc16d83e64cc657273b72e6d6903704':[46.3703,14.9208], // Golte: OSM launch Golte - Planica
  'skytech-6e771aabbff2e923a5eb449014a3a7e4':[46.2973,15.0090], // Dobrovlje: OSM launch
  'skytech-54d8ebb60bde9f63b18c615a84dcf7e2':[46.0463,15.7058], // Orešje na Bizeljskem
  'skytech-4a05913191738a22eaa3afd77af2a56a':[46.2375,15.7373], // Rogatec
  'skytech-65b62b54b236dc029e136406c2ce8997':[46.3108,15.4911], // Letališče Slovenske Konjice
  'skytech-6cebfc17516b42f1c1551c64b2d7e2a8':[46.3255,15.0592], // Gora Oljka
  'skytech-aa96e39a9462dc5fd2a79230df11b669':[45.7888,14.4066], // Slivnica: OSM launch
  'skytech-53980eb55cfede215771959e89a77429':[45.6883,14.0616], // Vremščica
  'skytech-6467e3335f8a61693eae39e15d9f4cb4':[46.0341,14.3003], // Koreno
  'skytech-65fb895c6fe6cb61cf4b8f190df6cb5b':[45.5063,14.2669], // Sveta Ana
  'skytech-14ba49c1215488120703da384efd8905':[45.8393,14.2405], // Planinska grmada: OSM launch
  'skytech-bf688cefd04199b5dff3abe33ceafb28':[45.8315,14.2000], // Strmca
  'skytech-b25bd9ff4b8dce218f77e52a34a826f2':[45.8640,14.4137], // Zavrh
  'skytech-3f701a7a6452ca2a4793ba16eb657b1d':[46.1649,14.1135], // Blegoš
  'skytech-cd48780dbbc7a7c9c4efb5e7466754b0':[46.3395,14.3313], // Gozd: OSM launch
  'skytech-1de8db0ce41027dc0e974ec95f93492e':[46.2946,13.8754], // Vogar: OSM launch
  'skytech-a84ab4e780a3f8bf63dbcaea6060ccf7':[46.2523,13.8400], // Vogel: OSM launch
  'skytech-660959a9154c11d3799f9477438e850c':[46.4866,13.7766], // Kranjska Gora landing: OSM meadow by the police station (Borovška cesta 100A)
  'skytech-a449581bcff5cc80fd1dd792b12769df':[46.2747,14.5289], // Ambrož pod Krvavcem: OSM launch pri Slatnerju
  'skytech-1e05bd2be1a27948f71130ae18d0175a':[46.2977,14.6433], // Velika planina: OSM launch Gradišče
  'skytech-c440ca51f96db1089b10f4b560a632f8':[46.2821,13.8817], // Bohinjsko jezero: OSM Vogar landing by the lake
  'skytech-663c0360a78bbf835b350de0b7c2231c':[46.5041,13.7957], // Kranjska gora: launch Kranjska Gora - Jug, 1586 m (given by user)
  'skytech-82d69f3b462900b351f3a98a14c3f793':[46.3122,14.4546], // Potoška gora: OSM launch
  'skytech-b80c1266094cabce865a616424be25d4':[46.4395,13.6547], // Mangrt
  'skytech-4512a867ca0d18bbd33ccdb36b0ea333':[46.1810,13.7793], // Kobala: OSM launch
  'skytech-7cb4c2a7a43cb46bf867601576e96a7e':[46.2727,13.4733], // Stol (Kobarid): OSM launch
  'skytech-02733e47c412ef533fa6c4d8fa0655a7':[46.2089,13.5656], // Srednji vrh (Matajur): OSM launch
  'skytech-2cd66a5858d3df2c4d97e353c56854f2':[46.1772,13.9743], // Porezen
  'skytech-79d47c5a18523edc5727a8953de1b891':[46.1953,13.6200], // Kuk: OSM launch
  'skytech-6fed709b92e76afc3924951e8f9eacde':[45.9633,13.7237], // Lijak: OSM launch
  'skytech-c454085df514ce66b7d124ee8d60fb85':[46.4002,13.5682], // Planja nad Bovcem
  'skytech-daeca69ffaa4263cdb3a1d7e90255ae9':[46.3076,13.3977], // Učeja pod Stolom
  'skytech-8ebd1c7c169244ecfe649d44bf142889':[45.5399,13.6594], // Izola
  'skytech-d30d3c11640926ac7aafbe3eb5362d7e':[45.9534,14.8386], // Šentvid pri Stični
  'skytech-7c6f997e786d6063a4e1b10a73eefbe3':[45.9985,15.0930], // Nebesa nad Šentrupertom
  'skytech-cd65f0ecef0021fe39bc8c8ea3284ccd':[45.6524,15.0747], // Pogorelec
  'skytech-e1cf962b28f9a19b30f00094d625a8c7':[45.9775,14.7433], // Gradišče - Višnja Gora
  'skytech-3101fcd5a41bdc730c0690c256f9c9a7':[46.5297,15.1342], // Kremžarjev vrh
  'skytech-d6d148326d9713184c6861a307a70ab0':[45.6616,15.1798], // Smuk
  'skytech-a910895bc80e3fe8e4feb94fa80096b7':[45.5150,14.6407], // Gerovo - Sveta Gora
};
