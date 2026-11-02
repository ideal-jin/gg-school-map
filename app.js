/* 경기도 초등 인사구역 · 승진 가산점 학교 지도 */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = new Date().toISOString().slice(0, 10);
  const ZONE_COLOR = { 갑: '#2563b0', 을: '#2f8a4e', 병: '#c4561c' };
  const TYPE_LABEL = { island: '도서벽지', rural: '농어촌' };

  const state = {
    datasets: [], ds: null, schools: [], byKey: new Map(), bonus: [], validation: null,
    filtered: [], selected: null, markers: new Map(), listLimit: 200,
  };

  // ---------- 데이터 ----------
  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(url + ' ' + r.status);
    return r.json();
  }
  function dsStatus(ds) {
    if (ds.effective_from && today < ds.effective_from) return 'planned';
    if (ds.effective_to && today > ds.effective_to) return 'ended';
    return 'current';
  }
  function fmtDate(d) { return d ? d.replace(/-/g, '. ') + '.' : '—'; }

  // 승진 가산점: 지정 자료에 실린 지정기간만 사용. 자료에 없으면 '확인 필요'(비대상으로 처리하지 않음)
  const isActive = (b, d) => b.start_date && b.start_date <= d && (b.open_ended || (b.end_date && b.end_date >= d));
  function bonusFor(s) {
    const out = {};
    for (const t of ['island', 'rural']) {
      const recs = state.bonus.filter((b) => b.school_key === s.key && b.bonus_type === TYPE_LABEL[t])
        .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));
      const active = recs.filter((b) => isActive(b, today));
      const upcoming = recs.filter((b) => b.start_date && b.start_date > today);
      if (active.length) out[t] = { status: '대상', rec: active[active.length - 1], period: '현재 지정', all: recs };
      else if (upcoming.length) out[t] = { status: '대상', rec: upcoming[0], period: '지정 예정', all: recs };
      else if (recs.length) out[t] = { status: '지정 종료', rec: recs[recs.length - 1], period: '지정 종료', all: recs };
      else out[t] = { status: '확인 필요', rec: null, all: [] };
    }
    return out;
  }

  // ---------- 지도 ----------
  let map, cluster, boundaryLayer, tileLayer;
  function initMap() {
    map = L.map('map', { zoomControl: false, preferCanvas: false, minZoom: 8, maxZoom: 18 })
      .setView(CFG.initialCenter || [37.55, 127.15], CFG.initialZoom || 9);
    L.control.zoom({ position: 'topright' }).addTo(map);
    // 배경지도: 기본은 단순한 밝은 지도(CARTO Voyager). 오른쪽 위에서 바꿀 수 있고, 선택은 이 브라우저에 기억된다.
    const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    const CARTO = OSM + ' &copy; <a href="https://carto.com/attributions">CARTO</a>';
    const bases = {
      simple: { label: '단순 지도', layer: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', attribution: CARTO, maxZoom: 19 }) },
      light: { label: '아주 단순(흑백)', layer: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', attribution: CARTO, maxZoom: 19 }) },
      osm: { label: '자세한 지도(OSM)', layer: L.tileLayer(CFG.osmTileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: OSM, maxZoom: 19 }) },
    };
    if (CFG.vworldKey) {
      const vw = (t, ext) => `https://api.vworld.kr/req/wmts/1.0.0/${encodeURIComponent(CFG.vworldKey)}/${t}/{z}/{y}/{x}.${ext}`;
      bases.vworld_white = { label: '브이월드 흰색', layer: L.tileLayer(vw('white', 'png'), { attribution: '&copy; 국토교통부 브이월드', maxZoom: 19 }) };
      bases.vworld = { label: '브이월드 기본', layer: L.tileLayer(vw('Base', 'png'), { attribution: '&copy; 국토교통부 브이월드', maxZoom: 19 }) };
    }
    let saved = null;
    try { saved = localStorage.getItem('baseMap'); } catch {}
    const start = bases[saved] ? saved : bases[CFG.baseMap] ? CFG.baseMap : 'simple';
    let tileErr = 0, tileOk = 0;
    for (const [k, b] of Object.entries(bases)) {
      b.layer.on('tileload', () => { tileOk++; });
      b.layer.on('tileerror', () => {
        tileErr++;
        // 브이월드 키·도메인 문제로 타일이 안 나오면 단순 지도로 자동 전환
        if (k.startsWith('vworld') && tileErr >= 4 && tileOk === 0 && map.hasLayer(b.layer)) {
          map.removeLayer(b.layer); tileLayer = bases.simple.layer.addTo(map); tileErr = 0;
          $('#tileNote').textContent = '브이월드 지도를 불러오지 못해 단순 지도로 바꿨습니다.';
          return;
        }
        if (tileErr === 4 && tileOk === 0) $('#tileNote').textContent = '배경지도 타일을 불러오지 못해 시·군 경계만 표시합니다.';
      });
    }
    tileLayer = bases[start].layer.addTo(map);
    L.control.layers(Object.fromEntries(Object.values(bases).map((b) => [b.label, b.layer])), null, { position: 'topright', collapsed: true }).addTo(map);
    map.on('baselayerchange', (e) => {
      tileErr = 0; tileOk = 0; $('#tileNote').textContent = '';
      const k = Object.keys(bases).find((x) => bases[x].layer === e.layer);
      try { localStorage.setItem('baseMap', k); } catch {}
    });
    cluster = L.markerClusterGroup({
      showCoverageOnHover: false, maxClusterRadius: 46, spiderfyOnMaxZoom: true, disableClusteringAtZoom: 15,
      iconCreateFunction(c) {
        const cnt = { 갑: 0, 을: 0, 병: 0 };
        c.getAllChildMarkers().forEach((m) => cnt[m.options.zone]++);
        const n = c.getChildCount();
        let acc = 0; const segs = [];
        for (const z of ['갑', '을', '병']) {
          if (!cnt[z]) continue;
          const a = (acc / n) * 360, b = ((acc + cnt[z]) / n) * 360; acc += cnt[z];
          segs.push(`${ZONE_COLOR[z]} ${a}deg ${b}deg`);
        }
        const size = n < 10 ? 30 : n < 50 ? 36 : n < 200 ? 42 : 48;
        return L.divIcon({
          html: `<div class="cl" style="width:${size}px;height:${size}px;background:conic-gradient(${segs.join(',')})" title="갑 ${cnt.갑} · 을 ${cnt.을} · 병 ${cnt.병}"><span>${n}</span></div>`,
          className: '', iconSize: [size, size],
        });
      },
    });
    map.addLayer(cluster);
    map.on('moveend', () => { if ($('#optBounds').checked) renderList(); });
  }

  async function loadBoundaries() {
    try {
      const gj = await getJSON('data/geo/gyeonggi_sigungu.geojson');
      boundaryLayer = L.geoJSON(gj, {
        style: { color: '#6b7785', weight: 1.2, fill: true, fillColor: '#ffffff', fillOpacity: 0.12, dashArray: '3 3' },
        interactive: false,
        onEachFeature(f, layer) {
          layer.bindTooltip(f.properties.full, { permanent: true, direction: 'center', className: 'city-label', interactive: false });
        },
      }).addTo(map);
      map.fitBounds(boundaryLayer.getBounds(), { padding: [10, 10] });
      const lab = () => {
        const show = map.getZoom() >= 10 && map.getZoom() <= 12;
        boundaryLayer.eachLayer((l) => { const t = l.getTooltip(); if (t) t.setOpacity(show ? 1 : 0); });
      };
      map.on('zoomend', lab); lab();
    } catch (e) { console.warn('경계 로드 실패', e); }
  }

  function markerIcon(s, b, sel) {
    const sub = s.zone === '병' && s.zone_sub ? s.zone_sub : '';
    const badges = (b.island.status === '대상' ? '<i class="b island">도</i>' : '') + (b.rural.status === '대상' ? '<i class="b rural">농</i>' : '');
    const size = s.zone === '병' ? 20 : 16;
    return L.divIcon({
      className: '',
      html: `<div class="mk z-${s.zone}${s.status === '폐·휴교' ? ' closed' : ''}${sel ? ' sel' : ''}">${sub}${badges}</div>`,
      iconSize: [size, size], iconAnchor: [size / 2, size / 2],
    });
  }

  function buildMarkers() {
    cluster.clearLayers(); state.markers.clear();
    for (const s of state.schools) {
      if (s.location.lat == null) continue;
      const m = L.marker([s.location.lat, s.location.lng], { icon: markerIcon(s, s._bonus, false), zone: s.zone, title: s.display, keyboard: true });
      m.on('click', () => select(s.key, { pan: false }));
      m.bindTooltip(`${esc(s.display)} · ${s.zone}${s.zone_sub || ''}`, { direction: 'top', offset: [0, -8] });
      state.markers.set(s.key, m);
    }
  }

  // ---------- 필터 ----------
  function readFilters() {
    return {
      q: $('#q').value.trim().replace(/\s+/g, ''),
      office: $('#officeSel').value,
      city: $('#citySel').value,
      zones: new Set($$('#zoneChips > label input:checked').map((i) => i.value)),
      subs: new Set($$('#subChips input:checked').map((i) => i.value)),
      bonus: new Set($$('#bonusChips input:checked').map((i) => i.value)),
      closed: $('#optClosed').checked,
    };
  }
  function match(s, f) {
    if (!f.closed && s.status === '폐·휴교') return false;
    if (f.office && s.office !== f.office) return false;
    if (f.city && s.city !== f.city) return false;
    if (!f.zones.has(s.zone)) return false;
    if (s.zone === '병' && s.zone_sub && !f.subs.has(s.zone_sub)) return false;
    if (f.q) {
      const hay = (s.display + s.name_pdf + (s.name || '') + (s.parent || '')).replace(/\s+/g, '');
      if (!hay.includes(f.q)) return false;
    }
    if (f.bonus.size) {
      const b = s._bonus;
      const ok = (f.bonus.has('island') && b.island.status === '대상') || (f.bonus.has('rural') && b.rural.status === '대상') ||
        (f.bonus.has('unknown') && (b.island.status === '확인 필요' || b.rural.status === '확인 필요'));
      if (!ok) return false;
    }
    return true;
  }

  function applyFilters() {
    const f = readFilters();
    state.filtered = state.schools.filter((s) => match(s, f));
    const keep = state.filtered.filter((s) => state.markers.has(s.key)).map((s) => state.markers.get(s.key));
    cluster.clearLayers();
    cluster.addLayers(keep);
    state.listLimit = 200;
    renderList();
    saveHash();
  }

  // ---------- 목록 ----------
  function zoneLabel(s) { return s.zone + (s.zone_sub ? '·' + s.zone_sub : ''); }
  function itemHTML(s) {
    const b = s._bonus;
    const pills = [];
    if (s.status === '신설예정') pills.push('<span class="pill new">신설예정</span>');
    if (s.status === '폐·휴교') pills.push('<span class="pill closed">폐·휴교</span>');
    if (s.kind === '분교장') pills.push('<span class="pill">분교장</span>');
    if (b.island.status === '대상') pills.push(`<span class="pill island">도서벽지 ${esc(b.island.rec.grade)} · 월 ${esc(b.island.rec.monthly_points || '?')}</span>`);
    if (b.rural.status === '대상') pills.push(`<span class="pill rural">${esc(b.rural.rec.category === '공단' ? '공단' : /접경|교육특별/.test(b.rural.rec.category) ? '접경' : '농어촌')} ${esc(/^[읍면]$|^공단$/.test(b.rural.rec.grade) ? b.rural.rec.grade : '')} · 월 ${esc(b.rural.rec.monthly_points || '?')}</span>`);
    if (s.location.lat == null && s.status !== '폐·휴교') pills.push('<span class="pill warn">위치 확인 필요</span>');
    return `<li class="item${state.selected === s.key ? ' sel' : ''}" data-key="${esc(s.key)}" tabindex="0">
      <span class="nm">${esc(s.display)}</span>
      <span class="right"><span class="zb z-${s.zone}">${esc(zoneLabel(s))}</span></span>
      <span class="meta">${esc(s.city)} · ${esc(s.office)} ${pills.join(' ')}</span></li>`;
  }

  function renderList() {
    const inBounds = $('#optBounds').checked;
    const bounds = map.getBounds();
    const located = [], noloc = [];
    for (const s of state.filtered) {
      if (s.location.lat == null) { noloc.push(s); continue; }
      if (inBounds && !bounds.contains([s.location.lat, s.location.lng])) continue;
      located.push(s);
    }
    const sorter = (a, b) => a.city.localeCompare(b.city, 'ko') || a.display.localeCompare(b.display, 'ko');
    located.sort(sorter); noloc.sort(sorter);
    const shown = located.slice(0, state.listLimit);
    $('#list').innerHTML = shown.map(itemHTML).join('') +
      (located.length > shown.length ? `<li class="empty"><button class="btn" id="moreBtn" type="button">${located.length - shown.length}곳 더 보기</button></li>` : '') +
      (located.length === 0 ? `<li class="empty">${inBounds ? '현재 지도 영역에 조건에 맞는 학교가 없습니다. 지도를 이동하거나 축소해 보세요.' : '조건에 맞는 학교가 없습니다.'}</li>` : '');
    $('#nolocList').innerHTML = noloc.map(itemHTML).join('');
    $('#nolocSum').textContent = `위치 확인 필요 ${noloc.length}곳 (조건 일치, 지도 미표시)`;
    $('#nolocBox').hidden = noloc.length === 0;
    const more = $('#moreBtn'); if (more) more.onclick = () => { state.listLimit += 300; renderList(); };
    // 요약
    const all = state.filtered;
    const zc = { 갑: 0, 을: 0, 병: 0 };
    all.forEach((s) => zc[s.zone]++);
    const total = located.length + noloc.length;
    $('#summary').innerHTML = `<span>조건 일치 <b>${all.length.toLocaleString()}</b>곳</span>` +
      (inBounds ? `<span class="muted">지도 영역 ${located.length.toLocaleString()}곳</span>` : '') +
      ['갑', '을', '병'].map((z) => `<span class="zc"><i class="dot z-${z}"></i>${z} ${zc[z]}</span>`).join('');
    $('#mCount').textContent = `(${total})`;
  }

  // ---------- 상세 ----------
  function transferInfo(s) {
    const rows = [];
    if (s.zone === '을') rows.push('을구역: 현임교 근무년수 <b>50%</b>');
    if (s.zone === '병') {
      if (['가', '나'].includes(s.zone_sub)) rows.push(`병구역 ${s.zone_sub}: 현임교 근무년수 <b>100%</b>`);
      else if (['다', '라'].includes(s.zone_sub)) rows.push(`병구역 ${s.zone_sub}: 현임교 근무년수 <b>70%</b>`);
    }
    if (s.zone === '갑') rows.push('갑구역: 지역가산표에 해당 항목 없음');
    if (s.kind === '분교장') rows.push('분교장: 지역가산표 "5학급이하의 학교, 분교장" 항목(현임교 근무년수 30%) 해당 가능');
    else rows.push('<span class="muted">5학급 이하 학교 항목(30%)은 학급수 자료가 없어 확인 필요</span>');
    return rows;
  }

  function fmtYMD(d) { return d ? d.replace(/-/g, '.') : ''; }
  function periodText(r) { return `${fmtYMD(r.start_date)} ~ ${r.open_ended ? '현재' : fmtYMD(r.end_date) || '?'}`; }
  function bonusBox(t, b) {
    const label = t === 'island' ? '도서·벽지(접적 포함)' : '농어촌·공단·접경';
    if (!b.rec) {
      return `<div class="box promo"><div class="t">${label} 승진 가산점</div>
        <div><span class="status-unk">확인 필요</span> · 등록된 지정 자료(문서 31~41쪽)에 이 학교가 없습니다. 자료에 누락이 있을 수 있어 '비대상'으로 처리하지 않습니다.</div></div>`;
    }
    const r = b.rec, pdf = state.bonusMeta?.source?.file;
    const pageLink = (x) => pdf && x.pdf_page ? `<a href="${esc(pdf)}#page=${x.pdf_page}" target="_blank" rel="noopener">${esc(x.evidence_page)}쪽</a>` : `${esc(x.evidence_page)}쪽`;
    const head = b.status === '대상'
      ? `<b>${esc(b.period)}</b> · ${esc(r.category)}${r.grade ? ' · ' + esc(r.grade) + (/^[가나다라]$/.test(r.grade) ? '급지' : '') : ''}`
      : `<b>지정 종료</b> <span class="muted">(지정 이력만 있음)</span>`;
    const ruleLink = (x) => state.bonusMeta?.rule?.file && x.rule_pdf_page ? ` · <a href="${esc(state.bonusMeta.rule.file)}#page=${x.rule_pdf_page}" target="_blank" rel="noopener">원문</a>` : '';
    const hist = b.all.map((x) => `<tr><td>${esc(x.category)}</td><td>${esc(x.grade || '—')}</td><td>${periodText(x)}</td><td>${esc(x.monthly_points || '확인 필요')}</td><td>${pageLink(x)}</td></tr>`).join('');
    const rules = (state.bonusMeta?.common_rules?.[TYPE_LABEL[t]] || []);
    return `<div class="box promo"><div class="t">${label} 승진 가산점 · ${head}</div>
      <dl class="kv">
        <dt>지정 기간</dt><dd>${periodText(r)}</dd>
        <dt>구분·급지</dt><dd>${esc(r.category)} · ${esc(r.grade || '—')}</dd>
        <dt>월 평정점</dt><dd>${r.monthly_points ? `<b>${esc(r.monthly_points)}</b> <span class="muted small">(일 ${esc(r.daily_points || '—')})</span>` : '<span class="status-unk">확인 필요</span>'}</dd>
        ${r.points_basis ? `<dt>점수 구분</dt><dd class="small">${esc(r.points_basis)}</dd>` : ''}
        <dt>상한점</dt><dd>${r.cap_points ? esc(r.cap_points) : '<span class="status-unk">확인 필요</span>'}</dd>
        ${r.combined_cap_points ? `<dt>합산 상한점</dt><dd class="small">${esc(r.combined_cap_points)}</dd>` : ''}
        ${r.conditions ? `<dt>조건</dt><dd>${esc(r.conditions)}</dd>` : ''}
        <dt>평정 규정</dt><dd>${r.rule_doc ? esc(r.rule_doc) + (ruleLink(r)) : '<span class="muted">확인 필요</span>'}</dd>
        <dt>지정 자료</dt><dd>${esc(r.designation_doc)}, ${pageLink(r)}</dd>
        <dt>확인일</dt><dd>${fmtDate(r.verified_date)}</dd>
        ${r.note ? `<dt>비고</dt><dd class="small">${esc(r.note)}</dd>` : ''}
      </dl>
      ${(() => { const c = state.bonusMeta?.caution; const t2 = Array.isArray(c) ? c[t === 'island' ? 0 : 1] : c; return t2 ? `<div class="src">원문 유의사항: ${esc(t2)}</div>` : ''; })()}
      ${b.all.length > 1 ? `<details class="small"><summary>지정 이력 ${b.all.length}건</summary>
        <div style="overflow-x:auto"><table class="mini"><thead><tr><th>구분</th><th>급지</th><th>기간</th><th>월 평정점</th><th>쪽</th></tr></thead><tbody>${hist}</tbody></table></div></details>` : ''}
      ${rules.length ? `<details class="small"><summary>평정 시 공통 기준</summary><ul style="padding-left:18px;margin:4px 0">${rules.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
    </div>`;
  }

  function renderDetail(s) {
    const b = s._bonus, loc = s.location, src = s.source;
    const q = encodeURIComponent((s.name || s.display) + ' ' + s.city);
    const qa = loc.address ? encodeURIComponent(loc.address) : null;
    const links = [];
    if (s.homepage) links.push(`<a href="${esc(s.homepage)}" target="_blank" rel="noopener">학교 홈페이지</a>`);
    if (loc.lat != null) {
      links.push(`<a href="https://map.kakao.com/link/map/${encodeURIComponent(s.display)},${loc.lat},${loc.lng}" target="_blank" rel="noopener">카카오맵(좌표)</a>`);
      links.push(`<a href="https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lng}#map=17/${loc.lat}/${loc.lng}" target="_blank" rel="noopener">OpenStreetMap</a>`);
    }
    links.push(`<a href="https://map.kakao.com/link/search/${q}" target="_blank" rel="noopener">카카오맵 검색</a>`);
    links.push(`<a href="https://map.naver.com/p/search/${q}" target="_blank" rel="noopener">네이버지도 검색</a>`);
    if (qa) links.push(`<a href="https://map.naver.com/p/search/${qa}" target="_blank" rel="noopener">네이버지도(주소)</a>`);
    links.push(`<a href="https://www.schoolinfo.go.kr/" target="_blank" rel="noopener">학교알리미</a>`);

    $('#detailBody').innerHTML = `
      <div class="muted small">${esc(s.office)} · ${esc(s.city)}</div>
      <h2>${esc(s.display)}</h2>
      <div>${s.kind === '분교장' ? `<span class="pill">분교장 · 본교 ${esc(s.parent || '확인 필요')}</span> ` : '<span class="pill">본교</span> '}
        ${s.status === '운영' ? '' : `<span class="pill ${s.status === '신설예정' ? 'new' : 'closed'}">${esc(s.status)}</span>`}
        ${s.provisional_name ? '<span class="pill warn">가칭</span>' : ''}</div>

      <h3>기본 정보</h3>
      <dl class="kv">
        <dt>공식 학교명</dt><dd>${s.name ? esc(s.name) : '<span class="status-unk">확인 필요</span> (PDF 표기: ' + esc(s.name_pdf) + ')'}</dd>
        <dt>PDF 표기</dt><dd>${esc(s.name_pdf)}</dd>
        <dt>주소</dt><dd>${loc.address ? esc(loc.address) + (loc.address_jibun ? `<div class="muted small">지번: ${esc(loc.address_jibun)}</div>` : '') : '<span class="status-unk">확인 필요</span>'}</dd>
        <dt>교육지원청</dt><dd>${esc(s.office)}</dd>
        <dt>시·군</dt><dd>${esc(s.city)}</dd>
        <dt>학교ID</dt><dd>${s.codes.school_id ? esc(s.codes.school_id) + ` <span class="muted small">(${esc(s.codes.school_id_status)})</span>` : '<span class="muted">확인 필요</span>'}</dd>
        ${s.codes.neis ? `<dt>NEIS 코드</dt><dd>${esc(s.codes.neis)} <span class="muted small">(${esc(s.codes.neis_status)})</span></dd>` : ''}
      </dl>

      <h3>인사구역 (전보 관리 구역)</h3>
      <div><span class="zb z-${s.zone}" style="font-size:14px;padding:3px 10px">${esc(s.zone)}${s.zone_sub ? ' · ' + esc(s.zone_sub) : ''}</span>
        <span class="muted small"> ${s.zone === '병' ? '병구역 세부구분 ' + esc(s.zone_sub || '없음') : ''}</span></div>
      <div class="box transfer"><div class="t">전보 가산 (지역가산표, 승진 가산점 아님)</div>
        <ul style="margin:0;padding-left:18px">${transferInfo(s).map((x) => `<li>${x}</li>`).join('')}</ul>
        <div class="src">근거: 인사관리세부기준 제16조③ [지역가산표], 문서 11쪽${state.ds.pdf ? ` (<a href="${esc(state.ds.pdf)}#page=12" target="_blank" rel="noopener">원문</a>)` : ''} · 현임교 근무년수는 5년 초과 불가</div></div>
      <div class="src">근거: ${esc(src.doc)} ${esc(src.table)}, 문서 ${src.doc_page}쪽(PDF ${src.pdf_page}쪽)${state.ds.pdf ? ` · <a href="${esc(state.ds.pdf)}#page=${src.pdf_page}" target="_blank" rel="noopener">원문 보기</a>` : ''}<br>
        적용: ${fmtDate(src.effective_from)} ~ ${src.effective_to ? fmtDate(src.effective_to) : '차기 기준 시행 전까지'} · 확인일 ${fmtDate(src.checked)}</div>

      <h3>승진 가산점 (승진 평정, 인사구역과 별개)</h3>
      ${b.island.status === '대상' && s.zone === '병' && b.island.rec.grade && s.zone_sub && b.island.rec.grade !== s.zone_sub ? `<div class="src">인사구역 병·${esc(s.zone_sub)}와 도서벽지 급지 ${esc(b.island.rec.grade)}는 서로 다른 기준입니다.</div>` : ''}
      ${s.status === '폐·휴교' && (b.island.status === '대상' || b.rural.status === '대상') ? '<div class="src">별표1에는 폐·휴교로 표시되어 있으나 지정 자료에는 지정이 유지된 것으로 적혀 있습니다.</div>' : ''}
      ${bonusBox('island', b.island)}
      ${bonusBox('rural', b.rural)}

      <h3>위치</h3>
      <dl class="kv">
        <dt>상태</dt><dd>${loc.lat != null ? esc(loc.status) : '<span class="status-unk">' + esc(loc.status) + '</span>'}</dd>
        ${loc.lat != null ? `<dt>좌표</dt><dd>${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}</dd>` : ''}
        ${loc.source ? `<dt>좌표 출처</dt><dd class="small">${esc(loc.source)}</dd>` : ''}
      </dl>
      <h3>연결</h3>
      <div class="links">${links.join('')}</div>
      ${s.homepage ? '' : '<div class="src">학교 홈페이지 주소는 공식 자료로 확인되지 않아 등록하지 않았습니다.</div>'}
      ${s.notes.length ? `<h3>비고 (원문 표기)</h3><ul class="small" style="padding-left:18px;margin:0">${s.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    `;
    $('#detail').hidden = false;
  }

  function select(key, { pan = true } = {}) {
    const prev = state.selected && state.byKey.get(state.selected);
    if (prev && state.markers.has(prev.key)) state.markers.get(prev.key).setIcon(markerIcon(prev, prev._bonus, false));
    state.selected = key;
    const s = state.byKey.get(key);
    if (!s) return;
    $$('.item.sel').forEach((el) => el.classList.remove('sel'));
    $$(`.item[data-key="${CSS.escape(key)}"]`).forEach((el) => el.classList.add('sel'));
    renderDetail(s);
    const m = state.markers.get(key);
    if (m) {
      m.setIcon(markerIcon(s, s._bonus, true));
      if (pan) {
        if (window.matchMedia('(max-width:860px)').matches) setView('map');
        cluster.zoomToShowLayer(m, () => {
          map.setView(m.getLatLng(), Math.max(map.getZoom(), 13), { animate: false });
          if (!window.matchMedia('(max-width:860px)').matches) map.panBy([-190, 0], { animate: false }); // 상세창 폭만큼 보정
        });
      }
    }
    saveHash();
  }

  // ---------- 상태 저장(URL) ----------
  function saveHash() {
    const f = readFilters();
    const p = new URLSearchParams();
    if (state.ds) p.set('y', state.ds.year);
    if (f.q) p.set('q', f.q);
    if (f.office) p.set('o', f.office);
    if (f.city) p.set('c', f.city);
    if (f.zones.size < 3) p.set('z', [...f.zones].join(''));
    if (f.subs.size < 4) p.set('zs', [...f.subs].join(''));
    if (f.bonus.size) p.set('b', [...f.bonus].join(','));
    if (f.closed) p.set('cl', '1');
    if (state.selected) p.set('s', state.selected);
    if (!window.ARTIFACT_MODE) history.replaceState(null, '', '#' + p.toString());
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    if (p.get('q')) $('#q').value = p.get('q');
    if (p.get('o')) $('#officeSel').value = p.get('o');
    if (p.get('c')) $('#citySel').value = p.get('c');
    if (p.get('z') != null) $$('#zoneChips > label input').forEach((i) => (i.checked = p.get('z').includes(i.value)));
    if (p.get('zs') != null) $$('#subChips input').forEach((i) => (i.checked = p.get('zs').includes(i.value)));
    if (p.get('b')) $$('#bonusChips input').forEach((i) => (i.checked = p.get('b').split(',').includes(i.value)));
    if (p.get('cl')) $('#optClosed').checked = true;
    return p;
  }

  // ---------- 자료 점검 ----------
  function renderChecks() {
    const v = state.validation;
    if (!v) { $('#checkBody').innerHTML = '<p>점검 결과가 없습니다.</p>'; return; }
    const sm = v.summary;
    const zoneRows = Object.entries(sm.zones).map(([k, n]) => `<tr><td>${esc(k)}</td><td>${n}</td></tr>`).join('');
    const cityAgg = {};
    for (const s of state.schools) {
      if (s.status === '폐·휴교') continue;
      const c = (cityAgg[s.city] ||= { 갑: 0, 을: 0, 병: 0, 분교장: 0, loc: 0, n: 0 });
      if (s.kind === '분교장') c.분교장++; else c[s.zone]++;
      c.n++; if (s.location.lat != null) c.loc++;
    }
    const cityRows = Object.entries(cityAgg).sort((a, b) => a[0].localeCompare(b[0], 'ko'))
      .map(([c, x]) => `<tr><td>${esc(c)}</td><td>${x.갑}</td><td>${x.을}</td><td>${x.병}</td><td>${x.분교장}</td><td>${x.loc}/${x.n}</td></tr>`).join('');
    const det = (d) => {
      if (Array.isArray(d)) return d.length ? `<details><summary>${d.length}건 보기</summary><ul>${d.map((x) => `<li>${esc(typeof x === 'string' ? x : JSON.stringify(x))}</li>`).join('')}</ul></details>` : '없음';
      if (d && typeof d === 'object') return `<details><summary>보기</summary><pre class="small">${esc(JSON.stringify(d, null, 1))}</pre></details>`;
      return esc(d);
    };
    $('#checkBody').innerHTML = `
      <p class="small muted">생성일 ${fmtDate(v.generated)} · ${esc(v.document.title)} ${esc(v.document.table)} (${esc(v.document.table_doc_pages)})</p>
      <p>추출 레코드 ${sm.records}건 = 운영 본교 ${sm.operating_main} + 운영 분교장 ${sm.operating_branch} + 폐·휴교 ${sm.status['폐·휴교'] || 0} (신설예정 ${sm.status['신설예정'] || 0}곳은 본교 수에 포함) · 좌표 표시 ${sm.with_location}곳</p>
      ${v.checks.map((c) => `<div class="chk"><div class="h"><span class="${c.ok ? 'ok' : 'ng'}">${c.ok ? '통과' : '확인 필요'}</span> · ${esc(c.name)}</div><div class="small">${det(c.detail)}</div></div>`).join('')}
      <h3>시·군별 운영교 (분교장 별도) · 좌표 확보</h3>
      <table class="mini"><thead><tr><th>시·군</th><th>갑</th><th>을</th><th>병</th><th>분교장</th><th>좌표</th></tr></thead><tbody>${cityRows}</tbody></table>
      ${window.ARTIFACT_MODE ? '<p class="small muted">CSV 내려받기와 자료 수정은 서버 버전(관리 화면)에서 제공합니다.</p>' : `<p class="small"><a href="data/${state.ds.year}/schools.csv" download>학교 자료 CSV 내려받기</a> · <a href="data/bonus/promotion_bonus.csv" download>승진 가산점 CSV 양식</a></p>`}`;
  }

  // ---------- 화면 전환 ----------
  function setView(v) {
    $('#layout').dataset.view = v;
    $$('.mobile-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    if (v === 'map') setTimeout(() => map.invalidateSize(), 50);
  }

  // ---------- 시작 ----------
  async function loadDataset(ds) {
    state.ds = ds;
    const data = await getJSON(ds.path);
    state.schools = data.schools;
    state.byKey = new Map(state.schools.map((s) => [s.key, s]));
    state.schools.forEach((s) => (s._bonus = bonusFor(s)));
    try { state.validation = await getJSON(ds.validation); } catch { state.validation = null; }
    const st = dsStatus(ds);
    const others = state.datasets.filter((d) => d !== ds && dsStatus(d) === 'current');
    $('#basis').innerHTML = `<span class="tag ${st === 'planned' ? 'planned' : 'current'}">${st === 'planned' ? '시행 예정 기준' : st === 'ended' ? '종료된 기준' : '현재 시행 기준'}</span>` +
      `${esc(ds.label)} 인사구역 · 적용 ${fmtDate(ds.effective_from)}부터 · ${esc(ds.revision)}` +
      (st === 'planned' ? (others.length ? ` · 현재 시행: ${esc(others[0].label)}` : ' · <span title="현재 시행 중인 연도 자료 미등록">현재 시행 기준 자료 미등록</span>') : '');
    const offices = [...new Set(state.schools.map((s) => s.office))].sort((a, b) => a.localeCompare(b, 'ko'));
    $('#officeSel').innerHTML = '<option value="">전체</option>' + offices.map((o) => `<option>${esc(o)}</option>`).join('');
    fillCities();
    buildMarkers();
    const locSrc = [...new Set(state.schools.map((s) => s.location.status))];
    $('#locHelp').innerHTML = `학교ID·주소·좌표는 공공데이터포털 「전국초중등학교위치표준데이터」(제공 한국교육시설안전원, 기준일 2026-10-01)에서 학교명과 교육지원청으로 찾아 넣었습니다. 좌표가 해당 시·군 경계 안에 있고, 주소의 시·군과 본교·분교 구분이 맞을 때만 지도에 표시합니다. 이 자료에 없는 학교(신설예정교 등)는 지도에 찍지 않고 목록의 '위치 확인 필요'에 둡니다. 현재 상태: ${locSrc.map(esc).join(', ')}.`;
  }
  function fillCities() {
    const off = $('#officeSel').value, cur = $('#citySel').value;
    const cities = [...new Set(state.schools.filter((s) => !off || s.office === off).map((s) => s.city))].sort((a, b) => a.localeCompare(b, 'ko'));
    $('#citySel').innerHTML = '<option value="">전체</option>' + cities.map((c) => `<option${c === cur ? ' selected' : ''}>${esc(c)}</option>`).join('');
  }
  function fitToFiltered() {
    const pts = state.filtered.filter((s) => s.location.lat != null).map((s) => [s.location.lat, s.location.lng]);
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.08), { maxZoom: 14 });
  }

  async function start() {
    if (window.matchMedia('(max-width:860px)').matches) $('#legend').open = false;
    initMap();
    loadBoundaries();
    const reg = await getJSON('data/datasets.json');
    state.datasets = reg.datasets;
    try { const bj = await getJSON('data/bonus/promotion_bonus.json'); state.bonus = bj.records || []; state.bonusMeta = bj; } catch { state.bonus = []; }
    const pref = state.datasets.find((d) => dsStatus(d) === 'current') || state.datasets[state.datasets.length - 1];
    const hashY = new URLSearchParams(location.hash.slice(1)).get('y');
    const ds = state.datasets.find((d) => String(d.year) === hashY) || pref;
    $('#yearSel').innerHTML = state.datasets.map((d) => `<option value="${d.year}"${d === ds ? ' selected' : ''}>${esc(d.label)} (${dsStatus(d) === 'planned' ? '시행 예정' : dsStatus(d) === 'current' ? '현재 시행' : '종료'})</option>`).join('');
    await loadDataset(ds);
    const p = readHash();
    fillCities();
    if (p.get('c')) $('#citySel').value = p.get('c');
    applyFilters();
    if (p.get('s') && state.byKey.has(p.get('s'))) select(p.get('s'));

    // 이벤트
    let t; $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(applyFilters, 180); });
    $('#officeSel').addEventListener('change', () => { fillCities(); applyFilters(); fitToFiltered(); });
    $('#citySel').addEventListener('change', () => { applyFilters(); fitToFiltered(); });
    $$('#zoneChips input, #bonusChips input, #optClosed').forEach((i) => i.addEventListener('change', applyFilters));
    $('#optBounds').addEventListener('change', renderList);
    $('#resetBtn').addEventListener('click', () => {
      $('#q').value = ''; $('#officeSel').value = ''; fillCities(); $('#citySel').value = '';
      $$('#zoneChips input').forEach((i) => (i.checked = true)); $$('#bonusChips input').forEach((i) => (i.checked = false));
      $('#optClosed').checked = false; applyFilters(); if (boundaryLayer) map.fitBounds(boundaryLayer.getBounds());
    });
    const onItem = (e) => { const li = e.target.closest('.item'); if (li) select(li.dataset.key); };
    $('#list').addEventListener('click', onItem); $('#nolocList').addEventListener('click', onItem);
    $('#panel').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('item')) select(e.target.dataset.key); });
    $('#detailClose').addEventListener('click', () => {
      $('#detail').hidden = true;
      const s = state.byKey.get(state.selected); state.selected = null;
      if (s && state.markers.has(s.key)) state.markers.get(s.key).setIcon(markerIcon(s, s._bonus, false));
      $$('.item.sel').forEach((el) => el.classList.remove('sel')); saveHash();
    });
    $('#helpBtn').addEventListener('click', () => $('#helpDlg').showModal());
    $('#checkBtn').addEventListener('click', () => { renderChecks(); $('#checkDlg').showModal(); });
    $('#yearSel').addEventListener('change', async (e) => {
      const d = state.datasets.find((x) => String(x.year) === e.target.value);
      $('#detail').hidden = true; state.selected = null;
      await loadDataset(d); applyFilters();
    });
    $$('.mobile-tabs button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  }

  start().catch((e) => {
    console.error(e);
    $('#basis').textContent = '자료를 불러오지 못했습니다: ' + e.message + ' (웹 서버로 열어야 합니다. README 참고)';
  });
})();
