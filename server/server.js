#!/usr/bin/env node
/*
 * 경기 초등 인사구역 지도 — 정적 파일 + 관리 API 서버 (외부 의존성 없음, Node 18+)
 *
 *   비밀번호 해시 만들기:  node server/server.js hash '관리자비밀번호'
 *   실행:                  ADMIN_PASSWORD_HASH='scrypt$...' PORT=8080 node server/server.js
 *
 * 공개 화면은 누구나 볼 수 있고, /api/admin/* 은 로그인한 관리자만 사용할 수 있다.
 * 자료를 바꿀 때는 기존 파일을 data/<연도>/versions/ 에 보관한 뒤 새 파일을 쓰고,
 * 학교별 변경 내역을 data/history/changes.jsonl 에 추가한다(덮어쓰지 않음).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 8080);
const HASH = process.env.ADMIN_PASSWORD_HASH || '';
const SECURE_COOKIE = process.env.COOKIE_SECURE === '1';
const SESSION_TTL = 2 * 60 * 60 * 1000;

// ---------- 비밀번호 ----------
function makeHash(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `scrypt$${salt}$${h}`;
}
function checkPw(pw) {
  const [alg, salt, h] = HASH.split('$');
  if (alg !== 'scrypt' || !salt || !h) return false;
  const got = crypto.scryptSync(String(pw), salt, 64);
  const want = Buffer.from(h, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
if (process.argv[2] === 'hash') {
  if (!process.argv[3]) { console.error('사용: node server/server.js hash <비밀번호>'); process.exit(1); }
  console.log(makeHash(process.argv[3]));
  process.exit(0);
}

// ---------- 세션 ----------
const sessions = new Map(); // token -> {exp, csrf}
const attempts = new Map(); // ip -> {n, until}
function getSession(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!m) return null;
  const s = sessions.get(m[1]);
  if (!s || s.exp < Date.now()) { sessions.delete(m && m[1]); return null; }
  s.exp = Date.now() + SESSION_TTL;
  return Object.assign({ token: m[1] }, s);
}

// ---------- CSV ----------
function parseCSV(text) {
  text = String(text).replace(/^﻿/, '');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((v) => v.trim() !== ''));
  if (!nonEmpty.length) return { header: [], rows: [] };
  const header = nonEmpty[0].map((h) => h.trim());
  return { header, rows: nonEmpty.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}
const csvCell = (v) => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const toCSV = (header, rows) => '﻿' + [header.join(','), ...rows.map((r) => header.map((h) => csvCell(r[h])).join(','))].join('\r\n') + '\r\n';

// ---------- 파일/버전 ----------
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function archive(file, dir) {
  if (!fs.existsSync(file)) return null;
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, path.basename(file).replace(/(\.\w+)$/, `-${stamp()}$1`));
  fs.copyFileSync(file, dest);
  return path.relative(ROOT, dest);
}
function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
function appendHistory(entries) {
  if (!entries.length) return;
  const f = path.join(DATA, 'history', 'changes.jsonl');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

// ---------- 검증 규칙 ----------
const ZONES = ['갑', '을', '병'], SUBS = ['가', '나', '다', '라'], STATUS = ['운영', '폐·휴교', '신설예정'];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const SCHOOL_COLS = ['key', 'office', 'city', 'display', 'name', 'name_pdf', 'kind', 'parent', 'zone', 'zone_sub', 'status', 'provisional_name', 'pdf_red',
  'doc_page', 'pdf_page', 'effective_from', 'effective_to', 'checked', 'neis_code', 'lat', 'lng', 'location_status', 'notes'];
const BONUS_COLS = ['school_key', 'school_name', 'bonus_type', 'category', 'grade', 'start_date', 'end_date', 'status', 'monthly_points', 'daily_points',
  'cap_points', 'combined_cap_points', 'conditions', 'rule_doc', 'designation_doc', 'evidence_page', 'verified_date', 'note'];
const LOC_COLS = ['key', 'address', 'lat', 'lng', 'source', 'checked'];

function inGyeonggi(lat, lng) { return lat >= 36.85 && lat <= 38.35 && lng >= 126.3 && lng <= 127.9; }

function importSchools(year, parsed, prev, docMeta) {
  const errors = [], recs = [];
  const miss = ['key', 'office', 'city', 'display', 'zone', 'status', 'doc_page'].filter((c) => !parsed.header.includes(c));
  if (miss.length) return { errors: [`필수 열 없음: ${miss.join(', ')}`] };
  const prevBy = new Map((prev?.schools || []).map((s) => [s.key, s]));
  const seen = new Set();
  parsed.rows.forEach((r, i) => {
    const ln = i + 2;
    if (!r.key) errors.push(`${ln}행: key 비어 있음`);
    if (seen.has(r.key)) errors.push(`${ln}행: key 중복 (${r.key})`); seen.add(r.key);
    if (!ZONES.includes(r.zone)) errors.push(`${ln}행: 인사구역은 갑·을·병 중 하나 (${r.zone})`);
    if (r.zone === '병' && r.zone_sub && !SUBS.includes(r.zone_sub)) errors.push(`${ln}행: 병 세부구분은 가·나·다·라 (${r.zone_sub})`);
    if (r.zone !== '병' && r.zone_sub) errors.push(`${ln}행: 세부구분은 병구역에만 입력`);
    if (!STATUS.includes(r.status)) errors.push(`${ln}행: 상태는 운영·폐·휴교·신설예정 (${r.status})`);
    if (r.effective_from && !isDate(r.effective_from)) errors.push(`${ln}행: effective_from 형식(YYYY-MM-DD)`);
    if (r.effective_to && !isDate(r.effective_to)) errors.push(`${ln}행: effective_to 형식(YYYY-MM-DD)`);
    const lat = r.lat === '' ? null : Number(r.lat), lng = r.lng === '' ? null : Number(r.lng);
    if ((lat == null) !== (lng == null) || (lat != null && !inGyeonggi(lat, lng))) errors.push(`${ln}행: 좌표가 비었거나 경기도 범위 밖`);
    const old = prevBy.get(r.key);
    recs.push({
      key: r.key, year, name_pdf: r.name_pdf || r.display, name: r.name || null, display: r.display,
      kind: r.kind || '본교', parent: r.parent || null, office: r.office, office_short: r.office.replace('교육지원청', ''),
      city: r.city, city_short: r.city.replace(/[시군]$/, ''), zone: r.zone, zone_sub: r.zone === '병' ? (r.zone_sub || null) : null,
      status: r.status, provisional_name: r.provisional_name === 'True' || r.provisional_name === 'true', pdf_red: r.pdf_red === 'True' || r.pdf_red === 'true',
      notes: r.notes ? r.notes.split(' / ') : [],
      source: Object.assign({}, old?.source || {}, {
        doc_id: docMeta.id, doc: docMeta.title, table: docMeta.table, doc_page: Number(r.doc_page) || r.doc_page, pdf_page: Number(r.pdf_page) || null,
        effective_from: r.effective_from || docMeta.effective_from, effective_to: r.effective_to || null, checked: r.checked || new Date().toISOString().slice(0, 10),
      }),
      name_match: old?.name_match || {},
      codes: { neis: r.neis_code || null, neis_status: r.neis_code ? (old?.codes?.neis === r.neis_code ? old.codes.neis_status : '관리자 입력') : '미확인' },
      location: lat != null ? Object.assign({}, old?.location || {}, { lat, lng, status: r.location_status || old?.location?.status || '검증 좌표' })
        : Object.assign({}, old?.location || {}, { lat: null, lng: null, status: r.location_status || '위치 확인 필요' }),
      homepage: old?.homepage || null,
    });
  });
  return { errors, recs };
}

function importBonus(parsed, schoolsByKey) {
  // 한 행 = 한 학교의 한 지정기간. 자료에 없는 학교는 행을 만들지 않는다(화면에서 '확인 필요').
  const errors = [], recs = [];
  const miss = BONUS_COLS.filter((c) => !parsed.header.includes(c));
  if (miss.length) return { errors: [`필수 열 없음: ${miss.join(', ')}`] };
  parsed.rows.forEach((r, i) => {
    const ln = i + 2;
    if (!schoolsByKey.has(r.school_key)) errors.push(`${ln}행: 학교 key를 찾을 수 없음 (${r.school_key})`);
    if (!['도서벽지', '농어촌'].includes(r.bonus_type)) errors.push(`${ln}행: bonus_type은 도서벽지 또는 농어촌`);
    if (r.status !== '지정') errors.push(`${ln}행: status는 '지정'만 사용(지정기간 행). 지정이 끝났으면 end_date를 입력`);
    for (const c of ['designation_doc', 'evidence_page', 'start_date', 'verified_date'])
      if (!r[c]) errors.push(`${ln}행: ${c} 필수(지정 자료명·쪽수·지정 시작일·확인일)`);
    if (!r.grade && !r.category) errors.push(`${ln}행: category(벽지·도서·접적·농어촌·공단 등) 또는 grade(급지) 필요`);
    for (const c of ['start_date', 'end_date', 'verified_date']) if (r[c] && !isDate(r[c])) errors.push(`${ln}행: ${c} 형식(YYYY-MM-DD)`);
    if (r.start_date && r.end_date && r.end_date < r.start_date) errors.push(`${ln}행: 종료일이 시작일보다 빠름`);
    for (const c of ['monthly_points', 'daily_points']) if (r[c] && !/^\d+(\.\d+)?$/.test(r[c])) errors.push(`${ln}행: ${c}는 숫자`);
    if ((r.monthly_points || r.cap_points) && !r.rule_doc) errors.push(`${ln}행: 월평정점·상한점을 넣으려면 근거 평정 규정(rule_doc) 필수`);
    recs.push(Object.assign({}, r, { open_ended: !r.end_date, pdf_page: r.pdf_page ? Number(r.pdf_page) : null }));
  });
  return { errors, recs };
}

function importLocations(parsed, schoolsByKey) {
  const errors = [], recs = [];
  const miss = LOC_COLS.filter((c) => !parsed.header.includes(c));
  if (miss.length) return { errors: [`필수 열 없음: ${miss.join(', ')}`] };
  parsed.rows.forEach((r, i) => {
    const ln = i + 2;
    if (!schoolsByKey.has(r.key)) errors.push(`${ln}행: 학교 key를 찾을 수 없음 (${r.key})`);
    const lat = Number(r.lat), lng = Number(r.lng);
    if (!r.lat || !r.lng || !inGyeonggi(lat, lng)) errors.push(`${ln}행: 좌표가 비었거나 경기도 범위 밖`);
    if (!r.source) errors.push(`${ln}행: 좌표 출처(source) 필수`);
    if (r.checked && !isDate(r.checked)) errors.push(`${ln}행: checked 형식(YYYY-MM-DD)`);
    recs.push(Object.assign({}, r, { lat, lng }));
  });
  return { errors, recs };
}

const DIFF_FIELDS = ['zone', 'zone_sub', 'status', 'name', 'display', 'office', 'city', 'kind'];
function diffSchools(prev, next) {
  const pb = new Map(prev.map((s) => [s.key, s])), nb = new Map(next.map((s) => [s.key, s]));
  const changes = [];
  for (const [k, s] of nb) {
    const o = pb.get(k);
    if (!o) { changes.push({ key: k, type: '추가', to: `${s.zone}${s.zone_sub || ''} ${s.status}` }); continue; }
    for (const f of DIFF_FIELDS) if ((o[f] ?? null) !== (s[f] ?? null)) changes.push({ key: k, type: '변경', field: f, from: o[f] ?? null, to: s[f] ?? null });
    if ((o.location?.lat ?? null) !== (s.location?.lat ?? null) || (o.location?.lng ?? null) !== (s.location?.lng ?? null))
      changes.push({ key: k, type: '변경', field: 'location', from: o.location?.lat != null ? `${o.location.lat},${o.location.lng}` : null, to: s.location?.lat != null ? `${s.location.lat},${s.location.lng}` : null });
  }
  for (const k of pb.keys()) if (!nb.has(k)) changes.push({ key: k, type: '삭제' });
  return changes;
}

// ---------- 요청 처리 ----------
function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, Object.assign({
    'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
  }, headers));
  res.end(isObj ? JSON.stringify(body) : body);
}
function readBody(req, limit = 15 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8', '.pdf': 'application/pdf' };
const PRIVATE = [/^\/server\//, /^\/tools\//, /^\/data\/history\//, /^\/data\/[^/]+\/versions\//, /^\/data\/sources\/uploads\//, /^\/\./];

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  if (PRIVATE.some((re) => re.test(pathname))) return send(res, 404, 'not found');
  const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
  if (!file.startsWith(ROOT + path.sep)) return send(res, 400, 'bad path');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

async function api(req, res, url) {
  const ip = req.socket.remoteAddress;
  if (url.pathname === '/api/admin/login' && req.method === 'POST') {
    if (!HASH) return send(res, 503, { error: '서버에 ADMIN_PASSWORD_HASH가 설정되지 않아 관리 기능이 꺼져 있습니다.' });
    const a = attempts.get(ip) || { n: 0, until: 0 };
    if (a.until > Date.now()) return send(res, 429, { error: '로그인 시도가 많아 잠시 후 다시 시도하세요.' });
    const body = await readBody(req);
    if (!checkPw(body.password || '')) {
      a.n++; if (a.n >= 5) { a.until = Date.now() + 10 * 60 * 1000; a.n = 0; }
      attempts.set(ip, a);
      return send(res, 401, { error: '비밀번호가 올바르지 않습니다.' });
    }
    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex'), csrf = crypto.randomBytes(16).toString('hex');
    sessions.set(token, { exp: Date.now() + SESSION_TTL, csrf });
    return send(res, 200, { ok: true, csrf }, { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${SECURE_COOKIE ? '; Secure' : ''}` });
  }
  const s = getSession(req);
  if (!s) return send(res, 401, { error: '로그인이 필요합니다.' });
  if (req.method !== 'GET' && req.headers['x-csrf-token'] !== s.csrf) return send(res, 403, { error: 'CSRF 토큰 불일치' });

  if (url.pathname === '/api/admin/me') return send(res, 200, { ok: true, csrf: s.csrf });
  if (url.pathname === '/api/admin/logout' && req.method === 'POST') {
    sessions.delete(s.token);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (url.pathname === '/api/admin/history') {
    const f = path.join(DATA, 'history', 'changes.jsonl');
    const lines = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) : [];
    const key = url.searchParams.get('key');
    let items = lines.map((l) => JSON.parse(l));
    if (key) items = items.filter((x) => x.key === key);
    return send(res, 200, { items: items.slice(-1000).reverse() });
  }
  if (url.pathname === '/api/admin/versions') {
    const out = {};
    for (const d of fs.readdirSync(DATA)) {
      const vd = path.join(DATA, d, 'versions');
      if (fs.existsSync(vd)) out[d] = fs.readdirSync(vd).sort().reverse();
    }
    return send(res, 200, out);
  }
  if (url.pathname === '/api/admin/import' && req.method === 'POST') {
    const body = await readBody(req);
    const { kind, csv, comment = '', apply = false } = body;
    const year = String(body.year || '');
    if (!/^\d{4}$/.test(year)) return send(res, 400, { error: '연도(year)를 4자리로 입력하세요.' });
    if (!comment.trim() && apply) return send(res, 400, { error: '변경 사유(근거 문서명 등)를 입력하세요.' });
    const parsed = parseCSV(csv || '');
    const reg = readJSON(path.join(DATA, 'datasets.json'), { datasets: [] });
    let ds = reg.datasets.find((d) => String(d.year) === year);
    const schoolsFile = path.join(DATA, year, 'schools.json');
    const prev = readJSON(schoolsFile, null);
    const when = new Date().toISOString();

    if (kind === 'schools') {
      if (!ds && !(body.effective_from && isDate(body.effective_from) && body.document))
        return send(res, 400, { error: '새 연도 자료는 적용 시작일(effective_from)과 근거 문서명(document)을 함께 입력하세요.' });
      const docMeta = prev?.meta?.document || { id: `GGE-HR-ELEM-${year}`, title: body.document, table: `[별표1] ${year}년 초등학교 인사구역 현황표`, effective_from: body.effective_from };
      const r = importSchools(Number(year), parsed, prev, docMeta);
      if (r.errors.length) return send(res, 422, { errors: r.errors.slice(0, 200), count: r.errors.length });
      const changes = diffSchools(prev?.schools || [], r.recs);
      if (!apply) return send(res, 200, { preview: true, rows: r.recs.length, changes: changes.slice(0, 500), changeCount: changes.length, newYear: !ds });
      const archived = archive(schoolsFile, path.join(DATA, year, 'versions'));
      archive(path.join(DATA, year, 'schools.csv'), path.join(DATA, year, 'versions'));
      const meta = Object.assign({}, prev?.meta || { year: Number(year), document: docMeta }, { generated: when.slice(0, 10), record_count: r.recs.length, updated_by: 'admin', update_comment: comment });
      writeAtomic(schoolsFile, JSON.stringify({ meta, schools: r.recs }));
      writeAtomic(path.join(DATA, year, 'schools.csv'), toCSV(SCHOOL_COLS, r.recs.map((x) => ({
        key: x.key, office: x.office, city: x.city, display: x.display, name: x.name, name_pdf: x.name_pdf, kind: x.kind, parent: x.parent, zone: x.zone, zone_sub: x.zone_sub,
        status: x.status, provisional_name: x.provisional_name ? 'True' : 'False', pdf_red: x.pdf_red ? 'True' : 'False', doc_page: x.source.doc_page, pdf_page: x.source.pdf_page,
        effective_from: x.source.effective_from, effective_to: x.source.effective_to, checked: x.source.checked, neis_code: x.codes.neis, lat: x.location.lat, lng: x.location.lng,
        location_status: x.location.status, notes: x.notes.join(' / '),
      }))));
      if (!ds) {
        ds = { year: Number(year), label: `${year}학년도`, path: `data/${year}/schools.json`, validation: `data/${year}/validation.json`, effective_from: body.effective_from, effective_to: null, document: body.document, revision: body.revision || '' };
        reg.datasets.push(ds); reg.datasets.sort((a, b) => a.year - b.year);
        // 직전 연도 기준의 종료일을 새 기준 시작 전날로 기록
        const prevDs = reg.datasets.filter((d) => d.year < Number(year)).pop();
        if (prevDs && !prevDs.effective_to) prevDs.effective_to = new Date(Date.parse(body.effective_from) - 86400000).toISOString().slice(0, 10);
        archive(path.join(DATA, 'datasets.json'), path.join(DATA, 'versions'));
        writeAtomic(path.join(DATA, 'datasets.json'), JSON.stringify(reg, null, 2));
      }
      appendHistory(changes.map((c) => Object.assign({ time: when, kind: 'schools', year: Number(year), comment, archived }, c)));
      return send(res, 200, { ok: true, rows: r.recs.length, changeCount: changes.length, archived });
    }

    if (!prev) return send(res, 400, { error: `${year}년 학교 자료가 없습니다. 먼저 학교 자료를 등록하세요.` });
    const byKey = new Map(prev.schools.map((s) => [s.key, s]));

    if (kind === 'bonus') {
      const r = importBonus(parsed, byKey);
      if (r.errors.length) return send(res, 422, { errors: r.errors.slice(0, 200), count: r.errors.length });
      const bfile = path.join(DATA, 'bonus', 'promotion_bonus.json');
      const old = readJSON(bfile, { records: [] }).records;
      const sig = (b) => `${b.school_key}|${b.bonus_type}|${b.category}|${b.start_date}`;
      const ob = new Map(old.map((b) => [sig(b), b]));
      const changes = [];
      const proj = (x) => JSON.stringify(BONUS_COLS.map((c) => x[c] ?? ''));
      const merged = r.recs.map((b) => { const o = ob.get(sig(b)); return o ? Object.assign({}, o, b, { pdf_page: o.pdf_page ?? b.pdf_page }) : b; });
      r.recs = merged;
      for (const b of r.recs) {
        const o = ob.get(sig(b));
        if (!o) changes.push({ key: b.school_key, type: '추가', field: `승진가산점:${b.bonus_type}`, to: `${b.category} ${b.grade} ${b.start_date}~${b.end_date || ''}` });
        else if (proj(o) !== proj(b)) changes.push({ key: b.school_key, type: '변경', field: `승진가산점:${b.bonus_type}`, from: `${o.category} ${o.grade} ${o.start_date}~${o.end_date || ''}`, to: `${b.category} ${b.grade} ${b.start_date}~${b.end_date || ''}` });
        ob.delete(sig(b));
      }
      for (const o of ob.values()) changes.push({ key: o.school_key, type: '삭제', field: `승진가산점:${o.bonus_type}`, from: `${o.category} ${o.grade} ${o.start_date}~${o.end_date || ''}` });
      if (!apply) return send(res, 200, { preview: true, rows: r.recs.length, changes, changeCount: changes.length });
      const archived = archive(bfile, path.join(DATA, 'bonus', 'versions'));
      archive(path.join(DATA, 'bonus', 'promotion_bonus.csv'), path.join(DATA, 'bonus', 'versions'));
      const prevMeta = readJSON(bfile, {});
      writeAtomic(bfile, JSON.stringify(Object.assign({}, prevMeta, { updated: when, comment, records: r.recs }), null, 1));
      writeAtomic(path.join(DATA, 'bonus', 'promotion_bonus.csv'), toCSV(BONUS_COLS, r.recs));
      appendHistory(changes.map((c) => Object.assign({ time: when, kind: 'bonus', year: Number(year), comment, archived }, c)));
      return send(res, 200, { ok: true, rows: r.recs.length, changeCount: changes.length, archived });
    }

    if (kind === 'locations') {
      const r = importLocations(parsed, byKey);
      if (r.errors.length) return send(res, 422, { errors: r.errors.slice(0, 200), count: r.errors.length });
      const next = prev.schools.map((s) => Object.assign({}, s, { location: Object.assign({}, s.location) }));
      const nb = new Map(next.map((s) => [s.key, s]));
      for (const l of r.recs) {
        const s = nb.get(l.key);
        s.location = { lat: l.lat, lng: l.lng, address: l.address || s.location.address || null, status: '검증 좌표', source: l.source, checked: l.checked || when.slice(0, 10) };
      }
      const changes = diffSchools(prev.schools, next);
      if (!apply) return send(res, 200, { preview: true, rows: r.recs.length, changes, changeCount: changes.length });
      const archived = archive(schoolsFile, path.join(DATA, year, 'versions'));
      writeAtomic(schoolsFile, JSON.stringify({ meta: Object.assign({}, prev.meta, { generated: when.slice(0, 10) }), schools: next }));
      const up = path.join(DATA, 'sources', 'uploads');
      fs.mkdirSync(up, { recursive: true });
      fs.writeFileSync(path.join(up, `locations-${year}-${stamp()}.csv`), csv);
      appendHistory(changes.map((c) => Object.assign({ time: when, kind: 'locations', year: Number(year), comment, archived }, c)));
      return send(res, 200, { ok: true, rows: r.recs.length, changeCount: changes.length, archived });
    }
    return send(res, 400, { error: 'kind는 schools | bonus | locations' });
  }
  return send(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: '서버 오류: ' + e.message });
  }
});
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`http://localhost:${PORT}  (관리: /admin${HASH ? '' : ' — ADMIN_PASSWORD_HASH 미설정으로 비활성'})`);
  });
}
module.exports = { parseCSV, importBonus, importSchools, importLocations, diffSchools };
