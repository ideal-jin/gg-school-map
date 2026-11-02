// 주소 → 좌표 후보 만들기 (자동 반영하지 않음: 관리자가 검토 후 /admin '검증 좌표'로 올림)
// 사용: VWORLD_KEY=키 node tools/geocode.mjs [연도]     또는  KAKAO_REST_KEY=키 node tools/geocode.mjs
// 주소는 NEIS 학교기본정보(data/ref/neis_schoolinfo.csv → build_data.py 결합)에서 온 값만 사용한다.
import fs from 'node:fs';
const year = process.argv[2] || '2027';
const base = new URL('../', import.meta.url);
const { schools } = JSON.parse(fs.readFileSync(new URL(`data/${year}/schools.json`, base)));
const geo = JSON.parse(fs.readFileSync(new URL('data/geo/gyeonggi_sigungu.geojson', base)));
const VW = process.env.VWORLD_KEY, KK = process.env.KAKAO_REST_KEY;
if (!VW && !KK) { console.error('VWORLD_KEY 또는 KAKAO_REST_KEY 가 필요합니다.'); process.exit(1); }

function inRing(pt, ring) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c; } return c; }
function inCity(lng, lat, city) {
  const f = geo.features.find((x) => x.properties.full === city); if (!f) return null;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  return polys.some((p) => inRing([lng, lat], p[0]) && !p.slice(1).some((h) => inRing([lng, lat], h)));
}
async function vworld(addr) {
  const u = new URL('https://api.vworld.kr/req/address');
  Object.entries({ service: 'address', request: 'getcoord', version: '2.0', crs: 'epsg:4326', address: addr, refine: 'true', simple: 'false', format: 'json', type: 'road', key: VW }).forEach(([k, v]) => u.searchParams.set(k, v));
  const j = await (await fetch(u)).json();
  const p = j.response?.result?.point; return p ? { lat: +p.y, lng: +p.x, src: '브이월드 주소좌표변환(도로명)' } : null;
}
async function kakao(addr) {
  const r = await fetch('https://dapi.kakao.com/v2/local/search/address.json?query=' + encodeURIComponent(addr), { headers: { Authorization: 'KakaoAK ' + KK } });
  const d = (await r.json()).documents?.[0]; return d ? { lat: +d.y, lng: +d.x, src: '카카오 로컬 주소검색' } : null;
}
const out = [['key', 'address', 'lat', 'lng', 'source', 'checked', 'in_city_boundary', 'dist_from_current_m']];
const today = new Date().toISOString().slice(0, 10);
for (const s of schools) {
  if (s.status === '폐·휴교' || !s.location.address) continue;
  const g = VW ? await vworld(s.location.address) : await kakao(s.location.address);
  if (!g) { out.push([s.key, s.location.address, '', '', '변환 실패', today, '', '']); continue; }
  const ok = inCity(g.lng, g.lat, s.city);
  const d = s.location.lat != null ? Math.round(Math.hypot((g.lat - s.location.lat) * 111000, (g.lng - s.location.lng) * 88000)) : '';
  out.push([s.key, s.location.address, g.lat, g.lng, `${g.src}; 주소 출처 NEIS 학교기본정보`, today, ok, d]);
  await new Promise((r) => setTimeout(r, 120));
}
const esc = (v) => { v = String(v ?? ''); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
fs.writeFileSync(new URL('data/sources/locations_candidates.csv', base), '﻿' + out.map((r) => r.map(esc).join(',')).join('\n') + '\n');
console.log(`후보 ${out.length - 1}건 → data/sources/locations_candidates.csv  (in_city_boundary=false 이거나 기존 좌표와 300m 이상 차이 나는 행은 직접 확인)`);
