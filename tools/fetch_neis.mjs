// NEIS 학교기본정보(경기도교육청 J10, 초등학교) 내려받기 → data/ref/neis_schoolinfo.csv
// 사용: NEIS_KEY=발급키 node tools/fetch_neis.mjs
// 키 발급: https://open.neis.go.kr (회원가입 → 인증키 신청). 네트워크 정책에서 open.neis.go.kr 허용 필요.
import fs from 'node:fs';
const KEY = process.env.NEIS_KEY;
if (!KEY) { console.error('NEIS_KEY 환경변수가 필요합니다.'); process.exit(1); }
const cols = ['SD_SCHUL_CODE', 'SCHUL_NM', 'SCHUL_KND_SC_NM', 'JU_ORG_NM', 'FOND_SC_NM', 'ORG_RDNZC', 'ORG_RDNMA', 'ORG_RDNDA', 'ORG_TELNO', 'HMPG_ADRES', 'FOND_YMD', 'LOAD_DTM'];
const rows = [];
for (let page = 1; page < 50; page++) {
  const u = new URL('https://open.neis.go.kr/hub/schoolInfo');
  Object.entries({ KEY, Type: 'json', pIndex: page, pSize: 1000, ATPT_OFCDC_SC_CODE: 'J10', SCHUL_KND_SC_NM: '초등학교' }).forEach(([k, v]) => u.searchParams.set(k, v));
  const j = await (await fetch(u)).json();
  const block = j.schoolInfo?.[1]?.row || [];
  if (!block.length) { if (page === 1) console.error(JSON.stringify(j).slice(0, 300)); break; }
  rows.push(...block);
  if (block.length < 1000) break;
}
const esc = (v) => { v = v ?? ''; return /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v; };
fs.writeFileSync(new URL('../data/ref/neis_schoolinfo.csv', import.meta.url), '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n');
console.log(`${rows.length}개 학교 저장 → data/ref/neis_schoolinfo.csv (수집일 ${new Date().toISOString().slice(0, 10)})`);
