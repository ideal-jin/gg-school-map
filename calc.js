/* 내 승진 가산점 계산기(도서·벽지·접적 / 농어촌·공단·접경) + 갑구역 만기 확인 — 참고용 추정
 * 근거: 승진평정 참고자료 3)·4)·5) 평정점 표(문서 16~18쪽), 지정 현황(문서 31~41쪽)
 * 입력한 근무 이력은 이 브라우저(localStorage)에만 저장되고 서버로 보내지 않는다.
 */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STORE = 'myBonusRows.v1';
  const NO_DUP_FROM = '2007-03-01';     // 이후 경력은 도서벽지·접경·농어촌 중복 인정 불가(문서 16쪽 ④)
  const CAP = { 도서벽지: 2.0, 농어촌: 2.0, 합산: 2.0 };
  // 직접 입력용 평정점(문서 16~17쪽)
  const MANUAL = {
    '도서벽지|가': ['0.045', '0.0015'], '도서벽지|나': ['0.036', '0.0012'], '도서벽지|다': ['0.027', '0.0009'], '도서벽지|라': ['0.018', '0.0006'],
    '농어촌|면(읍면)': ['0.018', '0.0006'], '농어촌|접경': ['0.018', '0.0006'], '농어촌|읍(동)': ['0.015', '0.0005'],
    '농어촌|교육감지정 접경(교육특별)': ['0.015', '0.0005'], '농어촌|공단': ['0.012', '0.0004'],
  };

  // ---------- 날짜 ----------
  const D = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const S = (dt) => dt.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return S(d); };
  function addMonths(s, n) {
    const d = D(s), day = d.getUTCDate();
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(day, last));
    return S(t);
  }
  /** 시작~종료(양끝 포함)를 '만 개월 + 남은 일'로 */
  function monthsDays(a, b) {
    let m = 0, cur = a;
    while (addDays(addMonths(cur, 1), -1) <= b) { cur = addMonths(cur, 1); m++; }
    const days = cur <= b ? Math.round((D(b) - D(cur)) / 86400000) + 1 : 0;
    return { months: m, days };
  }
  const maxS = (a, b) => (a > b ? a : b), minS = (a, b) => (a < b ? a : b);

  // ---------- 상태 ----------
  let rows = [];
  try { rows = JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { rows = []; }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(rows)); } catch {} };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const G = () => window.GG;   // app.js가 공개하는 학교·가산점 자료

  // ---------- 계산 ----------
  /** 한 행에서 가산점이 붙는 구간 목록: [{type, label, grade, start, end, m, d}] */
  function segmentsFor(row, asOf) {
    const end = minS(row.end || asOf, asOf);
    if (!row.start || row.start > end) return { segs: [], warn: [] };
    let cands = [];
    const warn = [];
    if (row.mode === 'manual') {
      const pts = MANUAL[`${row.type}|${row.grade}`];
      if (pts) cands.push({ type: row.type, label: row.type === '도서벽지' ? `${row.grade}급지` : row.grade, start: row.start, end, m: +pts[0], d: +pts[1], src: '직접 입력' });
    } else {
      const recs = (G().state.bonus || []).filter((b) => b.school_key === row.key && b.monthly_points && b.start_date);
      for (const b of recs) {
        const bEnd = b.open_ended ? '9999-12-31' : (b.end_date || b.start_date);
        const s = maxS(row.start, b.start_date), e = minS(end, bEnd);
        if (s > e) continue;
        cands.push({ type: b.bonus_type, label: `${b.category} ${b.grade}`.trim(), start: s, end: e, m: +b.monthly_points, d: +b.daily_points || 0, src: `${b.evidence_page}쪽` });
        if (b.bonus_type === '농어촌' && s < '1998-01-01') warn.push("'95~'97년 농어촌 경력은 주민등록 요건 확인 필요(문서 17쪽 ②)");
      }
      if (!recs.length) warn.push('NOREC');
    }
    // 2007.3.1 이후 겹치는 날은 높은 점수 하나만
    const cuts = [...new Set(cands.flatMap((c) => [c.start, addDays(c.end, 1)]).concat([NO_DUP_FROM]))].sort();
    const pieces = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i], b = addDays(cuts[i + 1], -1);
      let act = cands.filter((c) => c.start <= a && c.end >= b);
      if (!act.length) continue;
      if (act.length > 1 && a >= NO_DUP_FROM) {
        act = [act.sort((x, y) => (y.m - x.m) || ((x.type === '도서벽지' ? 0 : 1) - (y.type === '도서벽지' ? 0 : 1)))[0]];   // 같은 점수면 도서벽지·접적 우선(문서 18쪽 라)①)
        warn.push('2007.3.1. 이후 도서벽지·농어촌(접경) 지정이 겹치는 기간은 한 가지 점수만 계산(문서 16쪽 ④, 18쪽 라)①)');
      }
      for (const c of act) {
        const last = pieces[pieces.length - 1];
        if (last && last.c === c && addDays(last.end, 1) === a) last.end = b;
        else pieces.push({ c, start: a, end: b });
      }
    }
    const segs = pieces.map((p) => {
      const md = monthsDays(p.start, p.end);
      const pts = md.months * p.c.m + md.days * p.c.d;
      return { type: p.c.type, label: p.c.label, start: p.start, end: p.end, months: md.months, days: md.days, m: p.c.m, d: p.c.d, pts, src: p.c.src };
    });
    return { segs, warn: [...new Set(warn)] };
  }

  function compute(asOf) {
    const res = rows.map((r) => Object.assign({ row: r }, segmentsFor(r, asOf)));
    const raw = { 도서벽지: 0, 농어촌: 0 };
    res.forEach((x) => x.segs.forEach((s) => (raw[s.type] += s.pts)));
    const capped = { 도서벽지: Math.min(raw.도서벽지, CAP.도서벽지), 농어촌: Math.min(raw.농어촌, CAP.농어촌) };
    const total = Math.min(capped.도서벽지 + capped.농어촌, CAP.합산);
    // 서로 다른 행이 같은 날짜를 겹쳐 쓰면 경고
    const overlaps = [];
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      if (a.start && b.start && maxS(a.start, b.start) <= minS(a.end || asOf, b.end || asOf)) overlaps.push(`${i + 1}번과 ${j + 1}번 근무기간이 겹칩니다.`);
    }
    return { res, raw, capped, total, overlaps };
  }

  // ---------- 갑구역 만기 (인사관리세부기준 제10조, 2019 부칙 제6조) ----------
  const GAP_MONTHS = 120;   // 10년
  function rowZone(r) {
    if (r.zone) return r.zone;                                  // 근무 당시 구역(사용자 지정)
    if (r.mode === 'manual') return '';
    const s = G().state.byKey.get(r.key); return s ? s.zone : '';
  }
  function rowOffice(r) {
    if (r.mode === 'manual') return r.office || '';
    const s = G().state.byKey.get(r.key); return s ? s.office : '';
  }
  function addMD(a, b) { let m = a.months + b.months, d = a.days + b.days; m += Math.floor(d / 30); d %= 30; return { months: m, days: d }; }
  /** 기준 정기전보일(transferDate) 전날까지의 연속 갑구역 근무 */
  function gapStatus(opt) {
    const T = opt.transferDate, upto = addDays(T, -1);
    const list = rows.map((r, i) => ({ r, i, start: r.start, end: minS(r.end || upto, upto) }))
      .filter((x) => x.start && x.start <= x.end).sort((a, b) => a.start.localeCompare(b.start));
    const out = { chain: [], total: { months: 0, days: 0 }, notes: [], verdict: '', level: '' };
    if (!list.length) { out.verdict = '근무 이력을 입력하면 확인할 수 있습니다.'; out.level = 'none'; return out; }
    const last = list[list.length - 1];
    const lastZone = rowZone(last.r), lastOffice = rowOffice(last.r);
    const ongoing = !last.r.end || last.r.end >= upto;
    if (!['갑', '특'].includes(lastZone)) {
      out.verdict = lastZone ? `가장 최근 근무(${last.i + 1}번)가 ${lastZone}구역이라 갑구역 만기 대상이 아닙니다.` : `가장 최근 근무(${last.i + 1}번)의 인사구역을 골라 주세요.`;
      out.level = lastZone ? 'ok' : 'none'; return out;
    }
    // 뒤에서부터 같은 교육지원청의 갑(특) 근무를 이어 붙인다. 을·병 근무나 다른 교육지원청에서 끊는다.
    for (let k = list.length - 1; k >= 0; k--) {
      const x = list[k], z = rowZone(x.r), o = rowOffice(x.r);
      if (!['갑', '특'].includes(z)) { out.notes.push(`${x.i + 1}번(${z || '구역 미지정'}) 이후의 갑구역 근무부터 합산했습니다.`); break; }
      if (o !== lastOffice) { out.notes.push(`${x.i + 1}번은 다른 교육지원청(${o || '미상'}) 근무라 산입하지 않았습니다(제10조①2의1).`); break; }
      const md = monthsDays(x.start, x.end);
      out.chain.unshift({ i: x.i, start: x.start, end: x.end, zone: z, md });
      out.total = addMD(out.total, md);
    }
    const tm = out.total.months;
    const y = Math.floor(tm / 12), m = tm % 12;
    out.totalText = `${y}년 ${m}개월 ${out.total.days}일`;
    // 만기 도래 예상일(현재 근무가 계속된다고 가정)
    if (ongoing) {
      const remM = GAP_MONTHS - tm, remD = out.total.days;
      out.expiry = remM > 0 || (remM === 0 && remD === 0) ? addDays(addMonths(upto, remM), -remD + 1) : null;
      if (out.expiry && out.expiry <= upto) out.expiry = null;
    }
    const reached = tm >= GAP_MONTHS;
    // 예외
    const ex = [];
    if (opt.birth) {
      const age = (() => { const b = D(opt.birth), t = D(T); let a = t.getUTCFullYear() - b.getUTCFullYear(); if (t.getUTCMonth() < b.getUTCMonth() || (t.getUTCMonth() === b.getUTCMonth() && t.getUTCDate() < b.getUTCDate())) a--; return a; })();
      out.age = age;
      if (age >= 58) ex.push(`정기전보일 현재 만 ${age}세(58세 이상)로 해당 인사구역에서 정년까지 계속 근무할 수 있습니다(제10조②2).`);
    }
    if (opt.disabled) ex.push('장애의 정도가 심한 장애인으로 등록된 교사는 정년까지 계속 근무할 수 있습니다(제10조②3).');
    out.exceptions = ex;
    out.defer = opt.threeKids ? '세 자녀 이상 교사는 본인 희망으로 2년간 유예할 수 있습니다(18세 이하 자녀가 주민등록상 생활근거지에 등재, 1년 단위·2회 이내, 제10조③).' : '';
    if (reached && ex.length) { out.level = 'ok'; out.verdict = `갑구역 ${out.totalText} 근무로 10년이 지났지만 예외에 해당합니다.`; }
    else if (reached) { out.level = 'hit'; out.verdict = `${fmtK(T)} 정기전보 기준 갑구역 근무 ${out.totalText} → 갑만기 해당`; }
    else { out.level = 'ok'; out.verdict = `${fmtK(T)} 정기전보 기준 갑구역 근무 ${out.totalText} → 갑만기 아님`; }
    if (!reached && out.expiry) {
      // 만기가 처음 적용되는 정기전보일(3월 1일)
      let y2 = +out.expiry.slice(0, 4); if (out.expiry.slice(5) > '03-01') y2++;
      out.firstTransfer = `${y2}-03-01`;
    }
    if (last.r.mode === 'manual') out.notes.push('직접 입력한 학교는 교육지원청을 함께 골라야 정확합니다.');
    return out;
  }
  const fmtK = (d) => `${+d.slice(0, 4)}. ${+d.slice(5, 7)}. ${+d.slice(8, 10)}.`;
  function nextMarch1(today) { const y = +today.slice(0, 4); return today < `${y}-03-01` ? `${y}-03-01` : `${y + 1}-03-01`; }

  // ---------- 화면 ----------
  const f4 = (n) => (Math.round(n * 10000) / 10000).toFixed(4);
  function schoolOptions(q) {
    q = (q || '').replace(/\s+/g, '');
    if (!q) return [];
    return G().state.schools.filter((s) => (s.display + s.name_pdf).replace(/\s+/g, '').includes(q)).slice(0, 12);
  }

  function render() {
    const pane = $('#calcPane');
    if (!pane || !G()) return;
    const asOf = $('#calcAsOf').value || new Date().toISOString().slice(0, 10);
    const { res, raw, capped, total, overlaps } = compute(asOf);
    $('#calcRows').innerHTML = rows.map((r, i) => {
      const s = r.key && G().state.byKey.get(r.key);
      const head = r.mode === 'manual'
        ? `<select data-i="${i}" data-f="type"><option${r.type === '도서벽지' ? ' selected' : ''}>도서벽지</option><option${r.type === '농어촌' ? ' selected' : ''}>농어촌</option></select>
           <select data-i="${i}" data-f="grade">${Object.keys(MANUAL).filter((k) => k.startsWith(r.type + '|')).map((k) => k.split('|')[1]).map((g) => `<option${g === r.grade ? ' selected' : ''}>${esc(g)}</option>`).join('')}</select>
           <input data-i="${i}" data-f="label" placeholder="학교명(메모)" value="${esc(r.label || '')}">`
        : `<b>${esc(s ? s.display : r.label || '학교 선택 필요')}</b> <span class="muted small">${esc(s ? s.city : '')}</span>`;
      const x = res[i];
      const yy = (d) => d.slice(2).replace(/-/g, '.');
      const segRows = x.segs.map((g) => `<tr><td>${esc(g.label)}<div class="muted">월 ${g.m}</div></td><td>${yy(g.start)}~<br>${yy(g.end)}</td><td>${g.months}개월<br>${g.days}일</td><td><b>${f4(g.pts)}</b></td></tr>`).join('');
      return `<li class="crow">
        <div class="crow-h"><span class="cnum">${i + 1}</span>${head}<button class="btn link cdel" data-del="${i}" type="button" aria-label="${i + 1}번 삭제">삭제</button></div>
        <div class="crow-z"><label>근무 당시 인사구역 <select data-i="${i}" data-f="zone">
            <option value="">${s ? `2027 기준(${esc(s.zone)}${esc(s.zone_sub || '')})` : '선택하세요'}</option>
            ${['갑', '특', '을', '병'].map((z) => `<option value="${z}"${r.zone === z ? ' selected' : ''}>${z}${z === '특' ? '(→갑 변경 학교)' : ''}</option>`).join('')}</select></label>
          ${r.mode === 'manual' ? `<label>교육지원청 <select data-i="${i}" data-f="office"><option value="">선택(만기 판정용)</option>${[...new Set(G().state.schools.map((x) => x.office))].sort((a, b) => a.localeCompare(b, 'ko')).map((o) => `<option${r.office === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}<option${r.office === '타시도' ? ' selected' : ''}>타시도</option></select></label>` : ''}
          ${s && s.pdf_red ? '<span class="cwarn">2027 표에 적색 표기된 학교입니다. 근무 당시 구역이 달랐다면 바꿔 주세요.</span>' : ''}</div>
        <div class="crow-d"><label>시작일<input type="date" data-i="${i}" data-f="start" value="${esc(r.start || '')}"></label>
          <label>종료일<input type="date" data-i="${i}" data-f="end" value="${esc(r.end || '')}" title="비우면 평정 기준일까지"></label></div>
        ${x.warn.includes('NOREC') ? '<div class="muted small">도서벽지·농어촌 지정 자료에 없는 학교라 가산점은 0점입니다(자료 누락이 의심되면 증빙 확인).</div>' : x.segs.length ? `<div class="tblwrap"><table class="mini"><thead><tr><th>구분</th><th>기간</th><th>인정</th><th>점수</th></tr></thead><tbody>${segRows}</tbody></table></div>`
          : `<div class="muted small">${r.start ? '가산점 대상 기간이 없습니다.' : '시작일을 입력하세요.'}</div>`}
        ${x.warn.filter((w) => w !== 'NOREC').map((w) => `<div class="cwarn">${esc(w)}</div>`).join('')}
      </li>`;
    }).join('') || '<li class="empty">위 검색창에서 근무했던 학교를 찾아 추가하세요. 지도에서 학교를 누른 뒤 "내 계산에 추가"를 눌러도 됩니다.</li>';
    $('#calcSum').innerHTML = `
      <div class="csum-row"><span>도서·벽지·접적</span><b>${f4(capped.도서벽지)}</b>${raw.도서벽지 > CAP.도서벽지 ? `<span class="cwarn">계산 ${f4(raw.도서벽지)} → 상한 2.00</span>` : ''}</div>
      <div class="csum-row"><span>농어촌·공단·접경</span><b>${f4(capped.농어촌)}</b>${raw.농어촌 > CAP.농어촌 ? `<span class="cwarn">계산 ${f4(raw.농어촌)} → 상한 2.00</span>` : ''}</div>
      <div class="csum-row total"><span>합계 (합산 상한 2.00)</span><b>${f4(total)}</b></div>
      ${overlaps.map((o) => `<div class="cwarn">${esc(o)}</div>`).join('')}`;
    renderGap();
    save();
  }

  function renderGap() {
    const box = $('#gapResult'); if (!box) return;
    const opt = { transferDate: $('#gapDate').value || nextMarch1(new Date().toISOString().slice(0, 10)), birth: $('#gapBirth').value, disabled: $('#gapDisabled').checked, threeKids: $('#gapKids').checked };
    try { localStorage.setItem(STORE + '.gap', JSON.stringify({ birth: opt.birth, disabled: opt.disabled, threeKids: opt.threeKids })); } catch {}
    const g = gapStatus(opt);
    const chain = g.chain.length ? `<div class="tblwrap"><table class="mini"><thead><tr><th>번호</th><th>구역</th><th>기간</th><th>근무</th></tr></thead><tbody>${
      g.chain.map((c) => `<tr><td>${c.i + 1}</td><td>${c.zone}</td><td>${c.start.slice(2).replace(/-/g, '.')}~${c.end.slice(2).replace(/-/g, '.')}</td><td>${Math.floor(c.md.months / 12)}년 ${c.md.months % 12}개월 ${c.md.days}일</td></tr>`).join('')}</tbody></table></div>` : '';
    box.innerHTML = `<div class="gap-verdict ${g.level}">${esc(g.verdict)}</div>
      ${chain}
      ${g.firstTransfer ? `<div class="small">현재 학교 근무가 이어지면 <b>${fmtK(g.expiry)}</b>에 10년이 되어, <b>${fmtK(g.firstTransfer)}</b> 정기전보부터 갑만기에 해당합니다.</div>` : ''}
      ${g.level === 'hit' ? '<div class="small">갑구역 만기자는 <b>관내(같은 시·군)로 내신할 수 없고</b> 다른 시·군으로 전보 희망을 냅니다. 최후 희망지까지 경합하면 생활근거지를 고려해 임의 전보될 수 있습니다(제10조①2, 제11조⑥2).</div>' : ''}
      ${(g.exceptions || []).map((x) => `<div class="small ok-note">${esc(x)}</div>`).join('')}
      ${g.defer ? `<div class="small ok-note">${esc(g.defer)}</div>` : ''}
      ${g.notes.map((x) => `<div class="cwarn">${esc(x)}</div>`).join('')}`;
  }

  function addRow(r) { rows.push(Object.assign({ id: uid(), mode: 'school', start: '', end: '' }, r)); render(); }

  function init() {
    const pane = $('#calcPane');
    if (!pane) return;
    $('#calcAsOf').value = $('#calcAsOf').value || new Date().toISOString().slice(0, 10);
    $('#calcSearch').addEventListener('input', (e) => {
      const opts = schoolOptions(e.target.value);
      $('#calcPick').innerHTML = opts.map((s) => `<li><button type="button" class="pick" data-key="${esc(s.key)}">${esc(s.display)} <span class="muted small">${esc(s.city)} · ${esc(s.zone)}${esc(s.zone_sub || '')}${s.status !== '운영' ? ' · ' + esc(s.status) : ''}</span></button></li>`).join('');
    });
    $('#calcPick').addEventListener('click', (e) => {
      const b = e.target.closest('.pick'); if (!b) return;
      addRow({ key: b.dataset.key }); $('#calcSearch').value = ''; $('#calcPick').innerHTML = '';
    });
    $('#calcManual').addEventListener('click', () => addRow({ mode: 'manual', type: '도서벽지', grade: '라', label: '' }));
    $('#calcClear').addEventListener('click', () => {
      if ($('#calcClear').dataset.confirm === '1') { rows = []; $('#calcClear').dataset.confirm = ''; $('#calcClear').textContent = '모두 지우기'; render(); }
      else { $('#calcClear').dataset.confirm = '1'; $('#calcClear').textContent = '정말 지울까요? 한 번 더 누르기'; }
    });
    $('#calcAsOf').addEventListener('change', render);
    try { const g = JSON.parse(localStorage.getItem(STORE + '.gap') || '{}'); $('#gapBirth').value = g.birth || ''; $('#gapDisabled').checked = !!g.disabled; $('#gapKids').checked = !!g.threeKids; } catch {}
    $('#gapDate').value = $('#gapDate').value || nextMarch1(new Date().toISOString().slice(0, 10));
    ['#gapDate', '#gapBirth', '#gapDisabled', '#gapKids'].forEach((id) => $(id).addEventListener('change', renderGap));
    $('#calcRows').addEventListener('change', (e) => {
      const t = e.target, i = +t.dataset.i, f = t.dataset.f; if (!f) return;
      rows[i][f] = t.value;
      if (f === 'type') rows[i].grade = Object.keys(MANUAL).find((k) => k.startsWith(t.value + '|')).split('|')[1];
      render();
    });
    $('#calcRows').addEventListener('click', (e) => { const d = e.target.closest('[data-del]'); if (d) { rows.splice(+d.dataset.del, 1); render(); } });
    render();
  }

  window.GGCalc = {
    init, render,
    addSchool(key) { addRow({ key }); },
    _test: { monthsDays, segmentsFor, compute, gapStatus, setRows: (r) => { rows = r; } },
  };
})();
