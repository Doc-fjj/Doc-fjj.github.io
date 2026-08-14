/* =========================================================
 * app-views.js  通用CRUD组件 + 全部页面视图
 * ========================================================= */
'use strict';

/* ---------- 弹窗 ---------- */
const Modal = {
  open(html) { $('#modalBox').innerHTML = html; $('#modalMask').classList.add('show'); },
  close() { $('#modalMask').classList.remove('show'); }
};
$('#modalMask').addEventListener('click', (e) => { if (e.target.id === 'modalMask') Modal.close(); });

/* ---------- 表单生成 ---------- */
function openForm(colKey, rec, opts) {
  opts = opts || {};
  const sc = SCHEMAS[colKey];
  const isEdit = !!(rec && rec.id);
  rec = rec || {};
  const rows = sc.fields.map((f) => {
    const v = rec[f.k] !== undefined ? rec[f.k] : (f.def ? f.def() : '');
    let ctl = '';
    const optList = typeof f.opts === 'function' ? f.opts(rec) : f.opts;
    if (f.t === 'select') {
      ctl = '<select data-k="' + f.k + '">' + (optList || []).map((o) => {
        const val = Array.isArray(o) ? o[0] : o, lab = Array.isArray(o) ? o[1] : o;
        return '<option value="' + esc(val) + '"' + (String(v) === String(val) ? ' selected' : '') + '>' + esc(lab) + '</option>';
      }).join('') + '</select>';
    } else if (f.t === 'textarea') {
      ctl = '<textarea data-k="' + f.k + '" rows="3" placeholder="' + esc(f.ph || '') + '">' + esc(v) + '</textarea>';
    } else if (f.t === 'check') {
      ctl = '<input type="checkbox" data-k="' + f.k + '"' + (v ? ' checked' : '') + '>';
    } else if (f.t === 'photo') {
      ctl = '<input type="file" accept="image/*" capture="environment" data-k="' + f.k + '" data-photo="1">'
        + (v ? '<img src="' + v + '" style="max-width:120px;border-radius:8px;margin-top:6px" alt="附件">' : '');
    } else if (f.t === 'multicheck') {
      const cur = Array.isArray(v) ? v : String(v || '').split(/[，,、]/).map((s) => s.trim()).filter(Boolean);
      ctl = '<div class="mc-wrap">' + (optList || []).map((o) => {
        const val = Array.isArray(o) ? o[0] : o, lab = Array.isArray(o) ? o[1] : o;
        const ck = cur.includes(val) ? 'checked' : '';
        return '<label class="mc-item"><input type="checkbox" data-mc="' + f.k + '" value="' + esc(val) + '" ' + ck + '> ' + esc(lab) + '</label>';
      }).join('') + '</div>';
    } else {
      ctl = '<input type="' + (f.t === 'number' ? 'number' : f.t === 'date' ? 'date' : 'text') + '" step="any" data-k="' + f.k + '" value="' + esc(v) + '" placeholder="' + esc(f.ph || '') + '">';
    }
    return '<div class="form-row"><label class="' + (f.req ? 'req' : '') + '">' + esc(f.l) + '</label>' + ctl + '</div>';
  }).join('');
  Modal.open('<h3>' + (isEdit ? '编辑' : '新增') + ' · ' + esc(sc.title) + '</h3>' + rows
    + '<div class="modal-acts">'
    + (isEdit ? '<button class="btn danger" id="fDel">删除</button>' : '')
    + '<button class="btn" id="fCancel">取消</button><button class="btn primary" id="fSave">保存</button></div>');

  const photoData = {};
  $$('#modalBox [data-photo]').forEach((inp) => {
    inp.onchange = () => {
      const file = inp.files[0]; if (!file) return;
      const img = new Image(); const fr = new FileReader();
      fr.onload = () => { img.onload = () => {
        const cv = document.createElement('canvas');
        const scale = Math.min(1, 900 / Math.max(img.width, img.height));
        cv.width = img.width * scale; cv.height = img.height * scale;
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        photoData[inp.dataset.k] = cv.toDataURL('image/jpeg', 0.72);
        toast('照片已就绪');
      }; img.src = fr.result; };
      fr.readAsDataURL(file);
    };
  });

  $('#fCancel').onclick = Modal.close;
  if (isEdit) $('#fDel').onclick = () => { if (confirm('确认删除这条记录？')) { DB.remove(colKey, rec.id); Modal.close(); toast('已删除'); App.rerender(); } };
  $('#fSave').onclick = () => {
    const out = Object.assign({}, rec);
    let missing = null;
    sc.fields.forEach((f) => {
      if (f.t === 'multicheck') {
        const mcs = $$('#modalBox [data-mc="' + f.k + '"]');
        out[f.k] = mcs.filter((e) => e.checked).map((e) => e.value).join('、');
        return;
      }
      const el = $('#modalBox [data-k="' + f.k + '"]');
      if (!el) return;
      let v;
      if (f.t === 'check') v = el.checked;
      else if (f.t === 'photo') v = photoData[f.k] !== undefined ? photoData[f.k] : rec[f.k];
      else if (f.t === 'number') v = el.value === '' ? '' : Number(el.value);
      else v = el.value.trim();
      if (f.req && (v === '' || v == null) && f.t !== 'check') missing = missing || f.l;
      out[f.k] = v;
    });
    if (missing) return toast('请填写: ' + missing, 'err');
    /* 倒数日: 休假条目必填结束日期 */
    if (colKey === 'countdowns' && out.tag === 'vacation') {
      if (!out.endDate) return toast('休假条目必须填写休假结束日期', 'err');
      if (out.endDate < out.date) return toast('结束日期不能早于开始日期', 'err');
    }
    /* 记账自动分类 */
    if (colKey === 'ledger' && (!out.category || out.category === '自动识别')) out.category = Ledger.autoCat((out.note || '') + ' ' + (out.account || ''), out.type);
    /* 施工量台账：结束日期为空→进行中；有真日期→完成；填「未完成」→失败（失败井次+1） */
    if (colKey === 'dm-workload') {
      const ed = String(out.endDate || '').trim();
      if (ed === '未完成') { out.status = '失败'; out.failed = 1; }
      else if (!ed) { out.status = '进行中'; out.failed = 0; }
      else { out.status = '完成'; out.failed = 0; }
    }
    if (sc.modeScoped && !out.mode) out.mode = ModeCtl.current();
    if (opts.preset) Object.assign(out, opts.preset);
    DB.upsert(colKey, out);
    Modal.close(); toast(isEdit ? '已保存修改' : '已新增记录');
    App.rerender();
    opts.after && opts.after(out);
  };
}

/* ---------- 通用表格 ---------- */
function tableHTML(colKey, rows, extraCols) {
  const sc = SCHEMAS[colKey];
  const heads = sc.cols.map((k) => { const f = sc.fields.find((x) => x.k === k); return '<th>' + esc(f ? f.l : k) + '</th>'; }).join('');
  const tagMap = { work: ['工作事项', 'blue'], vacation: ['休假日程', 'green'], anniversary: ['重点纪念日', 'orange'] };
  const body = rows.map((r) => '<tr data-id="' + r.id + '" data-col="' + colKey + '">' + sc.cols.map((k) => {
    let v = r[k];
    if (k === 'amount' || k === 'gross' || k === 'net' || k === 'price' || k === 'cost') {
      const cls = (r.type === '收入' || colKey === 'liveincome' || colKey === 'sideincome') ? 'amt-in' : (r.type === '支出' ? 'amt-out' : '');
      v = '<span class="' + cls + '">' + fmtMoney(v) + '</span>';
    } else if (k === 'type') v = '<span class="tag ' + (v === '收入' ? 'red' : 'green') + '">' + esc(v) + '</span>';
    else if (k === 'tag' && tagMap[v]) v = '<span class="tag ' + tagMap[v][1] + '">' + tagMap[v][0] + '</span>';
    else if (k === 'status' || k === 'done' || k === 'packed') {
      const good = ['已完成', '完成', '出勤', '已装', '已读完', '在用', true];
      const warn = ['进行中', '在读', '已排期', '已订票'];
      const cls = good.includes(v) ? 'green' : warn.includes(v) ? 'blue' : 'gray';
      v = '<span class="tag ' + cls + '">' + esc(v === true ? '是' : v === false ? '否' : v) + '</span>';
    } else if (k === 'priority') v = '<span class="tag ' + (String(v).startsWith('P0') ? 'red' : String(v).startsWith('P1') ? 'orange' : 'gray') + '">' + esc(v) + '</span>';
    else if (k === 'heat' && Number(v) > 0) {
      const hv = Number(v);
      v = hv >= 10000000 ? (hv / 10000).toFixed(0) + '万' : hv >= 10000 ? (hv / 10000).toFixed(1) + '万' : String(hv);
      v = '<span style="color:#e74c3c;font-weight:600">🔥 ' + esc(v) + '</span>';
    } else if (k === 'source') {
      const sc = { '抖音热榜': 'red', '手动录入': 'gray', '其他': 'blue' };
      v = '<span class="tag ' + (sc[v] || 'gray') + '">' + esc(v || '手动录入') + '</span>';
    } else if (typeof v === 'boolean') v = v ? '✔' : '—';
    else v = esc(v == null ? '' : String(v)).slice(0, 80);
    return '<td>' + (v === '' ? '<span class="muted">—</span>' : v) + '</td>';
  }).join('') + '</tr>').join('');
  return '<div class="table-wrap"><table><thead><tr>' + heads + '</tr></thead><tbody>'
    + (rows.length ? body : '<tr><td colspan="' + sc.cols.length + '"><div class="empty">暂无数据，点击右上「新增」开始记录</div></td></tr>')
    + '</tbody></table></div>';
}
function bindTableEdit(container) {
  $$('tbody tr[data-id]', container).forEach((tr) => {
    tr.style.cursor = 'pointer';
    tr.onclick = () => { const rec = DB.get(tr.dataset.col, tr.dataset.id); if (rec) openForm(tr.dataset.col, rec); };
  });
}

/* ---------- 月份筛选 + 导出工具条 ---------- */
function monthToolbar(state, colKey, opts) {
  opts = opts || {};
  const m = state.month || monthStr();
  return '<div class="toolbar">'
    + '<input type="month" id="mFilter" value="' + m + '" style="width:150px">'
    + '<button class="btn sm" id="mAll">' + (state.month ? '查看全部' : '按月筛选中✕') + '</button>'
    + (opts.extra || '')
    + '<span class="sp"></span>'
    + '<button class="btn sm" id="expCsv">导出CSV</button>'
    + '<button class="btn primary" id="addBtn">＋ 新增</button>'
    + '</div>';
}
function bindMonthToolbar(el, state, colKey, opts) {
  opts = opts || {};
  const mf = $('#mFilter', el);
  if (mf) mf.onchange = () => { state.month = mf.value; App.rerender(); };
  const ma = $('#mAll', el);
  if (ma) ma.onclick = () => { state.month = state.month ? '' : monthStr(); App.rerender(); };
  const ab = $('#addBtn', el);
  if (ab) ab.onclick = () => openForm(colKey, null, { preset: opts.preset });
  const ec = $('#expCsv', el);
  if (ec) ec.onclick = () => {
    const sc = SCHEMAS[colKey];
    const rows = opts.rows ? opts.rows() : DB.list(colKey, { mode: sc.modeScoped ? ModeCtl.current() : null, month: state.month || null });
    Exporter.csv(sc.title + '_' + (state.month || '全部') + '.csv',
      sc.cols.map((k) => { const f = sc.fields.find((x) => x.k === k); return f ? f.l : k; }),
      rows.map((r) => sc.cols.map((k) => r[k] == null ? '' : r[k])));
  };
}

/* ---------- 通用列表页工厂 ---------- */
function simpleListView(colKey, opts) {
  opts = opts || {};
  return {
    state: { month: '' },
    render(el, self) {
      const sc = SCHEMAS[colKey];
      const rows = DB.list(colKey, { mode: sc.modeScoped ? ModeCtl.current() : null, month: self.state.month || null })
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || b.updatedAt - a.updatedAt);
      el.innerHTML = monthToolbar(self.state, colKey, opts) + (opts.top ? opts.top(rows) : '') + tableHTML(colKey, rows);
      bindMonthToolbar(el, self.state, colKey, opts);
      bindTableEdit(el);
      opts.bind && opts.bind(el, rows);
    }
  };
}

/* ---------- 子页签工厂 ---------- */
function subtabsView(tabs, stateKey) {
  return {
    state: { tab: tabs[0].id },
    render(el, self) {
      el.innerHTML = '<div class="subtabs">' + tabs.map((t) =>
        '<button class="subtab ' + (self.state.tab === t.id ? 'active' : '') + '" data-t="' + t.id + '">' + t.icon + ' ' + t.name + '</button>').join('') + '</div><div id="subBody"></div>';
      $$('.subtab', el).forEach((b) => b.onclick = () => { self.state.tab = b.dataset.t; App.rerender(); });
      const tab = tabs.find((t) => t.id === self.state.tab) || tabs[0];
      tab.view.render($('#subBody', el), tab.view);
    }
  };
}

/* =========================================================
 * 页面视图定义
 * ========================================================= */
const Views = {};

/* ===== 牛马: 今日工作仪表盘 ===== */
Views['dash-work'] = {
  title: '今日工作仪表盘',
  render(el) {
    const t = todayStr();
    const todos = DB.list('todos').filter((x) => x.status !== '已完成').sort((a, b) => String(a.deadline || '9').localeCompare(String(b.deadline || '9')));
    const meetings = DB.list('meetings').filter((m) => m.date === t);
    const prog = DB.list('progress').filter((p) => p.stage !== '定稿');
    const pomo = DB.list('pomodoros').filter((p) => p.date === t);
    const focusMin = pomo.reduce((s, p) => s + Number(p.minutes || 0), 0);
    const mo = monthStr();
    const led = DB.list('ledger', { mode: 'work', month: mo });
    const exp = led.filter((x) => x.type === '支出').reduce((s, x) => s + Number(x.amount || 0), 0);
    const inc = led.filter((x) => x.type === '收入').reduce((s, x) => s + Number(x.amount || 0), 0);
    const cds = nextCountdowns(3);
    el.innerHTML =
      quoteBanner()
      + '<div class="grid g4" style="margin-bottom:14px">'
      + statCard('待办任务', todos.length + ' 项', todos.filter((x) => x.deadline && x.deadline <= t).length + ' 项已到期')
      + statCard('今日会议', meetings.length + ' 场', meetings[0] ? (meetings[0].time || '') + ' ' + meetings[0].title : '暂无安排')
      + statCard('今日专注', focusMin + ' 分钟', pomo.length + ' 个时段')
      + statCard('本月收支', fmtMoney(inc - exp), '收 ' + fmtMoney(inc) + ' / 支 ' + fmtMoney(exp))
      + '</div>'
      + dmQuickSection(t, mo)
      + '<div class="grid g2">'
      + '<div class="card"><h3>✅ 当日待办 <span class="more" data-go="todos">全部 ›</span></h3>' + (todos.length ? todos.slice(0, 6).map((x) =>
        '<div class="chore-line"><input type="checkbox" data-done="' + x.id + '"><span style="flex:1;color:var(--txt)">' + esc(x.title) + '</span>'
        + (x.deadline ? '<span class="tag ' + (x.deadline <= t ? 'red' : 'gray') + '">' + x.deadline + '</span>' : '') + '</div>').join('') : '<div class="empty">今日无待办 ✨</div>') + '</div>'
      + '<div class="card"><h3>📅 会议安排 <span class="more" data-go="todos">管理 ›</span></h3>' + (meetings.length ? meetings.map((m) =>
        '<div class="chore-line"><b>' + esc(m.time || '') + '</b><span style="flex:1;color:var(--txt)">' + esc(m.title) + '</span><span class="muted small">' + esc(m.place || '') + '</span></div>').join('') : '<div class="empty">今日无会议</div>') + '</div>'
      + '<div class="card"><h3>📈 材料/科研进度 <span class="more" data-go="progress">全部 ›</span></h3>' + (prog.length ? prog.slice(0, 4).map((p) => progressLine(p)).join('') : '<div class="empty">暂无进行中的项目</div>') + '</div>'
      + '<div class="card"><h3>⏳ 临近倒数日 <span class="more" data-go="countdown">全部 ›</span></h3>' + (cds.length ? cds.map(cdLine).join('') : '<div class="empty">暂无倒数日</div>') + '</div>'
      + '</div>';
    bindDashCommon(el);
  }
};

/* ===== 休假: 总览仪表盘 ===== */
Views['dash-life'] = {
  title: '休假总览仪表盘',
  render(el) {
    const t = todayStr();
    const mo = monthStr();
    const att = DB.list('attendance', { month: mo });
    const chores = DB.list('chores').filter((c) => c.date === t && c.done === '完成');
    const growth = DB.list('growth').sort((a, b) => a.date.localeCompare(b.date));
    const lastG = growth[growth.length - 1];
    const led = DB.list('ledger', { mode: 'life', month: mo });
    const exp = led.filter((x) => x.type === '支出').reduce((s, x) => s + Number(x.amount || 0), 0);
    const inc = led.filter((x) => x.type === '收入').reduce((s, x) => s + Number(x.amount || 0), 0);
    const trips = DB.list('trips').filter((x) => x.status !== '已完成');
    const therapy = DB.list('therapy', { month: mo });
    const meals = DB.list('meals').filter((m) => m.date === t);
    const cds = nextCountdowns(3);
    el.innerHTML =
      quoteBanner()
      + '<div class="grid g4" style="margin-bottom:14px">'
      + statCard('宝宝最新记录', lastG ? (lastG.height || '-') + 'cm / ' + (lastG.weight || '-') + 'kg' : '暂无', lastG ? lastG.date : '去育儿模块记录')
      + statCard('本月出勤', att.filter((a) => a.status === '出勤').length + ' 天', '请假 ' + att.filter((a) => String(a.status).startsWith('请假')).length + ' 天')
      + statCard('今日家务', chores.length + ' 项完成', '今日三餐已记 ' + meals.length + ' 顿')
      + statCard('本月家庭收支', fmtMoney(inc - exp), '收 ' + fmtMoney(inc) + ' / 支 ' + fmtMoney(exp))
      + '</div>'
      + '<div class="grid g2">'
      + '<div class="card"><h3>🧒 育儿事项 <span class="more" data-go="parenting">进入 ›</span></h3>'
      + healthBrief() + '</div>'
      + '<div class="card"><h3>🧹 今日家务 <span class="more" data-go="chores">进入 ›</span></h3>' + choreToday() + '</div>'
      + '<div class="card"><h3>🫖 本月调理 <span class="more" data-go="health">进入 ›</span></h3>'
      + (therapy.length ? therapy.slice(-4).reverse().map((x) => '<div class="chore-line"><span class="tag blue">' + esc(x.ttype) + '</span><span style="flex:1;color:var(--txt)">' + esc(x.detail) + '</span><span class="muted small">' + x.date + '</span></div>').join('') : '<div class="empty">本月暂无食疗/艾灸记录</div>') + '</div>'
      + '<div class="card"><h3>✈️ 旅行规划 <span class="more" data-go="travel">进入 ›</span></h3>'
      + (trips.length ? trips.slice(0, 4).map((x) => '<div class="chore-line"><span style="flex:1;color:var(--txt)">' + esc(x.name) + '</span><span class="tag blue">' + esc(x.status) + '</span><span class="muted small">' + x.date + '</span></div>').join('') : '<div class="empty">暂无出行计划</div>') + '</div>'
      + '<div class="card"><h3>⏳ 临近倒数日 <span class="more" data-go="countdown">全部 ›</span></h3>' + (cds.length ? cds.map(cdLine).join('') : '<div class="empty">暂无倒数日</div>') + '</div>'
      + '</div>';
    bindDashCommon(el);
  }
};

function statCard(t, num, sub) { return '<div class="card"><div class="muted small">' + t + '</div><div class="stat-num">' + num + '</div><div class="stat-sub">' + sub + '</div></div>'; }
function bindDashCommon(el) {
  $$('[data-go]', el).forEach((x) => x.onclick = () => App.go(x.dataset.go));
  $$('[data-done]', el).forEach((cb) => cb.onchange = () => {
    const r = DB.get('todos', cb.dataset.done);
    if (r) { r.status = '已完成'; r.doneAt = todayStr(); DB.upsert('todos', r); toast('任务已完成并归档 🎉'); App.rerender(); }
  });
  const qb = $('#qbEdit', el);
  if (qb) qb.onclick = () => openMottoEditor();
}
function progressLine(p) {
  const sc = SCHEMAS.progress.stages;
  const ci = sc.indexOf(p.stage);
  return '<div style="margin-bottom:10px"><div style="display:flex;gap:8px;align-items:center"><b class="small">' + esc(p.title) + '</b><span class="tag gray">' + esc(p.ptype || '') + '</span>'
    + (p.deadline ? '<span class="muted small" style="margin-left:auto">' + p.deadline + '</span>' : '') + '</div>'
    + '<div class="stages">' + sc.map((s, i) => '<div class="stage ' + (i < ci ? 'done' : i === ci ? 'cur' : '') + '">' + s + '</div>').join('') + '</div></div>';
}
function nextCountdowns(n) {
  const t = todayStr();
  return DB.list('countdowns').map((c) => {
    let target = c.date;
    if (c.yearly && target) { const md = c.date.slice(5); const y = new Date().getFullYear(); target = y + '-' + md; if (target < t) target = (y + 1) + '-' + md; }
    return Object.assign({}, c, { target, days: daysBetween(t, target) });
  }).filter((c) => c.days >= 0 || (c.tag === 'vacation' && c.endDate >= t)).sort((a, b) => a.days - b.days).slice(0, n);
}
function cdLine(c) {
  const tagMap = { work: ['工作', 'blue'], vacation: ['休假', 'green'], anniversary: ['纪念', 'orange'] };
  const tm = tagMap[c.tag] || ['其他', 'gray'];
  return '<div class="chore-line"><span class="tag ' + tm[1] + '">' + tm[0] + '</span><span style="flex:1;color:var(--txt)">' + esc(c.title) + '</span><b>' + (c.days === 0 ? '今天' : c.days + '天后') + '</b></div>';
}
function healthBrief() {
  const t = todayStr();
  const att = DB.list('attendance').find((a) => a.date === t);
  const recent = DB.list('childhealth').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  return '<div class="chore-line">今日出勤: ' + (att ? '<span class="tag ' + (att.status === '出勤' ? 'green' : 'orange') + '">' + esc(att.status) + '</span>' : '<span class="muted">未记录</span>') + '</div>'
    + (recent.length ? recent.map((r) => '<div class="chore-line"><span class="tag gray">' + esc(r.htype) + '</span><span style="flex:1;color:var(--txt)">' + esc(String(r.detail).slice(0, 24)) + '</span><span class="muted small">' + r.date + '</span></div>').join('') : '<div class="muted small" style="padding:6px 0">暂无健康档案记录</div>');
}
function choreToday() {
  const t = todayStr();
  const rooms = SCHEMAS.chores.rooms;
  const logs = DB.list('chores').filter((c) => c.date === t);
  return '<div class="room-grid">' + rooms.map((r) => {
    const rl = logs.filter((l) => l.room === r && l.done === '完成');
    return '<div class="room-card"><h4>' + r + '</h4>' + (rl.length ? rl.map((l) => '<div class="chore-line done">✔ ' + esc(l.task) + '</div>').join('') : '<div class="chore-line">— 未打扫</div>') + '</div>';
  }).join('') + '</div>';
}

/* ---------- 生肖 / 星座 / 生日礼物建议 ---------- */
const ZODIAC = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];
function zodiacOf(year) { return ZODIAC[(year - 4) % 12]; }
function constellation(m, d) {
  const rules = [[1, 20, '水瓶'], [2, 19, '双鱼'], [3, 21, '白羊'], [4, 20, '金牛'], [5, 21, '双子'], [6, 22, '巨蟹'], [7, 23, '狮子'], [8, 23, '处女'], [9, 23, '天秤'], [10, 24, '天蝎'], [11, 23, '射手'], [12, 22, '摩羯']];
  for (let i = rules.length - 1; i >= 0; i--) { if (m > rules[i][0] || (m === rules[i][0] && d >= rules[i][1])) return rules[i][2]; }
  return '摩羯';
}
function ageFromBirthday(birth, refYear) {
  if (!birth || birth.length < 4) return null;
  const y = Number(birth.slice(0, 4)); if (isNaN(y)) return null;
  let age = refYear - y;
  if (birth.slice(5) > todayStr().slice(5)) age -= 1;
  return Math.max(0, age);
}
function giftSuggestions(rec) {
  const who = rec.who || '其他';
  const age = ageFromBirthday(rec.birthday, new Date().getFullYear());
  const base = ({
    '自己': ['一本想读很久的书', '心仪已久的电子产品或配件', '一次彻底放松的SPA/按摩', '一顿犒劳自己的大餐', '一套喜欢的护肤品/香水'],
    '伴侣': ['一束鲜花或定制花盒', '一件精致首饰', '一次浪漫的双人晚餐', '情侣写真或短途旅行', '手写信 + 用心小礼物'],
    '孩子': ['适龄绘本/图画书', '益智积木或拼图', '平衡车/滑板车', '科学实验小套装', '喜欢的卡通周边'],
    '父母': ['养生按摩仪/足浴盆', '体检或中医调理套餐', '保暖衣物或护具', '高品质茶叶/养生茶', '智能血压计/体脂秤'],
    '朋友': ['生日蛋糕 + 小聚会', '个性化定制礼物', '电影票/演出票', '香薰或绿植', '饮品券或咖啡券'],
    '同事': ['咖啡券/奶茶券', '办公桌面小物', '绿植或解压玩具', '零食礼盒'],
    '其他': ['手写贺卡', '应季花束', '实用贴心小物']
  })[who] || ['手写贺卡', '应季花束', '实用贴心小物'];
  const ageTips = [];
  if (age != null) {
    if (age <= 2) ageTips.push('婴幼儿：安抚玩具、早教机、柔软布书');
    else if (age <= 6) ageTips.push('学龄前：绘本、积木、平衡车');
    else if (age <= 12) ageTips.push('少儿：益智玩具、运动器材、科学套装');
    else if (age <= 17) ageTips.push('青少年：动漫周边、耳机、运动鞋');
    else if (age <= 25) ageTips.push('青年：数码好物、护肤品、咖啡券');
    else if (age <= 40) ageTips.push('中青年：香薰、书籍、健身卡、护肤');
    else if (age <= 60) ageTips.push('中年：养生礼盒、按摩仪、茶具');
    else ageTips.push('长辈：保健品、保暖用品、健康监测设备');
  }
  return { who, age, zodiac: rec.birthday ? zodiacOf(Number(rec.birthday.slice(0, 4))) : '', constellation: rec.birthday ? constellation(Number(rec.birthday.slice(5, 7)), Number(rec.birthday.slice(8, 10))) : '', base, ageTips };
}
function showGiftModal(c) {
  const g = giftSuggestions(c);
  const zodiacStr = g.zodiac ? ('生肖 ' + g.zodiac + ' · 星座 ' + g.constellation) : '';
  const ageStr = g.age != null ? ('今年 ' + g.age + ' 岁') : '';
  const tips = g.ageTips.map((t) => '<li>' + esc(t) + '</li>').join('');
  const ideas = g.base.map((s) => '<li>' + esc(s) + '</li>').join('');
  Modal.open('<h3>🎂 生日礼物建议</h3>'
    + '<div class="muted small" style="margin-bottom:12px">' + esc(c.title) + (g.who ? ('（' + g.who + '）') : '') + ' · ' + ageStr + ' · ' + zodiacStr + '</div>'
    + (tips ? '<div class="muted small" style="margin-bottom:4px">按年龄推荐</div><ul style="margin:0 0 12px 18px;font-size:.9rem;line-height:1.7">' + tips + '</ul>' : '')
    + '<div class="muted small" style="margin-bottom:4px">按关系推荐</div><ul style="margin:0 0 6px 18px;font-size:.9rem;line-height:1.7">' + ideas + '</ul>'
    + '<div class="modal-acts"><button class="btn primary" id="gClose">好的</button></div>');
  $('#gClose').onclick = Modal.close;
}

/* ---------- 每日寄语(按日期稳定随机) ---------- */
const DAILY_QUOTES = [
  '今天的努力，是给未来的自己最好的礼物。',
  '牛马也会休息，累了就允许自己喘口气。',
  '把一件小事做到极致，就是了不起。',
  '你比昨天更厉害了一点点，这就够了。',
  '专注当下的 25 分钟，胜过焦虑的一整天。',
  '孩子的笑脸，是工作再累也值得的充电站。',
  '别把计划排太满，留一点空白给惊喜。',
  '完成的，比完美的更值得庆祝。',
  '你已经在路上了，这本身就很勇敢。',
  '温柔对待自己，也是一种生产力。',
  '每一次番茄钟，都是在为梦想攒时间。',
  '家里的一地鸡毛，终会编织成温暖。',
  '今天也要好好吃饭、好好睡觉、好好爱自己。',
  '进度慢一点没关系，只要方向是对的。',
  '你负责的每一件事，都在让生活更稳一点。',
  '允许自己偶尔偷懒，休息不是罪。',
  '把烦恼写下来，它就变小了一半。',
  '你既是职场牛马，也是家里的光。',
  '小事坚持做，会变成你的底气。',
  '今天的你，已经很棒了，真的。',
  '与其焦虑未知，不如把眼前的事做好。',
  '给身体一点调理，它会悄悄回报你。',
  '陪孩子长大的过程，你也重新长大一次。',
  '目标拆成小步，每一步都算数。',
  '你不需要让所有人满意，先让自己舒服。',
  '记录，是为了看见自己的成长轨迹。',
  '今天的坚持，是明天自由生活的伏笔。',
  '把情绪照顾好，事情自然会顺起来。',
  '你比想象中更能扛，也更值得被好好对待。',
  '慢慢来，比较快。',
  '无论牛马还是休假，你都在认真地生活。',
  '今天的小确幸，值得被记上一笔。',
  '别怕重复，重复是变强的秘密。',
  '你手里的每一笔账，都是生活的注脚。',
  '假期是用来回血的，安心享受它。'
];
function dailyQuote() {
  const seed = parseInt(todayStr().replace(/-/g, ''), 10) || 0;
  return DAILY_QUOTES[seed % DAILY_QUOTES.length];
}
function quoteBanner() {
  const motto = DB.setting('motto', '');
  const text = motto ? motto : dailyQuote();
  const tag = motto ? '<span class="qb-flag">已自定义</span>' : '';
  return '<div class="quote-banner" id="qbEdit" title="点击编辑每日寄语（随云端同步到所有设备）"><div class="qb-ico">✨</div><div class="qb-body"><span class="qb-label">每 日 寄 语</span><span class="qb-text">' + esc(text) + '</span>' + tag + '</div></div>';
}
function openMottoEditor() {
  const cur = DB.setting('motto', '');
  Modal.open('<h3>✨ 编辑每日寄语</h3>'
    + '<div class="muted small" style="margin-bottom:8px">保存后通过云端同步到手机/电脑所有设备，做到随时更新。</div>'
    + '<textarea id="mottoInput" style="width:100%;min-height:90px;font-size:.95rem;line-height:1.6">' + esc(cur) + '</textarea>'
    + '<div class="muted small" style="margin:6px 0 10px">留空则恢复为按日期自动轮换的寄语。</div>'
    + '<div class="modal-acts"><button class="btn" id="mottoCancel">取消</button><button class="btn primary" id="mottoSave">保存并同步</button></div>');
  $('#mottoCancel').onclick = Modal.close;
  $('#mottoSave').onclick = () => {
    const v = $('#mottoInput').value.trim();
    DB.setSetting('motto', v);
    Modal.close();
    toast(v ? '每日寄语已更新，正在同步…' : '已恢复按日期自动轮换');
    App.rerender();
  };
}

/* ===== 智能记账 ===== */
Views['ledger'] = {
  title: '智能记账',
  state: { month: monthStr() },
  render(el, self) {
    const mode = ModeCtl.current();
    const m = self.state.month || monthStr();
    const all = DB.list('ledger', { mode, month: self.state.month || null }).sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
    const mRows = DB.list('ledger', { mode, month: m });
    const inc = mRows.filter((x) => x.type === '收入').reduce((s, x) => s + Number(x.amount || 0), 0);
    const exp = mRows.filter((x) => x.type === '支出').reduce((s, x) => s + Number(x.amount || 0), 0);
    /* 近6个月趋势 */
    const months = []; const d0 = new Date(m + '-01T00:00:00');
    for (let i = 5; i >= 0; i--) { const d = new Date(d0.getFullYear(), d0.getMonth() - i, 1); months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); }
    const incS = months.map((mm) => DB.list('ledger', { mode, month: mm }).filter((x) => x.type === '收入').reduce((s, x) => s + Number(x.amount || 0), 0));
    const expS = months.map((mm) => DB.list('ledger', { mode, month: mm }).filter((x) => x.type === '支出').reduce((s, x) => s + Number(x.amount || 0), 0));
    /* 分类占比 */
    const catMap = {};
    mRows.filter((x) => x.type === '支出').forEach((x) => { catMap[x.category || '未分类'] = (catMap[x.category || '未分类'] || 0) + Number(x.amount || 0); });
    const cats = Object.entries(catMap).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

    el.innerHTML = monthToolbar(self.state, 'ledger', { extra: '<button class="btn sm" id="impBtn">📥 导入微信/支付宝账单</button><input type="file" id="impFile" accept=".csv,.txt" style="display:none">' })
      + '<div class="grid g3" style="margin-bottom:14px">'
      + statCard(m + ' 收入', '<span class="amt-in">' + fmtMoney(inc) + '</span>', mode === 'work' ? '牛马模式账本' : '家庭账本')
      + statCard(m + ' 支出', '<span class="amt-out">' + fmtMoney(exp) + '</span>', mRows.length + ' 笔记录')
      + statCard(m + ' 结余', fmtMoney(inc - exp), '收支相抵')
      + '</div>'
      + '<div class="grid g2" style="margin-bottom:14px">'
      + '<div class="card"><h3>近6个月收支趋势</h3><canvas class="chart" id="ledTrend"></canvas><div class="legend"><span><i style="background:#e06c75"></i>收入</span><span><i style="background:#4cc38a"></i>支出</span></div></div>'
      + '<div class="card"><h3>' + m + ' 支出分类占比</h3>' + (cats.length ? '<canvas class="chart" id="ledPie"></canvas>' : '<div class="empty">本月暂无支出</div>') + '</div>'
      + '</div>' + tableHTML('ledger', all.slice(0, 200));
    bindMonthToolbar(el, self.state, 'ledger');
    bindTableEdit(el);
    Chart2.bar($('#ledTrend'), months.map((x) => x.slice(5) + '月'), [{ name: '收入', data: incS, color: '#e06c75' }, { name: '支出', data: expS, color: '#4cc38a' }]);
    if (cats.length) Chart2.pie($('#ledPie'), cats);
    $('#impBtn').onclick = () => $('#impFile').click();
    $('#impFile').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        const res = CSVImport.toLedger(CSVImport.parse(fr.result));
        if (!res.ok) return toast(res.msg, 'err');
        if (!res.list.length) return toast('未解析到有效账单记录', 'err');
        const dup = [];
        res.list.forEach((r) => {
          const exists = DB.list('ledger', { mode }).some((x) => x.date === r.date && Number(x.amount) === Number(r.amount) && x.note === r.note);
          if (exists) { dup.push(r); return; }
          r.mode = mode; DB.upsert('ledger', r);
        });
        let msg = '成功导入 ' + (res.list.length - dup.length) + ' 笔（' + res.src + '账单）';
        if (dup.length) msg += '，跳过重复 ' + dup.length + ' 笔';
        if (res.bad.length) msg += '，' + res.bad.length + ' 行异常已跳过';
        toast(msg);
        if (res.bad.length) Notif.add('账单导入异常提示', res.bad.slice(0, 3).map((b) => '第' + b.line + '行: ' + b.raw).join('；'), 'global');
        App.rerender();
      };
      fr.readAsText(f, 'utf-8');
    };
  }
};

/* ===== 工作待办&日程 ===== */
Views['todos'] = subtabsView([
  {
    id: 'list', name: '待办任务', icon: '✅',
    view: {
      state: {},
      render(el) {
        const t = todayStr();
        const open = DB.list('todos').filter((x) => x.status !== '已完成').sort((a, b) => String(a.priority).localeCompare(String(b.priority)) || String(a.deadline || '9').localeCompare(String(b.deadline || '9')));
        el.innerHTML = '<div class="toolbar"><span class="muted small">进行中任务 ' + open.length + ' 项 · 点击行编辑 · 勾选完成自动归档</span><span class="sp"></span><button class="btn primary" id="addTd">＋ 新增任务</button></div>'
          + (open.length ? open.map((x) => '<div class="card" style="margin-bottom:9px;display:flex;gap:10px;align-items:center;padding:13px 16px">'
            + '<input type="checkbox" data-done="' + x.id + '">'
            + '<div style="flex:1;min-width:0"><b>' + esc(x.title) + '</b><div class="muted small" style="margin-top:2px">' + esc(x.ttype || '') + (x.note ? ' · ' + esc(String(x.note).slice(0, 40)) : '') + '</div></div>'
            + '<span class="tag ' + (String(x.priority).startsWith('P0') ? 'red' : String(x.priority).startsWith('P1') ? 'orange' : 'gray') + '">' + esc(x.priority || '') + '</span>'
            + (x.deadline ? '<span class="tag ' + (x.deadline <= t ? 'red' : 'blue') + '">' + x.deadline + '</span>' : '')
            + '<button class="btn sm" data-edit="' + x.id + '">编辑</button></div>').join('') : '<div class="card"><div class="empty">暂无进行中的任务</div></div>');
        $('#addTd', el).onclick = () => openForm('todos');
        $$('[data-done]', el).forEach((cb) => cb.onchange = () => { const r = DB.get('todos', cb.dataset.done); r.status = '已完成'; r.doneAt = todayStr(); DB.upsert('todos', r); toast('任务已完成并归档 🎉'); App.rerender(); });
        $$('[data-edit]', el).forEach((b) => b.onclick = () => openForm('todos', DB.get('todos', b.dataset.edit)));
      }
    }
  },
  {
    id: 'meet', name: '会议安排', icon: '📅',
    view: simpleListView('meetings')
  },
  {
    id: 'archive', name: '已完成归档', icon: '🗂️',
    view: {
      state: { month: '' },
      render(el, self) {
        const rows = DB.list('todos', { month: self.state.month || null }).filter((x) => x.status === '已完成').sort((a, b) => String(b.doneAt || b.date || '').localeCompare(String(a.doneAt || a.date || '')));
        el.innerHTML = monthToolbar(self.state, 'todos') + tableHTML('todos', rows);
        bindMonthToolbar(el, self.state, 'todos', { rows: () => rows });
        bindTableEdit(el);
      }
    }
  },
  {
    id: 'weekly', name: '每周总结', icon: '📊',
    view: {
      state: {},
      render(el) {
        const done = DB.list('todos').filter((x) => x.status === '已完成' && (x.doneAt || x.date));
        const byWeek = {};
        done.forEach((x) => { const wk = weekKey(x.doneAt || x.date); (byWeek[wk] = byWeek[wk] || []).push(x); });
        const weeks = Object.keys(byWeek).sort().reverse().slice(0, 8);
        const pomo = DB.list('pomodoros');
        el.innerHTML = weeks.length ? weeks.map((wk) => {
          const list = byWeek[wk];
          const byType = {};
          list.forEach((x) => { byType[x.ttype || '其他'] = (byType[x.ttype || '其他'] || 0) + 1; });
          const focus = pomo.filter((p) => weekKey(p.date) === wk).reduce((s, p) => s + Number(p.minutes || 0), 0);
          return '<div class="card" style="margin-bottom:12px"><h3>📊 ' + wk + ' 工作量总结</h3>'
            + '<div class="muted small" style="margin-bottom:8px">完成任务 <b style="color:var(--txt)">' + list.length + '</b> 项 · 专注 <b style="color:var(--txt)">' + (focus / 60).toFixed(1) + '</b> 小时 · '
            + Object.entries(byType).map(([k, v]) => k + '×' + v).join('、') + '</div>'
            + list.map((x) => '<div class="chore-line done">✔ ' + esc(x.title) + '<span class="muted small" style="margin-left:auto">' + (x.doneAt || x.date || '') + '</span></div>').join('') + '</div>';
        }).join('') : '<div class="card"><div class="empty">完成任务后将自动按周生成工作量总结</div></div>';
      }
    }
  }
]);

/* ===== 番茄专注 ===== */
const Pomo = {
  total: 25 * 60, left: 25 * 60, timer: null, running: false, mode: '番茄钟', startAt: null,
  start(mins, label) {
    this.stop(false);
    this.total = this.left = mins * 60; this.running = true; this.label = label || ''; this.startAt = Date.now();
    this.timer = setInterval(() => {
      this.left--;
      if (this.left <= 0) { this.finish(); } else this.paint();
    }, 1000);
    this.paint();
  },
  finish() {
    this.stop(false);
    DB.upsert('pomodoros', { date: todayStr(), ptype: this.mode, minutes: Math.round(this.total / 60), label: this.label, mode: 'work' });
    Notif.add('专注完成 🍅', Math.round(this.total / 60) + ' 分钟专注已记录', 'work');
    toast('专注完成，已自动记录 🍅');
    App.rerender();
  },
  stopAndSave() {
    if (!this.running && this.left === this.total) return;
    const used = Math.round((this.total - this.left) / 60);
    this.stop(false);
    if (used >= 1) {
      DB.upsert('pomodoros', { date: todayStr(), ptype: this.mode, minutes: used, label: this.label, mode: 'work' });
      toast('已记录 ' + used + ' 分钟专注');
    } else toast('不足1分钟，未记录');
    this.left = this.total;
    App.rerender();
  },
  stop(reset) { clearInterval(this.timer); this.timer = null; this.running = false; if (reset) this.left = this.total; this.paint(); },
  paint() {
    const tm = $('#pomoTime'); if (!tm) return;
    const mm = Math.floor(this.left / 60), ss = this.left % 60;
    tm.textContent = String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    const ring = $('#pomoProg');
    if (ring) { const C = 2 * Math.PI * 100; ring.style.strokeDashoffset = C * (1 - (this.total - this.left) / this.total); }
    document.title = this.running ? '🍅 ' + tm.textContent + ' - 敬敬的个人工作台' : '敬敬的个人工作台';
  }
};
Views['pomodoro'] = {
  title: '番茄专注计时',
  render(el) {
    const t = todayStr();
    const today = DB.list('pomodoros').filter((p) => p.date === t);
    const tMin = today.reduce((s, p) => s + Number(p.minutes || 0), 0);
    const wk = weekKey(t);
    const wMin = DB.list('pomodoros').filter((p) => weekKey(p.date) === wk).reduce((s, p) => s + Number(p.minutes || 0), 0);
    /* 近7天柱状 */
    const days = []; for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')); }
    const mins = days.map((dd) => DB.list('pomodoros').filter((p) => p.date === dd).reduce((s, p) => s + Number(p.minutes || 0), 0));
    const C = 2 * Math.PI * 100;
    el.innerHTML = '<div class="grid g2">'
      + '<div class="card"><div class="pomo-wrap">'
      + '<div class="pomo-ring"><svg width="230" height="230" viewBox="0 0 230 230">'
      + '<circle cx="115" cy="115" r="100" fill="none" stroke="var(--line)" stroke-width="10"/>'
      + '<circle id="pomoProg" cx="115" cy="115" r="100" fill="none" stroke="var(--acc)" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + C + '" stroke-dashoffset="' + C + '"/></svg>'
      + '<div class="pomo-time"><div class="tm" id="pomoTime">25:00</div><div class="muted small" id="pomoLbl">' + (Pomo.running ? '专注中: ' + esc(Pomo.label || Pomo.mode) : '准备就绪') + '</div></div></div>'
      + '<input type="text" id="pomoInput" placeholder="本次专注内容(可选)" style="max-width:280px;margin-top:16px" value="' + esc(Pomo.label || '') + '">'
      + '<div class="pomo-btns">'
      + '<button class="btn primary" id="p25">🍅 25分钟</button><button class="btn" id="p45">45分钟</button><button class="btn" id="pFree">⏱ 自由时段</button>'
      + '<button class="btn" id="pStop">⏹ 结束并记录</button></div></div></div>'
      + '<div class="card"><h3>📊 专注统计</h3>'
      + '<div class="grid g2" style="margin-bottom:10px">' + statCard('今日有效时长', (tMin / 60).toFixed(1) + ' 小时', today.length + ' 个时段') + statCard('本周有效时长', (wMin / 60).toFixed(1) + ' 小时', wk) + '</div>'
      + '<canvas class="chart" id="pomoChart"></canvas><div class="muted small" style="margin-top:6px">近7天专注分钟数</div></div>'
      + '</div>'
      + '<div style="margin-top:14px"><h3 style="margin-bottom:10px">今日专注记录</h3>' + tableHTML('pomodoros', today.slice().reverse()) + '</div>';
    Chart2.bar($('#pomoChart'), days.map((d) => d.slice(5)), [{ name: '分钟', data: mins, color: '#6e8efb' }]);
    Pomo.paint();
    const getLbl = () => $('#pomoInput').value.trim();
    $('#p25').onclick = () => { Pomo.mode = '番茄钟'; Pomo.start(25, getLbl()); $('#pomoLbl').textContent = '专注中: ' + (getLbl() || '番茄钟'); toast('番茄钟已启动 🍅'); };
    $('#p45').onclick = () => { Pomo.mode = '番茄钟'; Pomo.start(45, getLbl()); $('#pomoLbl').textContent = '专注中: ' + (getLbl() || '番茄钟'); };
    $('#pFree').onclick = () => { Pomo.mode = '自由时段'; Pomo.start(180, getLbl()); $('#pomoLbl').textContent = '自由计时中(最长3小时)'; toast('自由时段计时开始'); };
    $('#pStop').onclick = () => Pomo.stopAndSave();
    bindTableEdit(el);
  }
};

/* ===== 工作进度追踪 ===== */
Views['progress'] = {
  title: '工作进度追踪',
  render(el) {
    const rows = DB.list('progress').sort((a, b) => (a.stage === '定稿' ? 1 : 0) - (b.stage === '定稿' ? 1 : 0) || String(a.deadline || '9').localeCompare(String(b.deadline || '9')));
    el.innerHTML = '<div class="toolbar"><span class="muted small">论文 / 演讲稿 / PPT 全流程节点管理</span><span class="sp"></span><button class="btn primary" id="addPg">＋ 新增项目</button></div>'
      + (rows.length ? '<div class="grid g2">' + rows.map((p) => {
        const stages = SCHEMAS.progress.stages; const ci = stages.indexOf(p.stage);
        return '<div class="card"><div style="display:flex;gap:8px;align-items:center"><b>' + esc(p.title) + '</b><span class="tag blue">' + esc(p.ptype || '') + '</span>'
          + (p.stage === '定稿' ? '<span class="tag green">已定稿 ✔</span>' : '') + '<span class="sp" style="flex:1"></span><button class="btn sm" data-edit="' + p.id + '">编辑</button></div>'
          + '<div class="stages">' + stages.map((s, i) => '<div class="stage ' + (i < ci ? 'done' : i === ci ? 'cur' : '') + '">' + s + '</div>').join('') + '</div>'
          + '<div class="muted small">' + (p.date ? '开始 ' + p.date : '') + (p.deadline ? ' · 目标 ' + p.deadline : '') + (p.note ? '<br>' + esc(String(p.note).slice(0, 60)) : '') + '</div>'
          + (ci < stages.length - 1 ? '<div style="margin-top:10px"><button class="btn sm primary" data-next="' + p.id + '">推进到「' + stages[ci + 1] + '」→</button></div>' : '')
          + '</div>';
      }).join('') + '</div>' : '<div class="card"><div class="empty">暂无项目，点击「新增项目」开始追踪</div></div>');
    $('#addPg').onclick = () => openForm('progress');
    $$('[data-edit]', el).forEach((b) => b.onclick = () => openForm('progress', DB.get('progress', b.dataset.edit)));
    $$('[data-next]', el).forEach((b) => b.onclick = () => {
      const p = DB.get('progress', b.dataset.next); const st = SCHEMAS.progress.stages;
      p.stage = st[st.indexOf(p.stage) + 1]; p['stageAt_' + p.stage] = todayStr();
      DB.upsert('progress', p); toast('已推进到「' + p.stage + '」');
      if (p.stage === '定稿') Notif.add('项目定稿 🎉', p.title, 'work');
      App.rerender();
    });
  }
};

/* ===== 育儿模块 ===== */
Views['parenting'] = subtabsView([
  {
    id: 'growth', name: '成长曲线', icon: '📏',
    view: {
      state: { month: '' },
      render(el, self) {
        const rows = DB.list('growth').sort((a, b) => a.date.localeCompare(b.date));
        el.innerHTML = '<div class="toolbar"><span class="muted small">记录身高体重，自动生成成长曲线</span><span class="sp"></span><button class="btn sm" id="expCsv2">导出CSV</button><button class="btn primary" id="addG">＋ 记一笔</button></div>'
          + '<div class="grid g2" style="margin-bottom:14px">'
          + '<div class="card"><h3>身高曲线 (cm)</h3>' + (rows.length ? '<canvas class="chart" id="hChart"></canvas>' : '<div class="empty">暂无数据</div>') + '</div>'
          + '<div class="card"><h3>体重曲线 (kg)</h3>' + (rows.length ? '<canvas class="chart" id="wChart"></canvas>' : '<div class="empty">暂无数据</div>') + '</div></div>'
          + tableHTML('growth', rows.slice().reverse());
        $('#addG').onclick = () => openForm('growth');
        $('#expCsv2').onclick = () => Exporter.csv('成长台账.csv', ['日期', '身高cm', '体重kg', '备注'], rows.map((r) => [r.date, r.height, r.weight, r.note]));
        if (rows.length) {
          Chart2.line($('#hChart'), rows.map((r) => r.date.slice(5)), [{ name: '身高', data: rows.map((r) => Number(r.height) || null), color: '#6e8efb' }]);
          Chart2.line($('#wChart'), rows.map((r) => r.date.slice(5)), [{ name: '体重', data: rows.map((r) => Number(r.weight) || null), color: '#4cc38a' }]);
        }
        bindTableEdit(el);
      }
    }
  },
  { id: 'att', name: '出勤记录', icon: '🏫', view: simpleListView('attendance', {
    top(rows) {
      const mo = monthStr();
      const mRows = rows.filter((r) => monthStr(r.date) === mo);
      return '<div class="grid g3" style="margin-bottom:14px">' + statCard('本月出勤', mRows.filter((r) => r.status === '出勤').length + ' 天', mo)
        + statCard('本月请假', mRows.filter((r) => String(r.status).startsWith('请假')).length + ' 天', '事假+病假')
        + statCard('累计记录', rows.length + ' 条', '全部历史') + '</div>';
    }
  }) },
  { id: 'health', name: '健康档案', icon: '🩺', view: simpleListView('childhealth') },
  { id: 'toys', name: '玩具台账', icon: '🧸', view: simpleListView('toys') }
]);

/* ===== 分区家务 ===== */
Views['cooking'] = (function () {
  let host = null;
  let curDate = addDays(todayStr(), 1);
  let rec = null;
  function load() {
    rec = DB.list('cooking').find((r) => r.date === curDate) || { id: 'cook-' + curDate, date: curDate, breakfast: [], lunch: [], dinner: [], shopping: [], note: '' };
  }
  function save() { DB.upsert('cooking', Object.assign({}, rec, { ts: Date.now() })); }
  function mealBlock(meal, label) {
    const list = rec[meal] || [];
    return '<div class="card"><h3>' + label + ' <span class="muted small">' + (list.length ? list.length + ' 道' : '未规划') + '</span></h3>'
      + (list.length
        ? '<div class="chip-wrap">' + list.map((d, i) => '<span class="chip">' + esc(d) + ' <b data-del="' + meal + '|' + i + '" style="cursor:pointer">✕</b></span>').join('') + '</div>'
        : '<div class="empty">还未安排' + label.slice(2) + '</div>')
      + '<div style="display:flex;gap:6px;margin-top:8px"><input id="dishInput_' + meal + '" list="dishList" placeholder="输入或选择菜品" style="flex:1"><button class="btn sm" data-add="' + meal + '">＋ 加菜</button></div>'
      + '</div>';
  }
  function render(el) {
    host = el; load();
    const dishes = DB.list('dishes').map((d) => d.name).filter(Boolean);
    const bought = (rec.shopping || []).filter((s) => s.bought).length;
    const history = DB.list('cooking').filter((r) => r.date !== curDate).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
    el.innerHTML =
      '<div class="toolbar"><span class="muted small">规划次日三餐 · 自动留存历史可一键复用</span><span class="sp"></span>'
      + '<button class="btn sm" id="clearDay">清空当日</button></div>'
      + '<div class="form-row"><label>规划日期（次日三餐）</label><input type="date" id="cookDate" value="' + curDate + '"></div>'
      + '<div class="cook-grid">'
      + mealBlock('breakfast', '🌅 早餐') + mealBlock('lunch', '☀️ 午餐') + mealBlock('dinner', '🌙 晚餐')
      + '</div>'
      + '<datalist id="dishList">' + dishes.map((d) => '<option value="' + esc(d) + '">').join('') + '</datalist>'
      + '<div class="card"><h3>🛒 食材采购清单 <span class="muted small">' + bought + '/' + (rec.shopping || []).length + ' 已采购</span></h3>'
      + '<div style="display:flex;gap:6px;margin-bottom:8px"><input id="shopName" placeholder="食材名称" style="flex:1"><input id="shopQty" placeholder="数量" style="width:90px"><button class="btn sm" id="addShop">＋ 添加</button></div>'
      + '<div style="display:flex;gap:6px;margin-bottom:8px">'
      + (rec.shopping && rec.shopping.length ? '<button class="btn sm" id="chkAll">全选已采购</button><button class="btn sm" id="clrShop">清空清单</button>' : '')
      + '</div>'
      + (rec.shopping && rec.shopping.length
        ? '<div class="shop-list">' + rec.shopping.map((s, i) => '<label class="shop-item ' + (s.bought ? 'done' : '') + '"><input type="checkbox" data-shop="' + i + '" ' + (s.bought ? 'checked' : '') + '><span><b>' + esc(s.name) + '</b>' + (s.qty ? ' <i class="muted small">' + esc(s.qty) + '</i>' : '') + '</span><b data-shopdel="' + i + '" style="cursor:pointer;color:var(--bad)">✕</b></label>').join('') + '</div>'
        : '<div class="empty">暂无采购项，先在上方菜品里想想要买什么</div>')
      + '</div>'
      + '<div class="card"><h3>📝 备注（儿童忌口 / 食材存放 / 烹饪注意）</h3>'
      + '<textarea id="cookNote" rows="3" placeholder="如：宝宝对海鲜忌口；虾仁放冷冻；西红柿去皮…">' + esc(rec.note || '') + '</textarea></div>'
      + (history.length ? '<div class="card"><h3>📚 往期食谱（点击复制到此日）</h3>'
        + '<div class="hist-list">' + history.map((h) => {
          const cnt = (h.breakfast || []).length + (h.lunch || []).length + (h.dinner || []).length;
          return '<div class="hist-item"><span class="muted small">' + h.date + '</span><span style="flex:1">' + cnt + ' 道菜 · ' + ((h.shopping || []).length) + ' 项采购</span><button class="btn sm" data-copy="' + h.id + '">复制到此日</button></div>';
        }).join('') + '</div></div>' : '');
    /* 事件绑定 */
    $('#cookDate', el).onchange = (e) => { curDate = e.target.value; render(host); };
    $$('[data-add]', el).forEach((b) => b.onclick = () => {
      const meal = b.dataset.add; const inp = $('#dishInput_' + meal, el); const name = inp.value.trim();
      if (!name) return;
      if (!(rec[meal] || []).includes(name)) rec[meal] = (rec[meal] || []).concat(name);
      if (!DB.list('dishes').some((d) => d.name === name)) DB.upsert('dishes', { name });
      inp.value = ''; save(); render(host);
    });
    $$('[data-del]', el).forEach((x) => x.onclick = () => {
      const [meal, i] = x.dataset.del.split('|'); rec[meal].splice(Number(i), 1); save(); render(host);
    });
    $('#clearDay', el).onclick = () => { rec.breakfast = []; rec.lunch = []; rec.dinner = []; rec.shopping = []; rec.note = ''; save(); render(host); toast('已清空 ' + curDate + ' 规划'); };
    $('#addShop', el).onclick = () => {
      const n = $('#shopName', el).value.trim(); const q = $('#shopQty', el).value.trim();
      if (!n) return; rec.shopping = (rec.shopping || []).concat({ name: n, qty: q, bought: false });
      $('#shopName', el).value = ''; $('#shopQty', el).value = ''; save(); render(host);
    };
    $('#chkAll', el) && ($('#chkAll', el).onclick = () => { rec.shopping.forEach((s) => s.bought = true); save(); render(host); });
    $('#clrShop', el) && ($('#clrShop', el).onclick = () => { rec.shopping = []; save(); render(host); });
    $$('[data-shop]', el).forEach((c) => c.onchange = () => { rec.shopping[Number(c.dataset.shop)].bought = c.checked; save(); render(host); });
    $$('[data-shopdel]', el).forEach((x) => x.onclick = () => { rec.shopping.splice(Number(x.dataset.shopdel), 1); save(); render(host); });
    $('#cookNote', el).onchange = (e) => { rec.note = e.target.value; save(); };
    $$('[data-copy]', el).forEach((b) => b.onclick = () => {
      const src = DB.get('cooking', b.dataset.copy); if (!src) return;
      rec = { id: 'cook-' + curDate, date: curDate, breakfast: (src.breakfast || []).slice(), lunch: (src.lunch || []).slice(), dinner: (src.dinner || []).slice(), shopping: (src.shopping || []).map((s) => ({ name: s.name, qty: s.qty, bought: false })), note: src.note || '' };
      save(); render(host); toast('已复制往期食谱到 ' + curDate);
    });
  }
  return { render: function (el) { render(el); } };
})();
Views['chores'] = subtabsView([
  {
    id: 'today', name: '今日家务', icon: '🧹',
    view: {
      state: {},
      render(el) {
        const t = todayStr();
        const rooms = SCHEMAS.chores.rooms;
        const logs = DB.list('chores').filter((c) => c.date === t);
        el.innerHTML = '<div class="toolbar"><span class="muted small">点击分区快速登记扫地/拖地状态</span><span class="sp"></span><button class="btn primary" id="addCh">＋ 记家务</button></div>'
          + '<div class="room-grid">' + rooms.map((r) => {
            const rl = logs.filter((l) => l.room === r);
            return '<div class="room-card"><h4>' + r + '</h4>'
              + ['扫地', '拖地'].map((task) => {
                const done = rl.some((l) => l.task === task && l.done === '完成');
                return '<div class="chore-line ' + (done ? 'done' : '') + '" style="cursor:pointer" data-room="' + r + '" data-task="' + task + '">' + (done ? '✔' : '○') + ' ' + task + '</div>';
              }).join('') + '</div>';
          }).join('') + '</div>';
        $('#addCh', el).onclick = () => openForm('chores');
        $$('[data-room]', el).forEach((x) => x.onclick = () => {
          const exists = DB.list('chores').find((c) => c.date === t && c.room === x.dataset.room && c.task === x.dataset.task && c.done === '完成');
          if (exists) { DB.remove('chores', exists.id); toast('已取消 ' + x.dataset.room + x.dataset.task); }
          else { DB.upsert('chores', { date: t, room: x.dataset.room, task: x.dataset.task, done: '完成', mode: 'life' }); toast(x.dataset.room + ' ' + x.dataset.task + ' 已完成 ✔'); }
          App.rerender();
        });
      }
    }
  },
  { id: 'cooking', name: '烹饪规划', icon: '🍳', view: Views['cooking'] },
  { id: 'dishes', name: '常用菜品', icon: '🍲', view: simpleListView('dishes') },
  { id: 'plans', name: '循环提醒', icon: '🔁', view: simpleListView('choreplans') },
  { id: 'history', name: '家务历史', icon: '🗂️', view: simpleListView('chores') }
]);

/* ===== 三餐&健康 ===== */
Views['health'] = subtabsView([
  { id: 'meals', name: '饮食记录', icon: '🍚', view: simpleListView('meals') },
  { id: 'body', name: '体质日志', icon: '🌡️', view: simpleListView('bodylog', {
    top(rows) {
      const recent = rows.slice(0, 30);
      const good = recent.filter((r) => r.state === '很好').length;
      return '<div class="grid g3" style="margin-bottom:14px">' + statCard('近30条状态', good + ' 次「很好」', '共 ' + recent.length + ' 条记录')
        + statCard('最近记录', recent[0] ? recent[0].state || '—' : '—', recent[0] ? recent[0].date : '')
        + statCard('调理跟踪', DB.list('therapy').length + ' 次', '食疗+艾灸累计') + '</div>';
    }
  }) },
  { id: 'therapy', name: '食疗/艾灸', icon: '🫖', view: simpleListView('therapy') }
]);

/* ===== 阅读打卡 ===== */
Views['reading'] = subtabsView([
  {
    id: 'books', name: '书单管理', icon: '📚',
    view: {
      state: {},
      render(el) {
        const rows = DB.list('books').sort((a, b) => (a.status === '在读' ? -1 : 1) - (b.status === '在读' ? -1 : 1));
        el.innerHTML = '<div class="toolbar"><span class="muted small">在读书籍支持一键更新进度</span><span class="sp"></span><button class="btn primary" id="addBk">＋ 加入书单</button></div>'
          + (rows.length ? '<div class="grid g2">' + rows.map((b) => {
            const pct = b.total ? Math.min(100, Math.round((b.current || 0) / b.total * 100)) : 0;
            return '<div class="card"><div style="display:flex;gap:8px;align-items:center"><b>' + esc(b.title) + '</b><span class="tag ' + (b.status === '在读' ? 'blue' : b.status === '已读完' ? 'green' : 'gray') + '">' + esc(b.status) + '</span><span class="sp" style="flex:1"></span><button class="btn sm" data-edit="' + b.id + '">编辑</button></div>'
              + '<div class="muted small" style="margin:6px 0">' + esc(b.author || '') + (b.total ? ' · ' + (b.current || 0) + '/' + b.total + ' 页 (' + pct + '%)' : '') + '</div>'
              + '<div style="height:7px;background:var(--line);border-radius:4px;overflow:hidden"><div style="height:100%;width:' + pct + '%;background:linear-gradient(90deg,var(--acc),var(--acc2))"></div></div>'
              + (b.status === '在读' ? '<div style="margin-top:10px;display:flex;gap:8px"><input type="number" placeholder="更新到第几页" data-pg="' + b.id + '" style="max-width:150px"><button class="btn sm primary" data-upd="' + b.id + '">打卡</button></div>' : '')
              + '</div>';
          }).join('') + '</div>' : '<div class="card"><div class="empty">书单为空，加一本开始阅读打卡</div></div>');
        $('#addBk', el).onclick = () => openForm('books');
        $$('[data-edit]', el).forEach((x) => x.onclick = () => openForm('books', DB.get('books', x.dataset.edit)));
        $$('[data-upd]', el).forEach((x) => x.onclick = () => {
          const inp = $('[data-pg="' + x.dataset.upd + '"]', el);
          const v = Number(inp.value); if (!v) return toast('请输入页数', 'err');
          const b = DB.get('books', x.dataset.upd); b.current = v;
          if (b.total && v >= b.total) { b.status = '已读完'; toast('恭喜读完《' + b.title + '》🎉'); } else toast('阅读进度已打卡 📖');
          DB.upsert('books', b); App.rerender();
        });
      }
    }
  },
  { id: 'notes', name: '读书笔记', icon: '📝', view: simpleListView('readnotes') }
]);

/* ===== 家庭出行 ===== */
Views['travel'] = subtabsView([
  { id: 'trips', name: '行程存档', icon: '✈️', view: simpleListView('trips') },
  { id: 'info', name: '机票/酒店', icon: '🎫', view: simpleListView('tripinfo') },
  {
    id: 'pack', name: '物品清单', icon: '🎒',
    view: {
      state: {},
      render(el) {
        const rows = DB.list('packing');
        const byTrip = {};
        rows.forEach((r) => (byTrip[r.trip] = byTrip[r.trip] || []).push(r));
        el.innerHTML = '<div class="toolbar"><span class="muted small">按行程分组管理，点击物品切换已装状态</span><span class="sp"></span><button class="btn primary" id="addPk">＋ 添加物品</button></div>'
          + (Object.keys(byTrip).length ? Object.entries(byTrip).map(([trip, items]) => {
            const done = items.filter((i) => i.packed === '已装').length;
            return '<div class="card" style="margin-bottom:12px"><h3>🎒 ' + esc(trip) + ' <span class="muted small">' + done + '/' + items.length + ' 已装</span></h3>'
              + items.map((i) => '<div class="chore-line ' + (i.packed === '已装' ? 'done' : '') + '" style="cursor:pointer" data-tg="' + i.id + '">' + (i.packed === '已装' ? '✔' : '○') + ' ' + esc(i.item) + '</div>').join('') + '</div>';
          }).join('') : '<div class="card"><div class="empty">暂无清单</div></div>');
        $('#addPk', el).onclick = () => openForm('packing');
        $$('[data-tg]', el).forEach((x) => x.onclick = () => { const r = DB.get('packing', x.dataset.tg); r.packed = r.packed === '已装' ? '未装' : '已装'; DB.upsert('packing', r); App.rerender(); });
      }
    }
  }
]);

/* ===== 兼职模块 ===== */
Views['sidejob'] = subtabsView([
  {
    id: 'live', name: '游戏直播', icon: '🎮',
    view: {
      state: { month: '' },
      render(el, self) {
        const hours = DB.list('livehours');
        const t = todayStr(); const wk = weekKey(t); const mo = monthStr();
        const wH = hours.filter((h) => weekKey(h.date) === wk).reduce((s, h) => s + Number(h.hours || 0), 0);
        const mH = hours.filter((h) => monthStr(h.date) === mo).reduce((s, h) => s + Number(h.hours || 0), 0);
        const inc = DB.list('liveincome', { month: mo });
        const gross = inc.reduce((s, x) => s + Number(x.gross || 0), 0);
        const net = inc.reduce((s, x) => s + Number(x.net || x.gross || 0), 0);
        el.innerHTML = '<div class="grid g4" style="margin-bottom:14px">'
          + statCard('本周直播时长', wH.toFixed(1) + ' 小时', '自动周汇总')
          + statCard('本月直播时长', mH.toFixed(1) + ' 小时', '自动月汇总')
          + statCard('本月税前收益', '<span class="amt-in">' + fmtMoney(gross) + '</span>', mo)
          + statCard('本月税后收益', '<span class="amt-in">' + fmtMoney(net) + '</span>', '含未填税后按税前计')
          + '</div>'
          + '<div class="grid g2" id="liveTables"></div>';
        const wrap = $('#liveTables', el);
        const mk = (colKey, title) => {
          const box = document.createElement('div'); box.className = 'card';
          const rows = DB.list(colKey).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 50);
          box.innerHTML = '<h3>' + title + '<span class="more" data-add="' + colKey + '">＋ 新增</span></h3>' + tableHTML(colKey, rows);
          wrap.appendChild(box);
        };
        mk('livehours', '⏱ 直播时长台账'); mk('liveincome', '💵 直播收益台账(税前/税后)'); mk('livetopics', '💡 直播选题备忘'); mk('sidereminds', '⏰ 兼职提醒配置');
        $$('[data-add]', el).forEach((x) => x.onclick = () => openForm(x.dataset.add));
        bindTableEdit(el);
      }
    }
  },
  {
    id: 'novel', name: '小说撰写', icon: '✍️',
    view: {
      state: {},
      render(el) {
        const prog = DB.list('novelprogress');
        const mo = monthStr();
        const mWords = prog.filter((p) => monthStr(p.date) === mo).reduce((s, p) => s + Number(p.words || 0), 0);
        const latest = prog.sort((a, b) => b.date.localeCompare(a.date))[0];
        el.innerHTML = '<div class="grid g3" style="margin-bottom:14px">'
          + statCard('本月码字', (mWords / 10000).toFixed(2) + ' 万字', mo)
          + statCard('当前存稿', latest ? (latest.stock || 0) + ' 章' : '—', latest ? latest.work : '')
          + statCard('素材库', DB.list('tropes').length + ' 条爆点 / ' + DB.list('inspirations').length + ' 条灵感', '持续积累中')
          + '</div><div class="grid g2" id="novTables"></div>';
        const wrap = $('#novTables', el);
        [['novelprogress', '✍️ 写作进度(字数/存稿/投稿节点)'], ['inspirations', '✨ 灵感标签库'], ['tropes', '🔥 女频爆点素材库']].forEach(([k, t2]) => {
          const box = document.createElement('div'); box.className = 'card';
          const isTropes = (k === 'tropes');
          box.innerHTML = '<h3>' + t2
            + '<span class="more" data-add="' + k + '">＋ 新增</span>'
            + (isTropes ? '<span class="more" id="refreshDouyin" style="color:#e74c3c;cursor:pointer" title="从抖音热榜自动获取最新爆点素材">🔄 抖音刷新</span>' : '')
            + '</h3>' + tableHTML(k, DB.list(k).sort((a, b) => {
              if (k === 'tropes') return Number(b.heat || 0) - Number(a.heat || 0); /* 按热度降序 */
              return String(b.date || '').localeCompare(String(a.date || ''));
            }).slice(0, 50));
          wrap.appendChild(box);
        });
        $$('[data-add]', el).forEach((x) => x.onclick = () => openForm(x.dataset.add));
        /* 抖音热榜刷新按钮 */
        const refreshBtn = $('#refreshDouyin', el);
        if (refreshBtn) {
          refreshBtn.onclick = async () => {
            if (refreshBtn.dataset.loading === '1') return;
            refreshBtn.dataset.loading = '1';
            refreshBtn.textContent = '⏳ 获取中...';
            try {
              const r = await DouyinHot.syncToTropes(20);
              toast('抖音热榜同步完成 ✅ 新增 ' + r.added + ' 条 · 跳过重复 ' + r.skipped + ' 条（更新时间: ' + (r.updateTime || '') + '）');
              App.rerender();
            } catch (e) {
              toast('抖音热榜获取失败: ' + (e.message || '网络异常'), 'err');
            } finally {
              refreshBtn.dataset.loading = '';
              refreshBtn.textContent = '🔄 抖音刷新';
            }
          };
        }
        bindTableEdit(el);
      }
    }
  },
  {
    id: 'income', name: '收益汇总', icon: '🪙',
    view: {
      state: { month: '' },
      render(el, self) {
        const rows = DB.list('sideincome', { month: self.state.month || null }).sort((a, b) => b.date.localeCompare(a.date));
        /* 近6月对比: 汇总 sideincome + liveincome(net) */
        const months = []; const now = new Date();
        for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); }
        const sums = months.map((mm) =>
          DB.list('sideincome', { month: mm }).reduce((s, x) => s + Number(x.amount || 0), 0)
          + DB.list('liveincome', { month: mm }).reduce((s, x) => s + Number(x.net || x.gross || 0), 0));
        const mo = monthStr();
        const cur = sums[months.indexOf(mo)] || 0;
        el.innerHTML = '<div class="grid g3" style="margin-bottom:14px">'
          + statCard('本月兼职总收入', '<span class="amt-in">' + fmtMoney(cur) + '</span>', '直播(税后)+小说+其他')
          + statCard('近6月累计', '<span class="amt-in">' + fmtMoney(sums.reduce((a, b) => a + b, 0)) + '</span>', '多月合计')
          + statCard('独立核算', '不混入工作/家庭账', '收支独立 ✔')
          + '</div>'
          + '<div class="card" style="margin-bottom:14px"><h3>多月收入对比</h3><canvas class="chart" id="sideChart"></canvas></div>'
          + monthToolbar(self.state, 'sideincome') + tableHTML('sideincome', rows);
        Chart2.bar($('#sideChart'), months.map((m2) => m2.slice(5) + '月'), [{ name: '收入', data: sums, color: '#e5a54b' }]);
        bindMonthToolbar(el, self.state, 'sideincome');
        bindTableEdit(el);
      }
    }
  }
]);

/* ===== 倒数日 ===== */
Views['countdown'] = {
  title: '倒数日',
  render(el) {
    const t = todayStr();
    const list = DB.list('countdowns').map((c) => {
      let target = c.date;
      if (c.yearly && target) { const md = c.date.slice(5); const y = new Date().getFullYear(); target = y + '-' + md; if (target < t) target = (y + 1) + '-' + md; }
      return Object.assign({}, c, { target, days: target ? daysBetween(t, target) : 9999 });
    }).sort((a, b) => a.days - b.days);
    const hold = DB.setting('manualHold', null);
    const av = ModeCtl.activeVacation(t);
    const tagMap = { work: ['工作事项', 'blue', ''], vacation: ['休假日程', 'green', 'vac'], anniversary: ['重点纪念日', 'orange', 'anni'] };
    el.innerHTML = '<div class="toolbar"><span class="muted small">'
      + (av ? '🏖️ 当前处于休假期「' + esc(av.title) + '」(至 ' + av.end + ')' : '当前无进行中的休假')
      + (hold && hold.until && t <= hold.until ? ' · ⚠️ 已手动切换，本轮休假周期内自动切换已暂停(至 ' + hold.until + ')' : ' · 自动模式切换运行中')
      + '</span><span class="sp"></span><button class="btn primary" id="addCd">＋ 新增倒数日</button></div>'
      + (list.length ? '<div class="grid g3">' + list.map((c) => {
        const tm = tagMap[c.tag] || ['其他', 'gray', ''];
        const passed = c.days < 0;
        return '<div class="card cd-card ' + tm[2] + '" data-edit="' + c.id + '" style="cursor:pointer">'
          + '<div style="display:flex;gap:6px;align-items:center"><span class="tag ' + tm[1] + '">' + tm[0] + '</span>' + (c.yearly ? '<span class="tag gray">年循环</span>' : '') + (c.remind ? '<span class="tag gray">🔔</span>' : '') + '</div>'
          + '<div style="margin:8px 0 2px;font-weight:600">' + esc(c.title) + '</div>'
          + '<div class="cd-days">' + (c.days === 0 ? '今天' : passed ? Math.abs(c.days) : c.days) + '<em>' + (c.days === 0 ? '🎉' : passed ? '天前' : '天后') + '</em></div>'
          + '<div class="muted small">' + c.target + (c.tag === 'vacation' && c.endDate ? ' ~ ' + c.endDate : '') + (c.note ? '<br>' + esc(String(c.note).slice(0, 40)) : '') + '</div>'
          + (c.tag === 'anniversary' && c.birthday ? '<button class="btn sm" data-gift="' + c.id + '" style="margin-top:10px">🎁 生日礼物建议</button>' : '')
          + '</div>';
      }).join('') + '</div>' : '<div class="card"><div class="empty">暂无倒数日。添加「休假日程」类条目即可启用自动模式切换 🏖️</div></div>');
    $('#addCd').onclick = () => openForm('countdowns');
    $$('[data-edit]', el).forEach((x) => x.onclick = () => openForm('countdowns', DB.get('countdowns', x.dataset.edit)));
    $$('[data-gift]', el).forEach((x) => x.onclick = (e) => { e.stopPropagation(); const rec = DB.get('countdowns', x.dataset.gift); if (rec) showGiftModal(rec); });
  }
};

/* ===== 设置 ===== */
Views['settings'] = {
  title: '设置',
  render(el) {
    const gs = DB.setting('notifGroups', { workInVacation: false, lifeInWork: false });
    const sync = Sync.cfg();
    const mode = ModeCtl.current();
    const navGroups = [['work', '牛马模式模块'], ['life', '休假模式模块'], ['global', '全局模块']];
    el.innerHTML =
      '<div class="grid g2">'
      + '<div class="card"><h3>☁️ 账号与云同步</h3>'
      + '<div class="muted small" style="margin-bottom:10px">两端填写<b>相同同步码</b>即可双向同步(同步码相当于账号/空间名)。' + (typeof window !== 'undefined' && window.CLOUD_SYNC ? '<b>已连接腾讯云同步服务</b>，无需填写同步服务地址；' : '') + '离线时数据自动缓存本地，联网后自动推送。也可用下方「备份导出/导入」在设备间迁移。</div>'
      + '<div class="form-row"><label>同步服务地址</label><input id="syncUrl" placeholder="https://your-kv-server.com/kv" value="' + esc(sync.url) + '"' + (typeof window !== 'undefined' && window.CLOUD_SYNC ? ' disabled title="已使用云端同步服务"' : '') + '></div>'
      + '<div class="form-row"><label>同步码(空间名)</label><input id="syncKey" placeholder="如 fjj / 2026 / 自定义" value="' + (esc(sync.key) || '') + '"></div>'
      + '<button class="btn primary" id="saveSync">保存并立即同步</button> <button class="btn" id="pullNow">手动拉取</button>'
      + '<div class="muted small" style="margin-top:8px">当前同步码: <b>' + esc(Sync.code()) + '</b> · 状态: ' + (Sync.status === 'cloud' ? '☁️ 云同步开启' : Sync.status === 'offline' ? '📴 离线缓存中' : '💾 本地模式') + (Sync.lastSync ? ' · 上次同步 ' + new Date(Sync.lastSync).toLocaleTimeString('zh-CN') : '') + '</div></div>'
      + '<div class="card"><h3>💾 数据管理(按月分区)</h3>'
      + '<div class="form-row"><label>选择月份导出</label><input type="month" id="expMonth" value="' + monthStr() + '"></div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap">'
      + '<button class="btn" id="expM">导出该月数据</button>'
      + '<button class="btn" id="expAll">全量备份(JSON)</button>'
      + '<button class="btn" id="impBk">导入备份</button><input type="file" id="impBkFile" accept=".json" style="display:none"></div>'
      + '<div class="muted small" style="margin-top:8px">备份文件可在另一台设备导入，自动按记录合并、不覆盖新数据。</div></div>'
      + '<div class="card"><h3>🔔 提醒分组管控</h3>'
      + setSwitch('sysNotify', '系统通知推送', '浏览器/手机系统级通知(需授权)', DB.setting('sysNotify', true))
      + setSwitch('g_work', '休假模式接收工作类强提醒', '默认关闭，休假期屏蔽工作提醒', gs.workInVacation)
      + setSwitch('g_life', '牛马模式接收育儿/家务提醒', '默认关闭，工作期屏蔽生活提醒', gs.lifeInWork)
      + setSwitch('cookRemind', '每日晚间提醒规划次日三餐', '默认开启，19点后若次日未规划则推送', DB.setting('cookRemind', true))
      + '<div class="muted small" style="margin-top:6px">兼职提醒(直播/写作/投稿)始终全局推送，不受模式限制。</div></div>'
      + '<div class="card"><h3>🎨 主题与模式</h3>'
      + '<div class="set-row"><div class="lbl">当前主题<div class="d">低饱和深色 / 浅色一键切换</div></div><button class="btn" id="setTheme">切换主题</button></div>'
      + '<div class="set-row"><div class="lbl">当前模式<div class="d">' + (mode === 'work' ? '🐮 牛马模式' : '🏖️ 休假模式') + '(手动切换优先于自动调度)</div></div><button class="btn" id="setMode">切换模式</button></div>'
      + '<div class="set-row"><div class="lbl">当前版本<div class="d">' + (App.version || 'dev') + ' · 若功能异常请尝试「清除浏览器缓存」或重新打开启动器</div></div></div></div>'
      + navGroups.map(([g, gn]) => '<div class="card"><h3>📌 ' + gn + ' · 排序/重命名/隐藏</h3><div class="muted small" style="margin-bottom:8px">拖拽调整顺序；双击名称重命名；点眼睛隐藏/显示</div>'
        + '<div data-navgroup="' + g + '">' + getNav(g).map((it, i) => '<div class="set-row" draggable="true" data-i="' + i + '" style="cursor:grab">'
          + '<span>' + it.icon + '</span><div class="lbl" data-rename="' + i + '" title="双击重命名">' + esc(it.name) + '</div>'
          + '<button class="btn sm" data-hide="' + i + '">' + (it.hidden ? '🙈 已隐藏' : '👁 显示中') + '</button>'
          + '<span style="cursor:grab;color:var(--txt3)">⠿</span></div>').join('') + '</div></div>').join('')
      + '</div>';
    /* 同步 */
    $('#saveSync').onclick = () => {
      const url = $('#syncUrl').value.trim();
      const key = $('#syncKey').value.trim();
      DB.setSetting('syncCfg', { url, key });
      const cloud = !!(window.CLOUD_SYNC && window.CLOUD_SYNC.getUrl && window.CLOUD_SYNC.putUrl);
      toast('同步配置已保存' + (key ? ' · 同步码: ' + key : ''));
      Sync.setStatus(navigator.onLine ? (cloud || url ? 'cloud' : 'local') : 'offline');
      Sync.push(); Sync.pull();
    };
    $('#pullNow').onclick = () => { Sync.pull(); toast('正在拉取云端数据…'); };
    /* 导出导入 */
    $('#expM').onclick = () => Exporter.monthBackup($('#expMonth').value);
    $('#expAll').onclick = () => Exporter.fullBackup();
    $('#impBk').onclick = () => $('#impBkFile').click();
    $('#impBkFile').onchange = (e) => { if (e.target.files[0]) Exporter.importBackup(e.target.files[0], () => App.rerender()); };
    /* 开关 */
    const bindSw = (id, fn) => { const s = $('#' + id); if (s) s.onclick = () => { fn(!s.classList.contains('on')); App.rerender(); }; };
    bindSw('sysNotify', (v) => { DB.setSetting('sysNotify', v); if (v) Notif.askPermission(); });
    bindSw('g_work', (v) => { gs.workInVacation = v; DB.setSetting('notifGroups', gs); });
    bindSw('g_life', (v) => { gs.lifeInWork = v; DB.setSetting('notifGroups', gs); });
    bindSw('cookRemind', (v) => { DB.setSetting('cookRemind', v); });
    $('#setTheme').onclick = () => App.toggleTheme();
    $('#setMode').onclick = () => ModeCtl.manualSwitch(mode === 'work' ? 'life' : 'work');
    /* 导航自定义 */
    $$('[data-navgroup]', el).forEach((box) => {
      const g = box.dataset.navgroup;
      let dragIdx = null;
      $$('[draggable]', box).forEach((row) => {
        row.addEventListener('dragstart', () => { dragIdx = Number(row.dataset.i); row.classList.add('dragging'); });
        row.addEventListener('dragend', () => row.classList.remove('dragging'));
        row.addEventListener('dragover', (ev) => ev.preventDefault());
        row.addEventListener('drop', (ev) => {
          ev.preventDefault();
          const to = Number(row.dataset.i);
          const list = getNav(g); const [mv] = list.splice(dragIdx, 1); list.splice(to, 0, mv);
          saveNav(g, list); toast('顺序已调整'); App.rerender();
        });
      });
      $$('[data-hide]', box).forEach((b) => b.onclick = () => {
        const list = getNav(g); list[Number(b.dataset.hide)].hidden = !list[Number(b.dataset.hide)].hidden;
        saveNav(g, list); toast('已更新显示状态'); App.rerender();
      });
      $$('[data-rename]', box).forEach((d) => d.ondblclick = () => {
        const list = getNav(g); const i = Number(d.dataset.rename);
        const nn = prompt('输入新名称', list[i].name);
        if (nn && nn.trim()) { list[i].name = nn.trim(); saveNav(g, list); toast('已重命名'); App.rerender(); }
      });
    });
  }
};
function setSwitch(id, label, desc, on) {
  return '<div class="set-row"><div class="lbl">' + label + '<div class="d">' + desc + '</div></div><div class="switch ' + (on ? 'on' : '') + '" id="' + id + '"></div></div>';
}

/* =========================================================
 * 油田动态监测四大模块（牛马模式专属，与休假/兼职/倒数日数据隔离）
 * ========================================================= */
function dmList(col, month) { return DB.list(col, month ? { month } : {}); }

/* ===== 动态监测施工量 Excel 导入 ===== */
/* 列名 → 字段映射(支持多种常见中文表头写法) */
const DM_WL_MAP = {
  '计划日期': 'planDate', '计划下达时间': 'planDate', '计划下发时间': 'planDate', '下达时间': 'planDate',
  '日期': 'date', '时间': 'date', '日期列': 'date', '开始日期': 'date', '施工日期': 'date', '实际开始日期': 'date',
  '测试项目': 'project', '项目': 'project', '监测项目': 'project', '作业内容': 'project',
  '井号': 'wellNo',
  '作业区': 'area', '工区': 'area', '区域': 'area', '采油作业区': 'area',
  '施工队伍': 'team', '队伍': 'team', '承包商': 'team', '施工方': 'team', '施工承包商': 'team', '承包商队伍': 'team',
  '技术服务公司': 'team', '测试队伍': 'team', '队伍名称': 'team', '施工单位': 'team', '服务公司': 'team',
  '测试小队名称': 'subTeam', '小队': 'subTeam', '小队名称': 'subTeam',
  '完成井次': 'completed', '完成井数': 'completed', '井次': 'completed', '完成': 'completed', '完成数': 'completed',
  '上井次数': 'completed', '测试次数': 'completed', '施工井次': 'completed', '实到井次': 'completed',
  '失败井次': 'failed', '未成功井次': 'failed', '失败': 'failed', '空跑次数': 'failed',
  '失败原因': 'failReason', '失败原因分类': 'failReason', '原因': 'failReason',
  '结束日期': 'endDate',
  '合同履约金额': 'contractAmount', '合同履约': 'contractAmount', '合同金额': 'contractAmount', '履约金额': 'contractAmount',
  '金额': 'contractAmount', '结算金额': 'contractAmount', '结算金额（元）': 'contractAmount', '合计金额': 'contractAmount', '合同降点金额': 'contractAmount',
  '线下吸水剖面设计单数量': 'offlineDesign', '吸水剖面设计单数量': 'offlineDesign', '设计单数量': 'offlineDesign',
  '作业区自测井次': 'selfTest', '自测井次': 'selfTest', '自测': 'selfTest',
  '备注': 'note', '说明': 'note', '备注栏': 'note', '备注信息': 'note'
};
/* 把 Excel 里的长公司名称归一化到 DM_TEAMS 短名；未命中则保留原值 */
const DM_TEAM_MAP = {
  '中国石油集团测井有限公司长庆分公司': '中油测井',
  '西安石油大佳润实业有限公司': '西安佳润', '西安大佳润': '西安佳润',
  '西安思坦油气工程服务有限公司': '西安思坦', '西安思坦': '西安思坦',
  '延安市奥维石油工程技术有限公司': '延安奥维', '延安奥维': '延安奥维',
  '陕西宏博石油科技有限公司': '陕西宏博', '陕西宏博': '陕西宏博',
  '陕西金峪科工贸有限责任公司': '陕西金峪', '陕西金峪': '陕西金峪',
  '庆阳华宇石油工程技术有限公司': '庆阳华宇', '庆阳华宇': '庆阳华宇',
  '庆阳东祥石油科技有限公司': '庆阳东祥', '庆阳东祥': '庆阳东祥'
};
function dmWlClean(v) { return v == null ? '' : String(v).trim().replace(/^'+/, ''); }
function dmWlNormTeam(v) {
  const s = dmWlClean(v);
  if (!s) return '';
  if (DM_TEAM_MAP[s]) return DM_TEAM_MAP[s];
  for (const k in DM_TEAM_MAP) { if (s.indexOf(k) >= 0) return DM_TEAM_MAP[k]; }
  for (const k in DM_TEAM_MAP) { if (k.indexOf(s) >= 0) return DM_TEAM_MAP[k]; }
  // 取前8字作为简称，避免图表太长
  return s.length > 12 ? s.slice(0, 8) + '…' : s;
}
function dmWlMapHeader(h) {
  h = (h || '').toString().trim(); if (!h) return null;
  for (const k in DM_WL_MAP) { if (k === h) return DM_WL_MAP[k]; }
  let best = null, bl = 0;
  for (const k in DM_WL_MAP) { if ((h.indexOf(k) >= 0 || k.indexOf(h) >= 0) && k.length > bl) { best = DM_WL_MAP[k]; bl = k.length; } }
  return best;
}
function _fmtDateByChina(d) {
  // 强制按 Asia/Shanghai（中国标准时间）取日期，避免浏览器/手机时区设置导致 Excel 日期差一天
  try {
    const loc = d.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const m = loc.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
  } catch (e) {}
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dmWlNormDate(v) {
  if (!v) return null;
  if (v instanceof Date) return _fmtDateByChina(v);
  let s = String(v).trim().replace(/^'+/, '').replace(/\//g, '-').replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '');
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) return s.slice(0, 10);
  // 20260515 / 2026-05-15 / 2026/05/15
  if (/^\d{8}$/.test(s)) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
  // Excel 序列号(40000~50000 对应 2098~2044 附近; 实际 2026 约 46000)
  if (/^\d{5,6}$/.test(s)) { const d = new Date((Number(s) - 25569) * 86400000); return _fmtDateByChina(d); }
  // JS Date.toString() 格式，如 "Thu May 14 2026 23:59:17 GMT+0800 (中国标准时间)"（CSV或某些Excel文本格式）
  if (/^[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+GMT[+-]?\d{4}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d)) return _fmtDateByChina(d);
  }
  return null;
}
/* Excel 解析：csv 原生；xlsx/xls 通过 SheetJS(运行时按需加载CDN) */
const ExcelImport = {
  _ensureXLSX(cb) {
    if (window.XLSX) return cb();
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => cb(); s.onerror = () => cb(new Error('CDN'));
    document.head.appendChild(s);
  },
  parse(file, cb) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.csv')) {
      const fr = new FileReader();
      fr.onload = (e) => {
        try {
          const text = e.target.result;
          const lines = text.split(/\r?\n/).filter((l) => l.trim());
          if (!lines.length) return cb(new Error('empty'));
          const delim = text.indexOf('\t') >= 0 ? '\t' : ',';
          const heads = lines[0].split(delim).map((h) => h.trim().replace(/^"|"$/g, ''));
          const rows = lines.slice(1).map((line) => {
            const cells = line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
            const o = {}; heads.forEach((h, i) => o[h] = cells[i] || ''); return o;
          });
          cb(null, rows);
        } catch (er) { cb(er); }
      };
      fr.readAsText(file); return;
    }
    if (name.endsWith('.xls') || name.endsWith('.xlsx')) {
      this._ensureXLSX((err) => {
        if (err || !window.XLSX) return cb(new Error('SheetJS'));
        const fr = new FileReader();
        fr.onload = (e) => {
          try {
            // cellDates:false 保持 Excel 原生序列号，避免 SheetJS 按浏览器时区偏移日期导致差一天
            const wb = XLSX.read(e.target.result, { type: 'array', cellDates: false });
            const ws = wb.Sheets[wb.SheetNames[0]];
            // 用 header:1 解析为二维数组：重复表头保留首个值(避免后列「备注」覆盖前列「备注」)
            const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            if (!aoa.length) return cb(new Error('empty'));
            const hdr = aoa[0].map((h) => (h == null ? '' : String(h).trim()));
            const rows = aoa.slice(1).map((r) => {
              const o = {};
              hdr.forEach((h, i) => {
                if (!h) return;
                let v = r[i];
                if (v == null) v = '';
                else if (v instanceof Date) v = v;
                else if (typeof v === 'string') v = v.trim();
                else v = String(v).trim();
                if (o[h] === undefined) o[h] = v;
                else o[h] = (o[h] ? o[h] + '；' : '') + v;
              });
              return o;
            });
            cb(null, rows);
          } catch (er) { cb(er); }
        };
        fr.readAsArrayBuffer(file);
      }); return;
    }
    cb(new Error('format'));
  },
  /* 返回工作簿全部 sheet 的二维数组(aoa)，用于多表质量统计表导入 */
  parseAll(file, cb) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.csv')) {
      this.parse(file, (err, rows) => {
        if (err) return cb(err);
        if (!rows.length) return cb(new Error('empty'));
        const heads = Object.keys(rows[0]);
        const aoa = [heads].concat(rows.map((r) => heads.map((h) => r[h])));
        cb(null, [{ name: 'CSV', aoa }]);
      });
      return;
    }
    if (name.endsWith('.xls') || name.endsWith('.xlsx')) {
      this._ensureXLSX((err) => {
        if (err || !window.XLSX) return cb(new Error('SheetJS'));
        const fr = new FileReader();
        fr.onload = (e) => {
          try {
            const wb = XLSX.read(e.target.result, { type: 'array', cellDates: false });
            const out = wb.SheetNames.map((nm) => {
              const ws = wb.Sheets[nm];
              const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
              return { name: nm, aoa };
            });
            cb(null, out);
          } catch (er) { cb(er); }
        };
        fr.readAsArrayBuffer(file);
      });
      return;
    }
    cb(new Error('format'));
  }
};
/* 把解析后的行合并入库：Excel 行按(开始日期+作业区+队伍+项目)去重更新，手机录入数据(src缺失)不被覆盖
   dryRun=true 时只统计不写库，返回 preview/skip 明细，供确认弹窗使用 */
/* 失败/进行中/失败原因 判定辅助 */
function dmWlIsUnfin(v) { const s = dmWlClean(v); return s.indexOf('未完成') >= 0; }
function dmWlIsDateVal(v) { const s = dmWlClean(v); return s !== '' && s.indexOf('未完成') < 0; }
/* 兼容旧记录：没有显式 status 时保守推断；无结束日期且非失败 => 未开工，避免旧数据大量误报进行中 */
function dmWlStatusOf(x) {
  if (x.status) return x.status;
  if (Number(x.failed) > 0 || x.endDate === '未完成') return '失败';
  if (x.endDate && x.endDate !== '' && x.endDate !== '未完成') return '完成';
  return '未开工';
}
function extractFailReason(note) {
  if (!note) return '';
  const matched = DM_FAIL.filter((k) => note.indexOf(k) >= 0);
  if (matched.length) return matched.join('、');
  return note.length > 50 ? note.slice(0, 50) + '…' : note;
}
function importDmWorkload(rows, dryRun) {
  let added = 0, updated = 0, bad = 0;
  const preview = [], skip = [], unknownFail = new Set();

  const keyOf = (r) => [r.date, r.area, r.team, r.project, r.wellNo || ''].join('|');
  const run = (exMap) => {
    rows.forEach((raw) => {
      const rec = {};
      // 明确处理 计划日期 / 开始日期 / 结束日期（三列独立，不再混用）
      const pv = raw['计划下达时间'] != null ? dmWlClean(raw['计划下达时间']) : (raw['计划日期'] != null ? dmWlClean(raw['计划日期']) : '');
      const sv = raw['开始日期'] != null ? dmWlClean(raw['开始日期']) : '';
      const ev = raw['结束日期'] != null ? dmWlClean(raw['结束日期']) : '';
      const svUnfin = dmWlIsUnfin(sv);
      const evUnfin = dmWlIsUnfin(ev);
      const failed = svUnfin || evUnfin;
      // 计划日期 = 计划下达时间（仅取有效日期）
      let planDate = '';
      if (dmWlIsDateVal(pv)) planDate = dmWlNormDate(pv) || '';
      // 开始日期 = 实际开工日期（优先级：开始日期 > 结束日期）
      let dateRaw = '';
      if (dmWlIsDateVal(sv)) dateRaw = sv;
      else if (dmWlIsDateVal(ev)) dateRaw = ev;
      // 结束日期存储（真日期 or 「未完成」标记）
      let endDate = '';
      if (dmWlIsDateVal(ev)) endDate = dmWlNormDate(ev) || '';
      else if (evUnfin) endDate = '未完成';
      // 其余字段走通用映射（已排除 date/endDate）
      for (const h in raw) {
        const fk = dmWlMapHeader(h); if (fk === null || fk === 'date' || fk === 'endDate') continue;
        let val = raw[h] == null ? '' : (raw[h] instanceof Date ? raw[h] : dmWlClean(raw[h]));
        if (fk === 'note') { if (val) rec[fk] = (rec[fk] ? rec[fk] + '；' : '') + val; }
        else if (fk === 'failReason') { if (val) rec[fk] = (rec[fk] ? rec[fk] + '；' : '') + val; }
        else { if (val !== '' && val != null) rec[fk] = val; }
      }
      // 队伍：取技术服务公司，归一化短名；测试小队名称单独存 subTeam
      rec.team = dmWlNormTeam(rec.team);
      // 完成井次 = 上井次数（缺则记 0）
      if (rec.completed === '' || rec.completed == null) rec.completed = 0;
      // 失败井次 + 失败原因（抓取备注关键字）
      rec.failed = failed ? 1 : 0;
      if (failed) {
        rec.failReason = extractFailReason(rec.note || '');
      } else if (rec.failReason) {
        const parts = rec.failReason.split(/[，,、/]/).map((s) => s.trim()).filter(Boolean);
        parts.forEach((p) => { if (DM_FAIL.indexOf(p) < 0) unknownFail.add(p); });
        rec.failReason = parts.join('、');
      }
      const d = dmWlNormDate(dateRaw);
      const miss = [];
      if (!d) miss.push('日期'); if (!rec.project) miss.push('测试项目'); if (!rec.area) miss.push('作业区'); if (!rec.team) miss.push('施工队伍');
      if (miss.length) { bad++; skip.push((d || dateRaw || '?') + ' / ' + (rec.area || '?') + ' / ' + (rec.team || '?') + ' / ' + (rec.project || '?') + '（缺：' + miss.join('、') + '）'); return; }
      rec.planDate = planDate; rec.date = d; rec.endDate = endDate;
      rec.status = failed ? '失败' : (dmWlIsDateVal(sv) && endDate === '' ? '进行中' : (dmWlIsDateVal(ev) ? '完成' : '未开工'));
      ['completed', 'failed', 'offlineDesign', 'selfTest', 'contractAmount'].forEach((k) => { if (rec[k] !== undefined && rec[k] !== '') rec[k] = Number(rec[k]) || 0; });
      const tag = rec.status === '失败' ? '（失败）' : (rec.status === '进行中' ? '（进行中）' : '');
      const key = keyOf(rec);
      const ex = exMap.get(key);
      if (ex) {
        updated++; preview.push({ act: '更新', line: rec.date + ' · ' + rec.area + ' · ' + rec.team + ' · ' + rec.project + tag });
        if (!dryRun) DB.upsert('dm-workload', Object.assign(ex, rec, { src: 'excel' }));
      } else {
        added++; preview.push({ act: '新增', line: rec.date + ' · ' + rec.area + ' · ' + rec.team + ' · ' + rec.project + tag });
        if (!dryRun) DB.upsert('dm-workload', Object.assign({ id: uid() }, rec, { src: 'excel', mode: 'work' }));
      }
    });
  };

  if (!dryRun) {
    // 批量模式：先清空旧 Excel 记录，再统一写入，仅最后 save 一次，避免 900+ 次 localStorage 写入卡死
    DB.batch(() => {
      const col = DB.col('dm-workload');
      DB.data.collections['dm-workload'] = col.filter((r) => r.src !== 'excel');
      run(new Map());
    });
  } else {
    const exMap = new Map();
    DB.list('dm-workload').filter((r) => r.src === 'excel').forEach((r) => exMap.set(keyOf(r), r));
    run(exMap);
  }
  return { added, updated, bad, preview, skip, unknownFail: Array.from(unknownFail) };
}

/* ===== 动态监测资料管控：数据库进度 Excel 导入 ===== */
const DM_DB_MAP = {
  '井号': 'well',
  '监测技术': 'tech',
  '测试小队': 'team', '测试单位小队': 'team', '小队': 'team',
  '测试日期': 'testDate',
  '完工日期': 'finishDate',
  '当前状态': 'status',
  '资料上传日期': 'uploadDate',
  'TRACESTATUS': 'dbStatus', '资料状态追踪': 'dbStatus', '库内状态': 'dbStatus'
};
function dmDbMapHeader(h) {
  h = (h || '').toString().trim();
  if (DM_DB_MAP[h]) return DM_DB_MAP[h];
  let best = null, bl = 0;
  for (const k in DM_DB_MAP) { if ((h.indexOf(k) >= 0 || k.indexOf(h) >= 0) && k.length > bl) { best = DM_DB_MAP[k]; bl = k.length; } }
  return best;
}
function dmDbNormDate(v) {
  const d = dmWlNormDate(v);
  if (!d || d === '1900-01-01') return '';
  return d;
}
function dmDbNormStatus(v) {
  const s = dmWlClean(v);
  if (s.indexOf('失败') >= 0) return '失败';
  if (s.indexOf('完成') >= 0) return '已完成';
  if (s.indexOf('进行') >= 0 || s.indexOf('正在') >= 0) return '正在进行';
  if (s.indexOf('待') >= 0 || s.indexOf('未') >= 0) return '待开工';
  return s || '其他';
}
/* 资料上传日期与状态同步：当前状态为「已完成」却未填资料上传日期时，默认取完工日期/测试日期 */
function dmDbEffectiveUploadDate(r) {
  if (r.uploadDate && r.uploadDate !== '1900-01-01') return r.uploadDate;
  if (String(r.status || '').indexOf('完成') >= 0) {
    if (r.finishDate && r.finishDate !== '1900-01-01') return r.finishDate;
    if (r.testDate && r.testDate !== '1900-01-01') return r.testDate;
  }
  return '';
}
function importDbProgress(rows, dryRun) {
  let added = 0, updated = 0, bad = 0;
  const preview = [], skip = [];

  const keyOf = (r) => [r.well, r.testDate || '', r.tech || ''].join('|');
  const run = (exMap) => {
    rows.forEach((raw) => {
      const rec = {};
      for (const h in raw) {
        const fk = dmDbMapHeader(h); if (!fk) continue;
        let val = raw[h] == null ? '' : (raw[h] instanceof Date ? raw[h] : dmWlClean(raw[h]));
        if (val !== '' && val != null) rec[fk] = val;
      }
      rec.testDate = dmDbNormDate(rec.testDate);
      rec.finishDate = dmDbNormDate(rec.finishDate);
      rec.uploadDate = dmDbNormDate(rec.uploadDate);
      rec.status = dmDbNormStatus(rec.status);
      // 资料上传日期与完工/测试日期同步：状态为已完成却未填上传日期时自动回填
      if (String(rec.status).indexOf('完成') >= 0 && !rec.uploadDate) {
        rec.uploadDate = rec.finishDate || rec.testDate || '';
      }
      // 必填：井号
      if (!rec.well) { bad++; skip.push((rec.well || '?') + ' / ' + (rec.tech || '?') + '（缺：井号）'); return; }
      const key = keyOf(rec);
      const ex = exMap.get(key);
      if (ex) {
        updated++; preview.push({ act: '更新', line: rec.well + ' · ' + (rec.tech || '-') + ' · ' + (rec.testDate || '-') });
        if (!dryRun) DB.upsert('dmDbProgress', Object.assign(ex, rec, { src: 'excel' }));
      } else {
        added++; preview.push({ act: '新增', line: rec.well + ' · ' + (rec.tech || '-') + ' · ' + (rec.testDate || '-') });
        if (!dryRun) DB.upsert('dmDbProgress', Object.assign({ id: uid() }, rec, { src: 'excel', mode: 'work' }));
      }
    });
  };

  if (!dryRun) {
    // 批量模式：清空旧台账后统一写入，仅最后 save 一次
    DB.batch(() => {
      const col = DB.col('dmDbProgress');
      DB.data.collections['dmDbProgress'] = col.filter((r) => r.src !== 'excel');
      run(new Map());
    });
  } else {
    const exMap = new Map();
    DB.list('dmDbProgress').forEach((r) => exMap.set(keyOf(r), r));
    run(exMap);
  }
  return { added, updated, bad, preview, skip };
}

function showImg(src) {
  Modal.open('<div style="text-align:center"><img src="' + src + '" style="max-width:100%;border-radius:10px"></div><div class="modal-acts"><button class="btn primary" id="imgClose">关闭</button></div>');
  $('#imgClose').onclick = Modal.close;
}

/* 牛马仪表盘顶部「动态监测核心指标」快捷卡片 */
function dmQuickSection(t, mo) {
  const wl = dmList('dm-workload');
  const ceyaKeys = Object.keys(DB.setting('dmCeyaSummary', {}));
  const ceyaLast = ceyaKeys.length ? DB.setting('dmCeyaSummary', {})[ceyaKeys[ceyaKeys.length - 1]] : null;
  let ceyaRateTxt = '—';
  if (ceyaLast && ceyaLast.areas) { let p = 0, d = 0; ceyaLast.areas.forEach((a) => { p += a.plan; d += a.done; }); ceyaRateTxt = (p ? Math.round(d / p * 100) : 0) + '%'; }
  const todayDone = wl.filter((x) => x.date === t).reduce((s, x) => s + (Number(x.completed) || 0), 0);
  const monthDone = wl.filter((x) => monthStr(x.date) === mo).reduce((s, x) => s + (Number(x.completed) || 0), 0);
  const openIss = dmList('dm-issues').filter((x) => x.status !== '已闭环');
  const urgent = openIss.filter((x) => x.riskLevel === '紧急').length;
  const dbp = dmList('dmDbProgress');
  const pending = dbp.filter((r) => r.testDate && r.testDate !== '1900-01-01' && !r.uploadDate).length;
  return '<div class="card dm-quick"><h3>🛢️ 动态监测核心指标 <span class="more" data-go="dm-report">月报看板 ›</span></h3>'
    + '<div class="grid g4" style="margin-bottom:10px">'
    + statCard('当日完成井次', todayDone + ' 口', '本月累计 ' + monthDone + ' 口')
    + statCard('未闭环问题', openIss.length + ' 项', urgent + ' 项紧急待办')
    + statCard('待上传资料', pending + ' 项', '调配 / 测压 / 报告')
    + statCard('测压完成率', ceyaRateTxt, ceyaLast ? ceyaLast.month + ' 测压计划' : '待导入')
    + '</div>'
    + '<div class="dm-quick-links">'
    + '<span class="chip" data-go="dm-workload">🛢️ 施工量台账</span>'
    + '<span class="chip" data-go="dm-issues">🚨 问题闭环</span>'
    + '<span class="chip" data-go="dm-data">🗄️ 资料管控</span>'
    + '<span class="chip" data-go="dm-ceya-plan">🛢️ 测压计划</span>'
    + '<span class="chip" data-go="dm-report">📋 月报看板</span>'
    + '</div></div>';
}

/* ===== 模块1: 动态监测施工工作量统计台账 ===== */
Views['dm-workload'] = {
  title: '动态监测施工量台账',
  state: { month: monthStr() },
  render(el, self) {
    const m = self.state.month || monthStr();
    const t = todayStr();
    const all = dmList('dm-workload');
    const mRows = dmList('dm-workload', m);
    const sum = (rows, k) => rows.reduce((s, x) => s + (Number(x[k]) || 0), 0);
    const todayDone = sum(all.filter((x) => x.date === t), 'completed');
    const monthDone = sum(mRows, 'completed');
    const year = String(new Date().getFullYear());
    const yearDone = sum(all.filter((x) => x.date && x.date.slice(0, 4) === year), 'completed');
    const contract = sum(mRows, 'contractAmount');
    const plan = DB.setting('dmAnnualPlan', 2400);
    const planRate = plan ? (yearDone / plan * 100).toFixed(1) : '0.0';
    const stOf = dmWlStatusOf;
    const progAll = all.filter((x) => stOf(x) === '进行中').length;
    const failAll = all.filter((x) => stOf(x) === '失败').length;
    const doneAll = all.filter((x) => stOf(x) === '完成').length;
    const unstAll = all.filter((x) => stOf(x) === '未开工').length;
    const over31 = all.filter((x) => stOf(x) === '进行中' && daysBetween(x.date, t) > 31);
    const failRows = all.filter((x) => stOf(x) === '失败');
    const failCnt = {};
    failRows.forEach((x) => (x.failReason || '').split('、').forEach((r) => { if (r) failCnt[r] = (failCnt[r] || 0) + 1; }));
    const topFail = Object.entries(failCnt).sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0] + '×' + e[1]).join('、');
    const byTeam = {}, byTeamC = {}, byAreaCnt = {}, byAreaAmt = {};
    mRows.forEach((x) => {
      byTeam[x.team] = (byTeam[x.team] || 0) + (Number(x.completed) || 0);
      byTeamC[x.team] = (byTeamC[x.team] || 0) + (Number(x.contractAmount) || 0);
      byAreaCnt[x.area] = (byAreaCnt[x.area] || 0) + 1;
      byAreaAmt[x.area] = (byAreaAmt[x.area] || 0) + (Number(x.contractAmount) || 0);
    });
    const pieStatus = [
      { label: '已完成井数', value: doneAll },
      { label: '进行中井数', value: progAll },
      { label: '失败井次', value: failAll },
      { label: '未开工井数', value: unstAll }
    ];
    const pieArea = Object.entries(byAreaCnt).map(([label, value]) => ({ label, value }));
    const areaAmtItems = Object.entries(byAreaAmt).map(([label, v]) => ({ label, value: Math.round(v) }));
    const stalled = DM_TEAMS.filter((tm) => {
      const last = all.filter((x) => x.team === tm).map((x) => x.date).sort().pop();
      return !last || daysBetween(last, t) > 30;
    });
    const over31Box = over31.length ? '<div class="warn-box">⚠️ <b>测试进行中超31天未完井（' + over31.length + '口）：</b><br>' + over31.map((x) => esc((x.wellNo || '—') + '、' + (x.project || '—') + '、' + (x.subTeam || '—') + '、' + x.date + '（已' + daysBetween(x.date, t) + '天）')).join('<br>') + '</div>' : '';
    el.innerHTML = monthToolbar(self.state, 'dm-workload', { extra: '<button class="btn sm" id="impWl">📥 导入Excel</button><button class="btn sm" id="tplWl">📋 模板</button><button class="btn sm" id="expAllWl">导出全部</button><button class="btn sm" id="clrWl">🗑️ 清空台账</button><button class="btn sm" id="setPlan">设年度计划</button><button class="btn sm" id="toLedger">计入合同成本</button><button class="btn sm" id="expXlsWl">导出本月</button>' })
      + '<div class="hint" style="margin:8px 0 14px;font-size:.8rem;color:var(--txt2)">💡 规则：计划日期对应Excel「计划下达时间」（计划下发日）；开始日期对应Excel「开始日期」（实际开工日）；开始日期有值且结束日期为空→测试进行中（超31天警示）；开始/结束日期填「未完成」→测试失败井（失败井次+1，原因抓取备注关键字）；测试项目对应「作业内容」列；井号、测试小队名称一并入库。完成井次取「上井次数」，合同履约金额取「结算金额（元）」。</div>'
      + '<input type="file" id="impFile" accept=".csv,.xls,.xlsx" style="display:none">'
      + '<div class="grid g3" style="margin-bottom:14px">'
      + statCard(m + ' 上井次数', monthDone + ' 口', '当日 ' + todayDone + ' 口')
      + statCard('全年累计完成', yearDone + ' 口', '年度计划完成率 ' + planRate + '%')
      + statCard(m + ' 合同履约', fmtMoney(contract), '可一键计入工作记账')
      + statCard('测试进行中井数', progAll + ' 口', over31.length ? ('⚠️ ' + over31.length + ' 口超31天') : '持续跟踪中')
      + statCard('失败井次', failAll + ' 口', topFail ? ('主因：' + topFail) : '暂无失败记录')
      + '</div>'
      + over31Box
      + (stalled.length ? '<div class="warn-box">⚠️ 停滞预警队伍：' + esc(stalled.join('、')) + '（近30天无施工记录）</div>' : '')
      + '<div class="grid g2" style="margin-bottom:14px">'
      + '<div class="card"><h3>测试状态分布（井数）</h3>' + (pieStatus.some((p) => p.value) ? '<canvas class="chart" id="wlStatusPie"></canvas>' : '<div class="empty">暂无数据</div>') + '</div>'
      + '<div class="card"><h3>各作业区完成数量（井数）</h3>' + (pieArea.length ? '<canvas class="chart" id="wlAreaPie"></canvas>' : '<div class="empty">暂无数据</div>') + '</div>'
      + '<div class="card"><h3>分施工队伍 上井次数（井数）</h3>' + (Object.keys(byTeam).length ? '<canvas class="chart" id="wlTeamBar"></canvas>' : '<div class="empty">暂无数据</div>') + '</div>'
      + '<div class="card"><h3>各作业区合同履约金额（万元）</h3>' + (areaAmtItems.length ? '<canvas class="chart" id="wlAreaAmtBar"></canvas>' : '<div class="empty">暂无数据</div>') + '</div>'
      + '<div class="card"><h3>合同履约金额（按队伍细分，万元）</h3>' + (Object.keys(byTeamC).length ? '<canvas class="chart" id="wlTeamAmtBar"></canvas>' : '<div class="empty">暂无数据</div>') + '</div>'
      + '</div>'
      + tableHTML('dm-workload', all.sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt).slice(0, 300));
    bindMonthToolbar(el, self.state, 'dm-workload');
    bindTableEdit(el);
    if (pieStatus.some((p) => p.value)) Chart2.pie($('#wlStatusPie'), pieStatus, { showValue: true });
    if (pieArea.length) Chart2.pie($('#wlAreaPie'), pieArea, { showValue: true });
    if (Object.keys(byTeam).length) Chart2.bar($('#wlTeamBar'), Object.keys(byTeam), [{ name: '上井次数', data: Object.values(byTeam), color: '#9b6dd6' }], { showValue: true, valueFmt: (v) => v + '口' });
    if (areaAmtItems.length) Chart2.bar($('#wlAreaAmtBar'), areaAmtItems.map((x) => x.label), [{ name: '合同履约金额', data: areaAmtItems.map((x) => x.value / 10000), color: '#c77fd6' }], { showValue: true, valueFmt: (v) => v.toFixed(1) + '万' });
    if (Object.keys(byTeamC).length) Chart2.bar($('#wlTeamAmtBar'), Object.keys(byTeamC), [{ name: '合同履约金额(元)', data: Object.values(byTeamC), color: '#7b5fd6' }], { showValue: true, valueFmt: (v) => (v / 10000).toFixed(1) + '万' });
    $('#setPlan', el).onclick = () => {
      const v = prompt('设置年度计划完成井次目标', plan);
      if (v && Number(v) > 0) { DB.setSetting('dmAnnualPlan', Number(v)); toast('年度计划已设为 ' + Number(v) + ' 口'); App.rerender(); }
    };
    $('#clrWl', el).onclick = () => {
      if (!confirm('⚠️ 确认清空「动态监测施工量台账」所有记录？此操作不可恢复，请先导出备份。')) return;
      DB.data.collections['dm-workload'] = [];
      DB.save();
      toast('已清空施工量台账');
      App.rerender();
    };
    $('#toLedger', el).onclick = () => {
      const amt = sum(mRows, 'contractAmount');
      if (!amt) return toast('本月无合同履约金额', 'err');
      const lid = 'dm-contract-' + m;
      DB.upsert('ledger', { id: lid, date: m + '-01', type: '支出', amount: amt, category: '合同履约', account: '合同成本', note: '动态监测 ' + m + ' 合同履约汇总（' + mRows.length + '条施工记录）', mode: 'work' });
      toast('已计入工作记账·合同履约 ' + fmtMoney(amt));
      App.rerender();
    };
    $('#expXlsWl', el).onclick = () => {
      const heads = ['计划日期', '开始日期', '井号', '测试项目/作业内容', '作业区', '施工队伍', '测试小队名称', '上井次数', '结束日期', '失败井次', '失败原因', '合同履约金额(元)', '测试状态', '备注'];
      const rows = mRows.map((r) => [r.planDate, r.date, r.wellNo, r.project, r.area, r.team, r.subTeam, r.completed, r.endDate, r.failed, r.failReason, r.contractAmount, r.status, r.note]);
      Exporter.xls('动态监测施工量_' + m + '.xls', heads, rows);
    };
    $('#expAllWl', el).onclick = () => {
      const heads = ['计划日期', '开始日期', '井号', '测试项目/作业内容', '作业区', '施工队伍', '测试小队名称', '上井次数', '结束日期', '失败井次', '失败原因', '合同履约金额(元)', '测试状态', '备注', '数据来源'];
      const rows = all.map((r) => [r.planDate, r.date, r.wellNo, r.project, r.area, r.team, r.subTeam, r.completed, r.endDate, r.failed, r.failReason, r.contractAmount, r.status, r.note, r.src === 'excel' ? 'Excel导入' : '手机录入']);
      Exporter.xls('动态监测施工量_全部(' + (all.length) + '条).xls', heads, rows);
      toast('已导出全部 ' + all.length + ' 条（含手机与Excel数据）');
    };
    $('#tplWl', el).onclick = () => {
      const heads = ['计划日期', '开始日期', '结束日期', '井号', '测试项目/作业内容', '作业区', '施工队伍(技术服务公司)', '测试小队名称', '上井次数', '失败井次', '失败原因', '合同履约金额(元)', '测试状态', '备注'];
      const sample = [todayStr(), '', '', '元78-4', '40臂+磁测+井温', '安边', '中油测井', 'C2551', 2, 0, '', 0, '完成', '示例行,请删除后填入真实数据'];
      Exporter.xls('动态监测施工量_导入模板.xls', heads, [sample]);
    };
    $('#impWl', el).onclick = () => $('#impFile', el).click();
    $('#impFile', el).onchange = (e) => {
      const file = e.target.files[0]; if (!file) return;
      const fname = file.name;
      toast('正在解析 ' + fname + ' …');
      ExcelImport.parse(file, (err, rows) => {
        e.target.value = '';
        if (err) {
          if (err.message === 'SheetJS') toast('无法加载Excel解析库（需联网），请将文件另存为 CSV 后导入', 'err');
          else if (err.message === 'format') toast('仅支持 .csv / .xls / .xlsx 文件', 'err');
          else if (err.message === 'empty') toast('文件为空，无数据行', 'err');
          else toast('解析失败: ' + err.message, 'err');
          return;
        }
        const r = importDmWorkload(rows, true);
        if (!r.added && !r.updated && !r.bad) { toast('未识别到可导入的数据行', 'err'); return; }
        const detail = (r.preview.length ? r.preview.slice(0, 15).map((p) => '<div class="imp-row"><span class="tag ' + (p.act === '新增' ? 't-add' : 't-upd') + '">' + p.act + '</span> ' + esc(p.line) + '</div>').join('') : '<div class="empty">无明细</div>')
          + (r.preview.length > 15 ? '<div class="muted small" style="margin-top:4px">… 还有 ' + (r.preview.length - 15) + ' 条未列出</div>' : '');
        const skipBox = r.skip.length ? '<div class="warn-box" style="margin-top:10px"><b>将跳过的行（缺必填字段）：</b><br>' + r.skip.map(esc).join('<br>') + '</div>' : '';
        const failBox = r.unknownFail.length ? '<div class="hint" style="margin-top:8px;font-size:.8rem;color:var(--txt2)">⚠️ 以下失败原因不在预设列表，将按自定义文本保留：' + esc(r.unknownFail.join('、')) + '</div>' : '';
        Modal.open('<h3>导入预览 · ' + esc(fname) + '</h3>'
          + '<div class="grid g3" style="margin:10px 0">'
          + statCard('将新增', r.added + ' 条', 'Excel 中尚无记录')
          + statCard('将更新', r.updated + ' 条', '覆盖同名 Excel 记录')
          + statCard('将跳过', r.bad + ' 条', '缺日期/项目/作业区/队伍')
          + '</div>'
          + '<div class="imp-detail">' + detail + '</div>' + skipBox + failBox
          + '<div class="modal-acts"><button class="btn" id="impCancel">取消</button><button class="btn primary" id="impConfirm">确认导入 ' + (r.added + r.updated) + ' 条</button></div>');
        $('#impCancel').onclick = Modal.close;
        $('#impConfirm').onclick = () => {
          const rr = importDmWorkload(rows, false);
          Modal.close();
          toast('导入完成 ✅ 新增 ' + rr.added + ' 条 · 更新 ' + rr.updated + ' 条' + (rr.bad ? ' · 跳过 ' + rr.bad + ' 条' : ''));
          App.rerender();
        };
      });
    };
  }
};

/* ===== 动态监测·质量统计表(表1-4) 导入 ===== */
function dmIssFindHeader(aoa, tokens) {
  let best = -1, bestN = 0;
  aoa.forEach((row, i) => {
    const cells = row.map((c) => String(c == null ? '' : c).trim());
    let n = 0; tokens.forEach((t) => { if (cells.some((c) => c.indexOf(t) >= 0)) n++; });
    if (n > bestN) { bestN = n; best = i; }
  });
  return best >= 0 && bestN >= Math.ceil(tokens.length / 2) ? best : -1;
}
function dmIssSheetType(sh) {
  const nm = sh.name || '';
  const flat = (sh.aoa || []).flat().map((c) => String(c == null ? '' : c)).join(' ');
  if (nm.indexOf('质量问题清单') >= 0 || (flat.indexOf('检查日期') >= 0 && flat.indexOf('问题描述') >= 0)) return 't2';
  if (nm.indexOf('典型问题') >= 0 || (flat.indexOf('被处理单位') >= 0 && flat.indexOf('典型问题描述') >= 0)) return 't3';
  if (nm.indexOf('质量情况统计') >= 0 || flat.indexOf('发现质量问题') >= 0) return 't1';
  if (nm.indexOf('新闻稿件') >= 0 || flat.indexOf('新闻稿件') >= 0 || flat.indexOf('稿件') >= 0) return 't4';
  return null;
}
function dmIssFindDates(aoa) {
  let month = '', full = '';
  aoa.forEach((row) => row.forEach((c) => {
    const s = String(c == null ? '' : c);
    const m = s.match(/时间[:：]\s*(\d{4})\.(\d{1,2})/);
    if (m) { const mm = m[1] + '-' + String(m[2]).padStart(2, '0'); if (!month) month = mm; }
    const m2 = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (m2) { const mm = m2[1] + '-' + String(m2[2]).padStart(2, '0'); if (!month) month = mm; if (!full) full = mm + '-' + String(m2[3]).padStart(2, '0'); }
  }));
  return { month, full };
}
function dmIssMapStatus(s) {
  s = String(s || '').trim();
  if (s.indexOf('已整改') >= 0 || s.indexOf('已闭环') >= 0 || s.indexOf('完成') >= 0) return '已闭环';
  if (s.indexOf('整改中') >= 0 || s.indexOf('正在') >= 0) return '整改中';
  if (s.indexOf('复测') >= 0) return '要求复测';
  if (s.indexOf('未整改') >= 0 || s.indexOf('未') >= 0) return '未整改';
  return s || '未整改';
}
function dmIssParseTable1(aoa) {
  let sumRow = null;
  aoa.forEach((row) => {
    if (String(row[0] == null ? '' : row[0]).indexOf('合计') >= 0) sumRow = row;
  });
  // 表头跨两行(序号/三商/发现质量问题 与 约谈/扣罚款/典型问题 分两行)，全表扫描列位置最稳妥
  const idxOfAll = (t) => { for (const row of aoa) { const j = row.findIndex((c) => String(c == null ? '' : c).indexOf(t) >= 0); if (j >= 0) return j; } return -1; };
  const iThree = idxOfAll('三商'), iFound = idxOfAll('发现质量问题'), iPenalty = idxOfAll('扣罚款'), iTypical = idxOfAll('典型问题');
  const src = sumRow || aoa.find((r) => r.some((c) => String(c == null ? '' : c).indexOf('井筒工程') >= 0)) || [];
  const num = (col) => { if (!src || col < 0) return 0; const v = src[col]; if (v == null || v === '' || String(v).indexOf('合计') >= 0) return 0; const n = parseFloat(String(v).replace(/[^\d.\-]/g, '')); return isNaN(n) ? 0 : n; };
  return { threeBiz: num(iThree), foundIssues: num(iFound), penalty: num(iPenalty), typical: num(iTypical), handledUnits: 0 };
}
function dmIssParseTable2(aoa) {
  const hr = dmIssFindHeader(aoa, ['检查日期', '检查单位', '业务类别', '工程名称', '责任单位', '问题描述', '质量问题类别', '问题整改情况', '落实人']);
  if (hr < 0) return [];
  const head = aoa[hr].map((c) => String(c == null ? '' : c).trim());
  const idx = (t) => head.findIndex((h) => h.indexOf(t) >= 0);
  const iDate = idx('检查日期'), iUnit = idx('检查单位'), iBiz = idx('业务类别'), iProj = idx('工程名称'), iResp = idx('责任单位'), iTitle = idx('问题描述'), iQc = idx('质量问题类别'), iFix = idx('问题整改情况'), iOwner = idx('落实人'), iNote = idx('备注');
  const recs = [];
  for (let i = hr + 1; i < aoa.length; i++) {
    const row = aoa[i];
    const g = (col) => (col < 0 ? '' : String(row[col] == null ? '' : row[col]).trim());
    const title = g(iTitle);
    if (!title) continue;
    recs.push({
      date: dmWlNormDate(g(iDate)), checkUnit: g(iUnit), biz: g(iBiz), project: g(iProj),
      team: g(iResp), title: title, qualityCat: g(iQc), status: dmIssMapStatus(g(iFix)),
      owner: g(iOwner), note: g(iNote), source: '质量问题清单'
    });
  }
  return recs;
}
function dmIssParseTable3(aoa, reportDate) {
  const hr = dmIssFindHeader(aoa, ['业务类别', '被处理单位', '典型问题类别', '典型问题描述', '原因分析', '问责及处理']);
  if (hr < 0) return [];
  const head = aoa[hr].map((c) => String(c == null ? '' : c).trim());
  const idx = (t) => head.findIndex((h) => h.indexOf(t) >= 0);
  const iBiz = idx('业务类别'), iResp = idx('被处理单位'), iQc = idx('典型问题类别'), iTitle = idx('典型问题描述'), iReason = idx('原因分析'), iHandle = idx('问责及处理'), iNote = idx('备注');
  const recs = [];
  for (let i = hr + 1; i < aoa.length; i++) {
    const row = aoa[i];
    const g = (col) => (col < 0 ? '' : String(row[col] == null ? '' : row[col]).trim());
    const title = g(iTitle);
    if (!title) continue;
    const handle = g(iHandle);
    recs.push({
      date: reportDate || '', biz: g(iBiz), team: g(iResp), qualityCat: g(iQc), title: title,
      rectifyNote: handle, note: (g(iReason) ? g(iReason) + '；' : '') + g(iNote),
      status: handle ? '已闭环' : '未整改', source: '典型问题清单'
    });
  }
  return recs;
}
function dmIssParseTable4(aoa) {
  const out = [];
  aoa.forEach((row) => {
    const a = row[0], b = row[1];
    if (typeof a === 'number' && b != null && String(b).trim().length >= 4) {
      const s = String(b).trim();
      if (s.indexOf('数量') < 0 && s.indexOf('详细名称') < 0) out.push(s);
    }
  });
  return out;
}
function importDmIssues(sheets, dryRun) {
  let t1 = null, t2 = null, t3 = null, t4 = null, month = '', reportDate = '';
  sheets.forEach((sh) => {
    const d = dmIssFindDates(sh.aoa);
    if (d.month && !month) month = d.month;
    if (d.full && !reportDate) reportDate = d.full;
    const type = dmIssSheetType(sh);
    if (type === 't1') t1 = sh.aoa; else if (type === 't2') t2 = sh.aoa; else if (type === 't3') t3 = sh.aoa; else if (type === 't4') t4 = sh.aoa;
  });
  const summary = t1 ? Object.assign({ month: month }, dmIssParseTable1(t1)) : null;
  const news = t4 ? dmIssParseTable4(t4) : [];
  const recs = [];
  if (t2) dmIssParseTable2(t2).forEach((r) => recs.push(r));
  if (t3) dmIssParseTable3(t3, reportDate).forEach((r) => recs.push(r));
  const seen = new Set(); const uniq = [];
  recs.forEach((r) => { const k = [r.source, r.date, r.title, r.team, r.project].join('|'); if (!seen.has(k)) { seen.add(k); uniq.push(r); } });
  const preview = [], skip = [];
  let bad = 0;
  uniq.forEach((r) => {
    if (!r.title) { bad++; skip.push('缺问题描述'); return; }
    const tag = r.source === '典型问题清单' ? '（典型）' : '（清单）';
    preview.push({ act: '新增', line: (r.date || '-') + ' · ' + (r.biz || '-') + ' · ' + r.title.slice(0, 24) + tag });
  });
  const added = uniq.length;
  if (!dryRun) {
    const impMonth = month || '未知月';
    DB.batch(() => {
      dmList('dm-issues').filter((x) => x.src === 'excel' && (impMonth === '未知月' || x.impMonth === impMonth)).forEach((x) => DB.remove('dm-issues', x.id));
      uniq.forEach((r) => DB.upsert('dm-issues', Object.assign({ id: uid(), src: 'excel', mode: 'work', impMonth: impMonth }, r)));
      const sum = DB.setting('dmQSummary', {}); sum[impMonth] = summary || { month: impMonth, foundIssues: 0, threeBiz: 0, penalty: 0, typical: 0 };
      DB.setSetting('dmQSummary', sum);
      const nw = DB.setting('dmNews', {}); nw[impMonth] = news; DB.setSetting('dmNews', nw);
    });
  }
  return { added, updated: 0, bad, preview, skip, summary, news, t2Count: t2 ? dmIssParseTable2(t2).length : 0, t3Count: t3 ? dmIssParseTable3(t3, reportDate).length : 0, month };
}

/* ===== 测压项目类别（用于从施工量台账自动筛选） ===== */
const CEYA_KEYWORDS = [
  '不停井分层测压', '点测', '二流量试井', '其他测油水井测压',
  '提泵测压', '尾管测试', '注水井压降', '压力恢复', '不稳定试井',
  '流压测试', '静压测试', '分层测压', '系统试井'
];
/** 从 dm-workload 中筛选当月测压类项目 */
function ceyaFromWorkload(month) {
  const m = month || monthStr();
  const all = dmList('dm-workload');
  return all.filter((r) => {
    if (monthStr(r.date) !== m) return false;
    const proj = (r.project || '').trim();
    if (!proj) return false;
    return CEYA_KEYWORDS.some((kw) => proj.indexOf(kw) >= 0);
  });
}
/** 将 workload 记录转换为 dmCeyaPlan 格式 */
function ceyaConvertWl(wl) {
  return {
    well: wl.wellNo || '',
    category: '开发试井',
    monitorItem: wl.project || '',
    workContent: wl.project || '',
    company: wl.team || '',
    team: wl.subTeam || '',
    planDate: wl.planDate || '',
    startDate: wl.date || '',
    endDate: wl.endDate || '',
    trips: Number(wl.completed) || 0,
    emptyRuns: 0,
    wellType: '',
    area: wl.area || '',
    block: '',
    note: (wl.status || '') + (wl.note ? ' · ' + wl.note : ''),
    source: '施工量台账同步'
  };
}

/* ===== 测压计划完成情况统计表(完成情况统计 + 明细) 导入 ===== */
function ceyaPlanFindMonth(aoa) {
  for (const row of aoa.slice(0, 4)) {
    for (const c of row) {
      const s = String(c == null ? '' : c);
      const m = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
      if (m) return m[1] + '-' + String(m[2]).padStart(2, '0');
      const m2 = s.match(/(\d{4})\.(\d{1,2})/);
      if (m2) return m2[1] + '-' + String(m2[2]).padStart(2, '0');
    }
  }
  for (const row of aoa) {
    for (const c of row) {
      const s = String(c == null ? '' : c);
      const mm = s.match(/(\d{1,2})\s*月/);
      if (mm) return new Date().getFullYear() + '-' + String(mm[1]).padStart(2, '0');
    }
  }
  return '';
}
function ceyaPlanSheetType(sh) {
  const nm = (sh.name || '').toLowerCase();
  if (nm.indexOf('完成情况') >= 0) return 'summary';
  if (nm.indexOf('明细') >= 0) return 'detail';
  const txt = sh.aoa.slice(0, 8).map((r) => r.join(' ')).join(' ');
  if (txt.indexOf('月度计划') >= 0 && txt.indexOf('月度完成') >= 0) return 'summary';
  if (txt.indexOf('井号') >= 0 && txt.indexOf('测试小队名称') >= 0) return 'detail';
  return null;
}
function ceyaPlanParseSummary(aoa) {
  let hr = -1;
  aoa.forEach((row, i) => { if (String(row[1] == null ? '' : row[1]).indexOf('单位') >= 0 && row.some((c) => String(c == null ? '' : c).indexOf('月度计划') >= 0)) hr = i; });
  if (hr < 0) return [];
  const rows = [];
  for (let i = hr + 1; i < aoa.length; i++) {
    const row = aoa[i];
    const area = String(row[1] == null ? '' : row[1]).trim();
    if (!area || area.indexOf('单位') >= 0) continue;
    const num = (c) => { const v = row[c]; if (v == null || v === '') return 0; const n = parseFloat(String(v).replace(/[^\d.\-]/g, '')); return isNaN(n) ? 0 : n; };
    rows.push({ area: area, plan: num(2), done: num(3), oilPlan: num(4), oilDone: num(5), waterPlan: num(6), waterDone: num(7), note: String(row[8] == null ? '' : row[8]).trim() });
  }
  return rows;
}
function ceyaPlanParseDetail(aoa) {
  let hr = -1;
  aoa.forEach((row, i) => { if (row.some((c) => String(c == null ? '' : c).indexOf('井号') >= 0) && row.some((c) => String(c == null ? '' : c).indexOf('测试小队名称') >= 0)) hr = i; });
  if (hr < 0) return [];
  const head = aoa[hr].map((c) => String(c == null ? '' : c).trim());
  const idx = (t) => head.findIndex((h) => h.indexOf(t) >= 0);
  const iWell = idx('井号'), iCat = idx('类别'), iMon = idx('监测项目'), iWork = idx('作业内容'), iComp = idx('技术服务公司'), iTeam = idx('测试小队名称'), iPlan = idx('计划下达时间'), iStart = idx('开始日期'), iEnd = idx('结束日期'), iTrips = idx('上井次数'), iEmpty = idx('空跑次数'), iNote = idx('备注'), iWellType = idx('井别'), iArea = idx('作业区'), iBlock = idx('区块');
  const num = (s) => { s = String(s == null ? '' : s).trim(); return s ? (parseFloat(s.replace(/[^\d.\-]/g, '')) || 0) : 0; };
  const recs = [];
  for (let i = hr + 1; i < aoa.length; i++) {
    const row = aoa[i];
    const g = (c) => (c < 0 ? '' : String(row[c] == null ? '' : row[c]).trim());
    const well = g(iWell);
    if (!well) continue;
    recs.push({
      well: well, category: g(iCat), monitorItem: g(iMon), workContent: g(iWork),
      company: g(iComp), team: g(iTeam),
      planDate: dmWlNormDate(g(iPlan)), startDate: dmWlNormDate(g(iStart)), endDate: dmWlNormDate(g(iEnd)),
      trips: num(g(iTrips)), emptyRuns: num(g(iEmpty)), wellType: g(iWellType), area: g(iArea), block: g(iBlock), note: g(iNote),
      source: '测压计划明细'
    });
  }
  return recs;
}
function importCeyaPlan(sheets, dryRun) {
  let sSheet = null, dSheet = null, month = '';
  sheets.forEach((sh) => {
    const mt = ceyaPlanFindMonth(sh.aoa); if (mt && !month) month = mt;
    const t = ceyaPlanSheetType(sh);
    if (t === 'summary') sSheet = sh.aoa; else if (t === 'detail') dSheet = sh.aoa;
  });
  const summary = sSheet ? ceyaPlanParseSummary(sSheet) : [];
  const detail = dSheet ? ceyaPlanParseDetail(dSheet) : [];
  const impMonth = month || '未知月';
  const preview = [], skip = [];
  detail.forEach((r) => { if (!r.well) { skip.push('缺井号'); return; } preview.push({ act: '新增', line: r.well + ' · ' + (r.workContent || '-') + ' · ' + (r.area || '-') }); });
  const added = detail.length;
  if (!dryRun) {
    DB.batch(() => {
      dmList('dmCeyaPlan').filter((x) => x.src === 'excel' && (impMonth === '未知月' || x.impMonth === impMonth)).forEach((x) => DB.remove('dmCeyaPlan', x.id));
      detail.forEach((r) => { if (!r.well) return; DB.upsert('dmCeyaPlan', Object.assign({ id: uid(), src: 'excel', mode: 'work', impMonth: impMonth }, r)); });
      const sum = DB.setting('dmCeyaSummary', {}); sum[impMonth] = { month: impMonth, areas: summary }; DB.setSetting('dmCeyaSummary', sum);
    });
  }
  return { added, bad: skip.length, preview, skip, summary, detailCount: detail.length, areaCount: summary.length, month: impMonth };
}

/* ===== 模块2: 动态监测问题闭环台账 ===== */
Views['dm-issues'] = {
  title: '动态监测问题闭环',
  state: { month: '', area: '', team: '', risk: '' },
  render(el, self) {
    const t = todayStr();
    let rows = dmList('dm-issues');
    if (self.state.month) rows = rows.filter((x) => monthStr(x.date) === self.state.month);
    if (self.state.area) rows = rows.filter((x) => x.area === self.state.area);
    if (self.state.team) rows = rows.filter((x) => x.team === self.state.team);
    if (self.state.risk) rows = rows.filter((x) => x.riskLevel === self.state.risk);
    const open = rows.filter((x) => x.status !== '已闭环');
    const urgent = open.filter((x) => x.riskLevel === '紧急').length;
    const monthNew = dmList('dm-issues').filter((x) => monthStr(x.date) === monthStr()).length;
    const closed = rows.filter((x) => x.status === '已闭环').length;
    const byCat = {};
    rows.forEach((x) => { const k = x.biz || x.category || '未分类'; byCat[k] = (byCat[k] || 0) + 1; });
    const pieCat = Object.entries(byCat).map(([label, value]) => ({ label, value }));
    const qMonth = self.state.month || monthStr();
    const qSum = DB.setting('dmQSummary', {})[qMonth] || null;
    const qNews = DB.setting('dmNews', {})[qMonth] || [];
    const teams = Array.from(new Set([...DM_TEAMS, ...rows.map((r) => r.team).filter(Boolean)])).sort();
    const optHtml = (arr, cur, allLabel) => '<option value="">' + allLabel + '</option>' + arr.map((a) => '<option value="' + esc(a) + '"' + (cur === a ? ' selected' : '') + '>' + esc(a) + '</option>').join('');
    el.innerHTML = '<div class="toolbar">'
      + '<input type="month" id="iMonth" value="' + (self.state.month || '') + '" style="width:150px">'
      + '<select id="iArea">' + optHtml(DM_AREAS, self.state.area, '全部作业区') + '</select>'
      + '<select id="iTeam">' + optHtml(teams, self.state.team, '全部责任单位') + '</select>'
      + '<select id="iRisk">' + optHtml(['一般', '重点', '紧急'], self.state.risk, '全部等级') + '</select>'
      + '<span class="sp"></span>'
      + '<button class="btn sm" id="impIss">📥 导入质量统计表</button>'
      + '<input type="file" id="impIssFile" accept=".xlsx,.xls,.csv" style="display:none">'
      + '<button class="btn sm" id="expIss">导出Excel</button>'
      + '<button class="btn primary" id="addIss">＋ 新增问题</button></div>'
      + '<div class="grid g4" style="margin-bottom:14px">'
      + statCard('未闭环问题', open.length + ' 项', urgent + ' 项紧急')
      + statCard('本月新增', monthNew + ' 项', '今日新增 ' + dmList('dm-issues').filter((x) => x.date === t).length)
      + statCard('已闭环', closed + ' 项', '闭环率 ' + (rows.length ? Math.round(closed / rows.length * 100) : 0) + '%')
      + statCard('筛选结果', rows.length + ' 项', '当前筛选条件下')
      + '</div>'
      + (qSum ? '<div class="grid g4" style="margin-bottom:14px">'
          + statCard('发现质量问题', (qSum.foundIssues || 0) + ' 项', (qSum.month || qMonth) + ' 质量统计表')
          + statCard('三商数量', (qSum.threeBiz || 0) + ' 家', '当月正在施工')
          + statCard('扣罚款', (qSum.penalty || 0) + ' 万元', '问责处理')
          + statCard('典型问题', (qSum.typical || 0) + ' 项', '典型质量问题')
          + '</div>'
        : (self.state.month ? '<div class="hint" style="margin:0 0 12px">本期（' + qMonth + '）尚未导入质量统计表，点击「📥 导入质量统计表」同步表1-4数据</div>' : ''))
      + '<div class="grid g2" style="margin-bottom:14px"><div class="card"><h3>问题分布（业务类别）</h3>' + (pieCat.length ? '<canvas class="chart" id="issPie"></canvas>' : '<div class="empty">暂无数据</div>') + '</div>'
      + '<div class="card"><h3>📰 宣传稿件（表4）</h3>' + (qNews.length ? '<div class="news-list">' + qNews.map((n) => '<div class="news-item">📰 ' + esc(n) + '</div>').join('') + '</div>' : '<div class="empty">本期暂无新闻稿件</div>') + '</div></div>'
      + '<div class="table-wrap"><table><thead><tr><th>检查日期</th><th>问题描述</th><th>业务类别</th><th>大类</th><th>细分</th><th>等级</th><th>状态</th><th>来源</th><th>责任单位</th><th>责任人</th><th>整改期限</th><th>照片</th></tr></thead><tbody>'
      + (rows.length ? rows.sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((r) => {
          const riskCls = r.riskLevel === '紧急' ? 'red' : r.riskLevel === '重点' ? 'orange' : 'gray';
          const stCls = r.status === '已闭环' ? 'green' : r.status === '整改中' ? 'blue' : r.status === '要求复测' ? 'orange' : 'red';
          const overdue = r.status !== '已闭环' && r.deadline && daysBetween(t, r.deadline) < 0;
          const dline = r.deadline ? (overdue ? '<span class="tag red">' + r.deadline + ' 逾期</span>' : (daysBetween(t, r.deadline) <= 3 ? '<span class="tag orange">' + r.deadline + '</span>' : r.deadline)) : '—';
          return '<tr class="' + (overdue ? 'row-overdue' : '') + '" data-id="' + r.id + '" data-col="dm-issues">'
            + '<td>' + (r.date || '—') + '</td>'
            + '<td>' + esc(r.title || '').slice(0, 30) + '</td>'
            + '<td>' + esc(r.biz || '') + '</td>'
            + '<td><span class="tag gray">' + esc(r.category || '') + '</span></td>'
            + '<td class="muted small">' + esc(r.subType || '') + '</td>'
            + '<td><span class="tag ' + riskCls + '">' + esc(r.riskLevel || '') + '</span></td>'
            + '<td><span class="tag ' + stCls + '">' + esc(r.status || '') + '</span></td>'
            + '<td class="muted small">' + esc(r.source || '手动') + '</td>'
            + '<td>' + esc(r.team || '—') + '</td>'
            + '<td>' + esc(r.owner || '—') + '</td>'
            + '<td>' + dline + '</td>'
            + '<td>' + (r.photo ? '<img class="thumb" data-img="1" src="' + r.photo + '">' : '<span class="muted">—</span>') + '</td>'
            + '</tr>';
        }).join('') : '<tr><td colspan="12"><div class="empty">暂无问题记录，点击右上「＋ 新增问题」或「📥 导入质量统计表」</div></td></tr>')
      + '</tbody></table></div>';
    $('#iMonth', el).onchange = (e) => { self.state.month = e.target.value; App.rerender(); };
    $('#iArea', el).onchange = (e) => { self.state.area = e.target.value; App.rerender(); };
    $('#iTeam', el).onchange = (e) => { self.state.team = e.target.value; App.rerender(); };
    $('#iRisk', el).onchange = (e) => { self.state.risk = e.target.value; App.rerender(); };
    $('#addIss', el).onclick = () => openForm('dm-issues');
    $('#impIss', el).onclick = () => $('#impIssFile').click();
    $('#impIssFile', el).onchange = (e) => {
      const file = e.target.files[0]; if (!file) return;
      $('#impIssFile').value = '';
      ExcelImport.parseAll(file, (err, sheets) => {
        if (err) { toast('解析失败: ' + (err.message || err), 'err'); return; }
        const r = importDmIssues(sheets, true);
        if (!r.added && !r.news.length && !r.summary) { toast('未识别到质量统计表结构(表1-4)', 'err'); return; }
        const detail = (r.preview.length ? r.preview.slice(0, 15).map((p) => '<div class="imp-row"><span class="tag ' + (p.act === '新增' ? 't-add' : 't-upd') + '">' + p.act + '</span> ' + esc(p.line) + '</div>').join('') : '<div class="empty">无明细</div>')
          + (r.preview.length > 15 ? '<div class="muted small" style="margin-top:4px">… 还有 ' + (r.preview.length - 15) + ' 条未列出</div>' : '');
        const sumBox = r.summary ? '<div class="card" style="margin-top:10px"><h4>📊 本月质量概况（表1）</h4><div class="grid g4">'
          + statCard('发现质量问题', (r.summary.foundIssues || 0) + ' 项', '') + statCard('三商数量', (r.summary.threeBiz || 0) + ' 家', '')
          + statCard('扣罚款', (r.summary.penalty || 0) + ' 万元', '') + statCard('典型问题', (r.summary.typical || 0) + ' 项', '')
          + '</div></div>' : '';
        const newsBox = r.news.length ? '<div class="card" style="margin-top:10px"><h4>📰 宣传稿件（表4，' + r.news.length + ' 篇）</h4><div class="small muted">' + r.news.slice(0, 8).map((n) => '<div>· ' + esc(n) + '</div>').join('') + (r.news.length > 8 ? '<div>… 还有 ' + (r.news.length - 8) + ' 篇</div>' : '') + '</div></div>' : '';
        Modal.open('<h3>📥 质量统计表导入预览</h3>'
          + '<div class="grid g3" style="margin-bottom:12px">' + statCard('问题记录', r.added + ' 条', '表2 ' + r.t2Count + ' + 表3 ' + r.t3Count) + statCard('宣传稿件', r.news.length + ' 篇', '') + statCard('质量概况', r.summary ? '有' : '无', r.month) + '</div>'
          + '<div class="card imp-detail">' + detail + '</div>' + sumBox + newsBox
          + (r.skip.length ? '<div class="card" style="margin-top:10px"><h4>⚠️ 将跳过的行</h4><div class="small muted">' + r.skip.slice(0, 10).map((s) => '<div>' + esc(s) + '</div>').join('') + '</div></div>' : '')
          + '<div class="modal-acts"><button class="btn" id="impIssCancel">取消</button><button class="btn primary" id="impIssConfirm">确认导入 ' + r.added + ' 条问题</button></div>');
        $('#impIssCancel').onclick = Modal.close;
        $('#impIssConfirm').onclick = () => {
          const rr = importDmIssues(sheets, false);
          Modal.close();
          toast('导入完成 ✅ 问题 ' + rr.added + ' 条 · 宣传稿件 ' + rr.news.length + ' 篇' + (rr.summary ? ' · 质量概况已同步' : ''));
          App.rerender();
        };
      });
    };
    bindTableEdit(el);
    $$('[data-img]', el).forEach((img) => img.onclick = (e) => { e.stopPropagation(); showImg(img.src); });
    if (pieCat.length) Chart2.pie($('#issPie'), pieCat);
    const expRows = (set) => {
      const heads = ['检查日期', '问题描述', '业务类别', '质量问题类别', '问题大类', '细分问题', '等级', '状态', '来源', '责任单位', '责任人', '整改期限', '整改/问责记录', '备注/原因分析'];
      Exporter.xls('动态监测问题清单_' + (self.state.month || '全部') + '.xls', heads, set.map((r) => [r.date, r.title, r.biz, r.qualityCat, r.category, r.subType, r.riskLevel, r.status, r.source || '手动', r.team, r.owner, r.deadline, r.rectifyNote, r.note]));
    };
    $('#expIss', el).onclick = () => expRows(rows);
  }
};

/* ===== 模块2.5: 测压计划完成情况 ===== */
Views['dm-ceya-plan'] = {
  title: '测压计划完成情况',
  state: { month: monthStr(), area: '', company: '' },
  render(el, self) {
    const qMonth = self.state.month || monthStr();
    /* 从施工量台账自动筛选当月测压类项目 */
    const wlCeya = ceyaFromWorkload(qMonth);
    const wlCeyaIds = new Set(wlCeya.map((r) => r.id));
    const sumMap = DB.setting('dmCeyaSummary', {});
    const sum = sumMap[qMonth] || null;
    let rows = dmList('dmCeyaPlan').filter((x) => x.impMonth === qMonth || !x.impMonth);
    if (self.state.area) rows = rows.filter((x) => x.area === self.state.area);
    if (self.state.company) rows = rows.filter((x) => (x.company || '').indexOf(self.state.company) >= 0);
    let totalPlan = 0, totalDone = 0, totalOilPlan = 0, totalOilDone = 0, totalWaterPlan = 0, totalWaterDone = 0;
    const areas = (sum && sum.areas) || [];
    areas.forEach((a) => { totalPlan += a.plan; totalDone += a.done; totalOilPlan += a.oilPlan; totalOilDone += a.oilDone; totalWaterPlan += a.waterPlan; totalWaterDone += a.waterDone; });
    const rate = totalPlan ? Math.round(totalDone / totalPlan * 100) : 0;
    const unfinished = Math.max(0, totalPlan - totalDone);
    const companies = Array.from(new Set(rows.map((r) => r.company).filter(Boolean))).sort();
    const areaOpts = Array.from(new Set(areas.map((a) => a.area)));
    const optHtml = (arr, cur, allLabel) => '<option value="">' + allLabel + '</option>' + arr.map((a) => '<option value="' + esc(a) + '"' + (cur === a ? ' selected' : '') + '>' + esc(a) + '</option>').join('');
    el.innerHTML = '<div class="toolbar">'
      + '<input type="month" id="cMonth" value="' + qMonth + '" style="width:150px">'
      + '<select id="cArea">' + optHtml(areaOpts, self.state.area, '全部作业区') + '</select>'
      + '<select id="cCompany">' + optHtml(companies, self.state.company, '全部技术服务公司') + '</select>'
      + '<span class="sp"></span>'
      + '<button class="btn sm" id="impCeya">📥 导入测压计划表</button>'
      + '<input type="file" id="impCeyaFile" accept=".xlsx,.xls,.csv" style="display:none">'
      + '<button class="btn sm" id="syncWl">🔗 从施工量台账同步</button>'
      + '<button class="btn sm" id="expCeya">导出Excel</button>'
      + '<button class="btn primary" id="addCeya">＋ 新增井记录</button></div>'
      + '<div class="grid g4" style="margin-bottom:14px">'
      + statCard('全厂月度计划', totalPlan + ' 口', qMonth + ' 测压计划')
      + statCard('全厂月度完成', totalDone + ' 口', '完成 ' + totalDone + ' 口')
      + statCard('完成率', rate + '%', '计划 ' + totalPlan + ' 口')
      + statCard('未完成井次', unfinished + ' 口', unfinished > 0 ? '需考核跟进' : '全部完成')
      + '</div>'
      /* ===== 从施工量台账自动匹配的测压项目 ===== */
      + (wlCeya.length ? '<div class="card" style="margin-bottom:14px;border-left:4px solid #9b59b6"><h3>🔗 施工量台账 · 测压类项目（' + qMonth + '，共 ' + wlCeya.length + ' 口）</h3><div class="muted small" style="margin-bottom:8px">以下为「动态监测施工量台账」中自动筛选的测压类项目（匹配：不停井分层测压/点测/二流量试井/提泵测压/尾管测试/注水井压降等），点击「同步到本模块」可一键导入。</div><div class="table-wrap"><table><thead><tr><th><input type="checkbox" id="wlCeyaAll" checked></th><th>井号</th><th>测试项目/作业内容</th><th>作业区</th><th>施工队伍</th><th>计划日期</th><th>开始日期</th><th>上井次数</th><th>状态</th></tr></thead><tbody>'
        + wlCeya.map((r) => '<tr data-wl-id="' + r.id + '"><td><input type="checkbox" class="wl-cb" data-id="' + r.id + '" checked></td>'
          + '<td>' + esc(r.wellNo || '') + '</td>'
          + '<td>' + esc(r.project || '') + '</td>'
          + '<td>' + esc(r.area || '') + '</td>'
          + '<td class="muted small">' + esc(r.team || '') + '</td>'
          + '<td class="muted small">' + (r.planDate || '—') + '</td>'
          + '<td>' + (r.date || '—') + '</td>'
          + '<td>' + (r.completed || 0) + '</td>'
          + '<td><span class="tag ' + ((r.status === '完成' || !r.status) ? 'green' : (r.status === '进行中' ? 'orange' : 'gray')) + '">' + (r.status || '完成') + '</span></td></tr>').join('')
        + '</tbody></table></div></div>'
        : '<div class="hint" style="margin:0 0 12px">🔗 当月（' + qMonth + '）施工量台账中暂无测压类项目，或尚未导入施工量台账数据。</div>')
      + (sum ? '<div class="card" style="margin-bottom:14px"><h3>📊 按作业区完成情况（' + qMonth + '）</h3><div class="table-wrap"><table><thead><tr><th>作业区</th><th>计划</th><th>完成</th><th>完成率</th><th>采油井(计/完)</th><th>注水(计/完)</th><th>考核备注</th></tr></thead><tbody>'
        + areas.map((a) => {
            const r = a.plan ? Math.round(a.done / a.plan * 100) : 0;
            const cls = a.done < a.plan ? 'red' : (a.done > a.plan ? 'green' : 'gray');
            return '<tr><td>' + esc(a.area) + '</td><td>' + a.plan + '</td><td>' + a.done + '</td>'
              + '<td><span class="tag ' + cls + '">' + r + '%</span></td>'
              + '<td>' + a.oilPlan + ' / ' + a.oilDone + '</td><td>' + a.waterPlan + ' / ' + a.waterDone + '</td>'
              + '<td class="muted small">' + esc(a.note || '') + '</td></tr>';
          }).join('')
        + '</tbody></table></div></div>'
        : (qMonth ? '<div class="hint" style="margin:0 0 12px">本期（' + qMonth + '）尚未导入测压计划完成情况统计表，点击「📥 导入测压计划表」同步完成情况统计 + 明细</div>' : ''))
      + '<div class="card"><h3>🛢️ 测压井明细（' + rows.length + ' 口）</h3><div class="table-wrap"><table><thead><tr><th>井号</th><th>类别</th><th>监测项目</th><th>作业内容</th><th>技术服务公司</th><th>测试小队</th><th>计划下达</th><th>开始</th><th>结束</th><th>上井</th><th>空跑</th><th>井别</th><th>作业区</th><th>区块</th><th>来源</th></tr></thead><tbody>'
      + (rows.length ? rows.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')).map((r) => {
          return '<tr data-id="' + r.id + '" data-col="dmCeyaPlan">'
            + '<td>' + esc(r.well || '') + '</td>'
            + '<td class="muted small">' + esc(r.category || '') + '</td>'
            + '<td class="muted small">' + esc(r.monitorItem || '') + '</td>'
            + '<td>' + esc(r.workContent || '') + '</td>'
            + '<td>' + esc(r.company || '') + '</td>'
            + '<td class="muted small">' + esc(r.team || '') + '</td>'
            + '<td class="muted small">' + (r.planDate || '—') + '</td>'
            + '<td>' + (r.startDate || '—') + '</td>'
            + '<td>' + (r.endDate || '—') + '</td>'
            + '<td>' + (r.trips || 0) + '</td>'
            + '<td>' + (r.emptyRuns || 0) + '</td>'
            + '<td class="muted small">' + esc(r.wellType || '') + '</td>'
            + '<td>' + esc(r.area || '') + '</td>'
            + '<td class="muted small">' + esc(r.block || '') + '</td>'
            + '<td class="muted small">' + esc(r.source || '手动') + '</td>'
            + '</tr>';
        }).join('') : '<tr><td colspan="15"><div class="empty">暂无井记录，点击右上「＋ 新增井记录」或「📥 导入测压计划表」</div></td></tr>')
      + '</tbody></table></div></div>';
    $('#cMonth', el).onchange = (e) => { self.state.month = e.target.value; App.rerender(); };
    $('#cArea', el).onchange = (e) => { self.state.area = e.target.value; App.rerender(); };
    $('#cCompany', el).onchange = (e) => { self.state.company = e.target.value; App.rerender(); };
    $('#addCeya', el).onclick = () => openForm('dmCeyaPlan');
    $('#impCeya', el).onclick = () => $('#impCeyaFile').click();
    $('#impCeyaFile', el).onchange = (e) => {
      const file = e.target.files[0]; if (!file) return;
      $('#impCeyaFile').value = '';
      ExcelImport.parseAll(file, (err, sheets) => {
        if (err) { toast('解析失败: ' + (err.message || err), 'err'); return; }
        const r = importCeyaPlan(sheets, true);
        if (!r.added && !r.areaCount) { toast('未识别到测压计划完成情况表结构', 'err'); return; }
        const detail = (r.preview.length ? r.preview.slice(0, 15).map((p) => '<div class="imp-row"><span class="tag t-add">新增</span> ' + esc(p.line) + '</div>').join('') : '<div class="empty">无明细</div>')
          + (r.preview.length > 15 ? '<div class="muted small" style="margin-top:4px">… 还有 ' + (r.preview.length - 15) + ' 条未列出</div>' : '');
        let sp = 0, sd = 0; if (r.summary && r.summary.length) { r.summary.forEach((a) => { sp += a.plan; sd += a.done; }); }
        const sr = sp ? Math.round(sd / sp * 100) : 0;
        const sumBox = (r.summary && r.summary.length) ? '<div class="card" style="margin-top:10px"><h4>📊 按作业区完成情况（' + r.month + '）</h4><div class="grid g4">'
          + statCard('全厂计划', sp + ' 口', '') + statCard('全厂完成', sd + ' 口', '') + statCard('完成率', sr + '%', '') + statCard('作业区数', r.summary.length + ' 个', '') + '</div></div>' : '';
        Modal.open('<h3>📥 测压计划完成情况导入预览</h3>'
          + '<div class="grid g3" style="margin-bottom:12px">' + statCard('井明细', r.added + ' 条', '') + statCard('作业区汇总', r.areaCount + ' 个', '') + statCard('月份', r.month, '') + '</div>'
          + '<div class="card imp-detail">' + detail + '</div>' + sumBox
          + (r.skip.length ? '<div class="card" style="margin-top:10px"><h4>⚠️ 将跳过的行</h4><div class="small muted">' + r.skip.slice(0, 10).map((s) => '<div>' + esc(s) + '</div>').join('') + '</div></div>' : '')
          + '<div class="modal-acts"><button class="btn" id="impCeyaCancel">取消</button><button class="btn primary" id="impCeyaConfirm">确认导入</button></div>');
        $('#impCeyaCancel').onclick = Modal.close;
        $('#impCeyaConfirm').onclick = () => {
          const rr = importCeyaPlan(sheets, false);
          Modal.close();
          toast('导入完成 ✅ 井明细 ' + rr.added + ' 条 · 作业区汇总 ' + rr.areaCount + ' 个（' + rr.month + '）');
          App.rerender();
        };
      });
    };
    /* 从施工量台账同步测压数据 */
    $('#syncWl', el).onclick = () => {
      const wl = ceyaFromWorkload(qMonth);
      if (!wl.length) { toast('当月（' + qMonth + '）施工量台账中无测压类项目', 'err'); return; }
      const cbs = $$('.wl-cb:checked', el);
      const ids = new Set(cbs.map((cb) => cb.dataset.id));
      const selected = wl.filter((r) => ids.has(r.id));
      if (!selected.length) { toast('请至少勾选一条记录', 'err'); return; }
      Modal.open('<h3>🔗 从施工量台账同步测压数据</h3>'
        + '<div class="grid g3" style="margin-bottom:12px">'
        + statCard('待同步', selected.length + ' 口', qMonth)
        + statCard('匹配总数', wl.length + ' 口', '测压类项目')
        + statCard('目标模块', 'dmCeyaPlan', '井记录')
        + '</div>'
        + '<div class="card imp-detail">' + selected.slice(0, 20).map((r) => '<div class="imp-row"><span class="tag t-add">新增</span> '
          + esc(r.wellNo || '') + ' · ' + esc(r.project || '') + ' · ' + esc(r.area || '') + '</div>').join('')
        + (selected.length > 20 ? '<div class="muted small" style="margin-top:4px">… 还有 ' + (selected.length - 20) + ' 条</div>' : '')
        + '</div>'
        + '<div class="modal-acts"><button class="btn" id="syncWlCancel">取消</button><button class="btn primary" id="syncWlConfirm">确认同步（' + selected.length + ' 条）</button></div>');
      $('#syncWlCancel').onclick = Modal.close;
      $('#syncWlConfirm').onclick = () => {
        let added = 0;
        DB.batch(() => {
          selected.forEach((wlRec) => {
            const rec = ceyaConvertWl(wlRec);
            rec.id = uid();
            rec.src = 'workload-sync';
            rec.impMonth = qMonth;
            DB.upsert('dmCeyaPlan', rec);
            added++;
          });
        });
        Modal.close();
        toast('同步完成 ✅ 已从施工量台账导入 ' + added + ' 条测压项目到本模块（' + qMonth + '）');
        App.rerender();
      };
    };
    /* 全选/取消全选 */
    const wlAllCb = $('#wlCeyaAll', el);
    if (wlAllCb) wlAllCb.onchange = (e) => { $$('.wl-cb', el).forEach((cb) => cb.checked = e.target.checked); };
    bindTableEdit(el);
    const expRows = (set) => {
      const heads = ['井号', '类别', '监测项目', '作业内容', '技术服务公司', '测试小队名称', '计划下达时间', '开始日期', '结束日期', '上井次数', '空跑次数', '井别', '作业区', '区块', '备注', '来源'];
      Exporter.xls('测压计划井明细_' + qMonth + '.xls', heads, set.map((r) => [r.well, r.category, r.monitorItem, r.workContent, r.company, r.team, r.planDate, r.startDate, r.endDate, r.trips, r.emptyRuns, r.wellType, r.area, r.block, r.note, r.source || '手动']));
    };
    $('#expCeya', el).onclick = () => expRows(rows);
  }
};

/* ===== 模块3: 动态监测系统资料录入管控 ===== */
function dmDataView(colKey, opts) {
  opts = opts || {};
  return {
    state: { month: '' },
    render(el, self) {
      const t = todayStr();
      let rows = dmList(colKey, self.state.month || null).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || b.updatedAt - a.updatedAt);
      if (opts.decorate) rows = opts.decorate(rows, t);
      const heads = opts.heads || SCHEMAS[colKey].cols;
      const labelOf = (k) => (opts.headLabels && opts.headLabels[k]) || ((SCHEMAS[colKey].fields.find((x) => x.k === k) || {}).l) || k;
      el.innerHTML = monthToolbar(self.state, colKey, { extra: '<button class="btn sm" id="expXlsD">导出Excel</button>' + (opts.extra || '') })
        + (opts.top ? opts.top(dmList(colKey, self.state.month || null), t) : '')
        + '<div class="table-wrap"><table><thead><tr>' + heads.map((k) => '<th>' + labelOf(k) + '</th>').join('') + '</tr></thead><tbody>'
        + (rows.length ? rows.map((r) => {
            const cls = opts.rowClass ? opts.rowClass(r, t) : '';
            return '<tr class="' + cls + '" data-id="' + r.id + '" data-col="' + colKey + '">' + heads.map((k) => {
              let v = r[k];
              if (k === 'uploaded') v = v ? '<span class="tag green">已上传</span>' : '<span class="tag red">待上传</span>';
              else if (k === 'photo') v = v ? '<img class="thumb" data-img="1" src="' + v + '">' : '<span class="muted">—</span>';
              else if (typeof v === 'boolean') v = v ? '<span class="tag green">是</span>' : '<span class="tag gray">否</span>';
              else if (k === 'days' || k === 'leftDays') v = (v == null ? '—' : (v + ' 天'));
              else v = esc(v == null ? '' : String(v)).slice(0, 60);
              return '<td>' + (v === '' ? '<span class="muted">—</span>' : v) + '</td>';
            }).join('') + '</tr>';
          }).join('') : '<tr><td colspan="' + heads.length + '"><div class="empty">暂无数据，点击右上「新增」开始记录</div></td></tr>')
        + '</tbody></table></div>';
      bindMonthToolbar(el, self.state, colKey);
      bindTableEdit(el);
      $$('[data-img]', el).forEach((img) => img.onclick = (e) => { e.stopPropagation(); showImg(img.src); });
      const ex = $('#expXlsD', el);
      if (ex) ex.onclick = () => Exporter.xls(SCHEMAS[colKey].title + '_' + (self.state.month || '全部') + '.xls', heads.map(labelOf), rows.map((r) => heads.map((k) => r[k] == null ? '' : r[k])));
    }
  };
}
/* 数据库进度明细台账（支持 Excel 导入） */
const dmDbProgressView = {
  state: { month: '' },
  render(el, self) {
    const t = todayStr();
    const all = dmList('dmDbProgress');
    let rows = all.slice();
    if (self.state.month) rows = rows.filter((r) => r.testDate && monthStr(r.testDate) === self.state.month);
    rows.sort((a, b) => String(b.testDate || '').localeCompare(String(a.testDate || '')) || b.updatedAt - a.updatedAt);

    // 统计
    const total = all.length;
    const done = all.filter((r) => dmDbEffectiveUploadDate(r)).length;
    const fail = all.filter((r) => String(r.status).indexOf('失败') >= 0).length;
    const pending = all.filter((r) => r.testDate && r.testDate !== '1900-01-01' && !dmDbEffectiveUploadDate(r)).length;
    const rate = total ? Math.round(done / total * 100) : 0;

    const sc = SCHEMAS['dmDbProgress'];
    const heads = sc.cols;
    const labelOf = (k) => ((sc.fields.find((x) => x.k === k) || {}).l) || k;

    el.innerHTML = '<div class="toolbar">'
      + '<input type="month" id="mFilter" value="' + (self.state.month || monthStr()) + '" style="width:150px">'
      + '<button class="btn sm" id="mAll">' + (self.state.month ? '查看全部' : '按月筛选中✕') + '</button>'
      + '<button class="btn sm" id="impDb">📥 导入Excel</button>'
      + '<input type="file" id="impDbFile" accept=".xlsx,.xls,.csv" style="display:none">'
      + '<span class="sp"></span>'
      + '<button class="btn sm" id="expDb">导出CSV</button>'
      + '<button class="btn primary" id="addDb">＋ 新增</button>'
      + '</div>'
      + '<div class="grid g5" style="margin-bottom:14px">'
      + statCard('库内总进展', total + ' 条', '当前筛选月' + (self.state.month ? ' ' + self.state.month : '全部'))
      + statCard('已完成资料录入测试井', done + ' 口', '已有资料上传日期')
      + statCard('测试失败井', fail + ' 口', '当前状态为失败')
      + statCard('待录入资料测试井', pending + ' 口', '已测试未上传资料')
      + statCard('录入进度', rate + '%', '完成/总进展')
      + '</div>'
      + '<div class="table-wrap"><table><thead><tr>' + heads.map((k) => '<th>' + labelOf(k) + '</th>').join('') + '</tr></thead><tbody>'
      + (rows.length ? rows.map((r) => {
          return '<tr data-id="' + r.id + '" data-col="dmDbProgress">' + heads.map((k) => {
            let v = r[k];
            if (k === 'status') {
              const cls = v === '已完成' ? 'green' : v === '正在进行' ? 'blue' : v === '失败' ? 'red' : 'gray';
              v = '<span class="tag ' + cls + '">' + esc(v || '') + '</span>';
            } else if (k === 'uploadDate') {
              const eff = dmDbEffectiveUploadDate(r);
              v = eff ? '<span class="tag green">' + esc(eff) + '</span>' : '<span class="tag red">待录入</span>';
            } else v = esc(v == null ? '' : String(v)).slice(0, 60);
            return '<td>' + (v === '' ? '<span class="muted">—</span>' : v) + '</td>';
          }).join('') + '</tr>';
        }).join('') : '<tr><td colspan="' + heads.length + '"><div class="empty">暂无数据，点击「导入Excel」或右上「新增」开始记录</div></td></tr>')
      + '</tbody></table></div>';

    // 事件绑定
    const mf = $('#mFilter', el);
    if (mf) mf.onchange = () => { self.state.month = mf.value; App.rerender(); };
    const ma = $('#mAll', el);
    if (ma) ma.onclick = () => { self.state.month = self.state.month ? '' : monthStr(); App.rerender(); };
    const ab = $('#addDb', el);
    if (ab) ab.onclick = () => openForm('dmDbProgress');
    const ex = $('#expDb', el);
    if (ex) ex.onclick = () => {
      Exporter.csv('数据库进度_' + (self.state.month || '全部') + '.csv',
        heads.map(labelOf), rows.map((r) => heads.map((k) => r[k] == null ? '' : r[k])));
    };
    bindTableEdit(el);

    const impBtn = $('#impDb', el);
    const impFile = $('#impDbFile', el);
    if (impBtn && impFile) {
      impBtn.onclick = () => impFile.click();
      impFile.onchange = (ev) => {
        const file = ev.target.files[0]; if (!file) return;
        ExcelImport.parse(file, (err, rows) => {
          impFile.value = '';
          if (err) { toast('解析失败: ' + (err.message || err), 'err'); return; }
          const r = importDbProgress(rows, true);
          if (!r.added && !r.updated && !r.bad) { toast('未识别到可导入的数据行', 'err'); return; }
          const detail = (r.preview.length ? r.preview.slice(0, 15).map((p) => '<div class="imp-row"><span class="tag ' + (p.act === '新增' ? 't-add' : 't-upd') + '">' + p.act + '</span> ' + esc(p.line) + '</div>').join('') : '<div class="empty">无明细</div>')
            + (r.preview.length > 15 ? '<div class="muted small" style="margin-top:4px">… 还有 ' + (r.preview.length - 15) + ' 条未列出</div>' : '');
          Modal.open('<h3>📥 数据库进度导入预览</h3>'
            + '<div class="grid g3" style="margin-bottom:12px">' + statCard('将新增', r.added + ' 条', '') + statCard('将更新', r.updated + ' 条', '') + statCard('将跳过', r.bad + ' 条', '') + '</div>'
            + '<div class="card imp-detail">' + detail + '</div>'
            + (r.skip.length ? '<div class="card" style="margin-top:10px"><h4>⚠️ 将跳过的行</h4><div class="small muted">' + r.skip.slice(0, 10).map((s) => '<div>' + esc(s) + '</div>').join('') + (r.skip.length > 10 ? '<div>… 还有 ' + (r.skip.length - 10) + ' 条</div>' : '') + '</div></div>' : '')
            + '<div class="modal-acts"><button class="btn" id="impDbCancel">取消</button><button class="btn primary" id="impDbConfirm">确认导入 ' + (r.added + r.updated) + ' 条</button></div>');
          $('#impDbCancel').onclick = Modal.close;
          $('#impDbConfirm').onclick = () => {
            const rr = importDbProgress(rows, false);
            Modal.close();
            toast('导入完成 ✅ 新增 ' + rr.added + ' 条 · 更新 ' + rr.updated + ' 条' + (rr.bad ? ' · 跳过 ' + rr.bad + ' 条' : ''));
            App.rerender();
          };
        });
      };
    }
  }
};

const dmInspectView = {
  render(el) {
    const t = todayStr();
    const diao = dmList('dmDiaopei').filter((r) => !r.uploaded);
    const ceya = dmList('dmCeya');
    const expl = dmList('dmExpl').filter((r) => !r.uploaded);
    const dbp = dmList('dmDbProgress');
    const totalDone = dbp.filter((r) => dmDbEffectiveUploadDate(r)).length;
    const pending = diao.length + expl.length + ceya.length;
    const list = []
      .concat(diao.map((r) => ({ type: '调配资料', name: r.well, info: '计划上传 ' + (r.due || '-'), col: 'dm-data', id: r.id })))
      .concat(ceya.map((r) => ({ type: '测压井', name: r.well, info: (r.expectDate ? '预计起设备 ' + r.expectDate : '') + (r.uploadNode ? ' / ' + r.uploadNode : ''), col: 'dm-data', id: r.id })))
      .concat(expl.map((r) => {
        const d = r.assignDate ? daysBetween(r.assignDate, t) : null;
        return { type: '解释报告', name: (r.unit || '') + ' ' + (r.well || ''), info: '派发 ' + (r.assignDate || '-') + (d != null && d > 20 ? '（超期 ' + (d - 20) + ' 天）' : ''), col: 'dm-data', id: r.id };
      }));
    el.innerHTML = '<div class="grid g3" style="margin-bottom:14px">'
      + statCard('待上传资料总数', pending + ' 项', '调配 ' + diao.length + ' / 测压 ' + ceya.length + ' / 报告 ' + expl.length)
      + statCard('已录入完成测试井', totalDone + ' 口', '数据库进度累计')
      + statCard('迎检就绪', pending === 0 ? '✔ 资料齐备' : '尚有未上传', '半年专项核查')
      + '</div>'
      + '<div class="card"><h3>🗂️ 待上传 / 在办资料清单（半年迎检）</h3>'
      + (list.length ? '<div class="table-wrap"><table><thead><tr><th>类型</th><th>井号/项目</th><th>说明</th><th>操作</th></tr></thead><tbody>'
        + list.map((p) => '<tr><td>' + esc(p.type) + '</td><td>' + esc(p.name) + '</td><td class="muted small">' + esc(p.info) + '</td><td><button class="btn sm" data-go="' + p.col + '">处理</button></td></tr>').join('') + '</tbody></table></div>'
        : '<div class="empty">🎉 当前无待上传资料，迎检资料齐备</div>')
      + '</div>'
      + '<div class="toolbar"><span class="muted small">一键导出半年迎检资料清单（Excel）</span><span class="sp"></span><button class="btn primary" id="expInspect">导出Excel清单</button></div>';
    $$('[data-go]', el).forEach((x) => x.onclick = () => App.go(x.dataset.go));
    $('#expInspect', el).onclick = () => Exporter.xls('动态监测半年迎检资料清单.xls', ['类型', '井号/项目', '说明'], list.map((p) => [p.type, p.name, p.info]));
  }
};
Views['dm-data'] = subtabsView([
  {
    id: 'db', name: '数据库进度', icon: '📊',
    view: dmDbProgressView
  },
  {
    id: 'diao', name: '调配资料', icon: '🔀',
    view: dmDataView('dmDiaopei', {
      heads: ['well', 'count', 'due', 'leftDays', 'uploaded', 'note'],
      headLabels: { leftDays: '剩余天数' },
      decorate(rows, t) { return rows.map((r) => Object.assign({}, r, { leftDays: r.due ? daysBetween(t, r.due) : null })); },
      rowClass(r, t) { if (!r.uploaded && r.due && daysBetween(t, r.due) < 0) return 'row-overdue'; if (!r.uploaded && r.due && daysBetween(t, r.due) <= 3) return 'row-warn'; return ''; }
    })
  },
  { id: 'ceya', name: '测压井', icon: '🛢️', view: dmDataView('dmCeya') },
  {
    id: 'expl', name: '解释报告', icon: '📑',
    view: dmDataView('dmExpl', {
      heads: ['unit', 'well', 'assignDate', 'days', 'uploaded', 'note'],
      headLabels: { days: '已用工时(天)' },
      decorate(rows, t) { return rows.map((r) => Object.assign({}, r, { days: r.assignDate ? daysBetween(r.assignDate, t) : null })); },
      rowClass(r, t) { if (!r.uploaded && r.assignDate && daysBetween(r.assignDate, t) > 20) return 'row-overdue'; return ''; }
    })
  },
  { id: 'memo', name: '系统备忘', icon: '📝', view: dmDataView('dmMemo') },
  { id: 'inspect', name: '迎检汇总', icon: '🗂️', view: dmInspectView }
]);

/* ===== 模块4: 动态监测月报辅助看板 ===== */
Views['dm-report'] = {
  title: '动态监测月报看板',
  state: { month: monthStr() },
  render(el, self) {
    const m = self.state.month || monthStr();
    const wl = dmList('dm-workload', m);
    const monthDone = wl.reduce((s, x) => s + (Number(x.completed) || 0), 0);
    const monthFail = wl.reduce((s, x) => s + (Number(x.failed) || 0), 0);
    const byArea = {}, byProj = {};
    wl.forEach((x) => { byArea[x.area] = (byArea[x.area] || 0) + (Number(x.completed) || 0); byProj[x.project] = (byProj[x.project] || 0) + (Number(x.completed) || 0); });
    const areaStr = Object.entries(byArea).map(([k, v]) => k + ' ' + v + '口').join('、') || '—';
    const projStr = Object.entries(byProj).map(([k, v]) => k + ' ' + v + '口').join('、') || '—';
    const iss = dmList('dm-issues').filter((x) => x.date && monthStr(x.date) === m);
    const openIss = iss.filter((x) => x.status !== '已闭环');
    const issueByCat = {};
    iss.forEach((x) => { const k = x.biz || x.category || '其他'; issueByCat[k] = (issueByCat[k] || 0) + 1; });
    const issueStr = Object.entries(issueByCat).map(([k, v]) => k + ' ' + v + '项').join('、') || '—';
    const dbp = dmList('dmDbProgress');
    const totalProgress = dbp.length;
    const doneUpload = dbp.filter((r) => dmDbEffectiveUploadDate(r)).length;
    const failWells = dbp.filter((r) => String(r.status).indexOf('失败') >= 0).length;
    const pendingUpload = dbp.filter((r) => r.testDate && r.testDate !== '1900-01-01' && !dmDbEffectiveUploadDate(r)).length;
    const progressRate = totalProgress ? Math.round(doneUpload / totalProgress * 100) : 0;
    const now = new Date();
    const d25 = new Date(now.getFullYear(), now.getMonth(), 25);
    if (d25 < now) d25.setMonth(d25.getMonth() + 1);
    const daysTo25 = Math.round((d25 - now) / 864e5);
    const ceya = DB.setting('dmCeyaSummary', {})[m] || null;
    let cp = 0, cd = 0;
    if (ceya && ceya.areas) ceya.areas.forEach((a) => { cp += a.plan; cd += a.done; });
    const ceyaRate = cp ? Math.round(cd / cp * 100) : 0;
    const ceyaUnfin = Math.max(0, cp - cd);
    const ceyaStr = ceya && ceya.areas && ceya.areas.length ? ('计划 ' + cp + ' 口，完成 ' + cd + ' 口，完成率 ' + ceyaRate + '%，未完成 ' + ceyaUnfin + ' 口') : '—';
    const template = '【' + m + ' 动态监测月度报告】\n'
      + '一、测试完成情况\n本月累计完成监测井次 ' + monthDone + ' 口（失败 ' + monthFail + ' 口）。分作业区：' + areaStr + '。分测试项目：' + projStr + '。\n测压计划完成情况：' + ceyaStr + '。\n'
      + '二、资料录入进度\n数据库进度正常推进；当前库内总进展 ' + totalProgress + ' 口，已完成资料录入 ' + doneUpload + ' 口，测试失败 ' + failWells + ' 口，待录入资料 ' + pendingUpload + ' 口，录入进度 ' + progressRate + '%。请相关队伍按期上传，杜绝超期。\n'
      + '三、现存问题\n本月共记录问题 ' + iss.length + ' 项，未闭环 ' + openIss.length + ' 项，分布：' + issueStr + '。重点问题需加快推进整改闭环。\n'
      + '四、下步工作安排\n1. 紧盯未闭环问题整改，确保按期销项；\n2. 督促各作业区及承包商加快资料上传，杜绝超期；\n3. 提前筹备下月监测计划，保障年度计划完成率。';
    el.innerHTML = '<div class="toolbar"><label class="muted small">报告月份</label><input type="month" id="rMonth" value="' + m + '" style="width:150px"><span class="sp"></span>'
      + '<button class="btn sm" id="addCd">＋ 添加到倒数日(迎检)</button><button class="btn primary" id="expDoc">导出Word初稿</button></div>'
      + '<div class="grid g5" style="margin-bottom:14px">'
      + statCard('库内总进展', totalProgress + ' 条', '数据库进度台账')
      + statCard('已完成资料录入测试井', doneUpload + ' 口', '已有资料上传日期')
      + statCard('测试失败井', failWells + ' 口', '当前状态为失败')
      + statCard('待录入资料测试井', pendingUpload + ' 口', '已测试未上传资料')
      + statCard('录入进度', progressRate + '%', '距月报25日还有 ' + daysTo25 + ' 天')
      + '</div>'
      + (ceya && ceya.areas && ceya.areas.length ? '<div class="card" style="margin-bottom:14px"><h3>🛢️ 测压计划完成情况（' + m + '）</h3><div class="grid g4">'
        + statCard('全厂计划', cp + ' 口', '') + statCard('全厂完成', cd + ' 口', '') + statCard('完成率', ceyaRate + '%', '') + statCard('未完成井次', ceyaUnfin + ' 口', '')
        + '</div><div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>作业区</th><th>计划</th><th>完成</th><th>完成率</th><th>采油井(计/完)</th><th>注水(计/完)</th><th>考核备注</th></tr></thead><tbody>'
        + ceya.areas.map((a) => { const r = a.plan ? Math.round(a.done / a.plan * 100) : 0; const cls = a.done < a.plan ? 'red' : (a.done > a.plan ? 'green' : 'gray'); return '<tr><td>' + esc(a.area) + '</td><td>' + a.plan + '</td><td>' + a.done + '</td><td><span class="tag ' + cls + '">' + r + '%</span></td><td>' + a.oilPlan + ' / ' + a.oilDone + '</td><td>' + a.waterPlan + ' / ' + a.waterDone + '</td><td class="muted small">' + esc(a.note || '') + '</td></tr>'; }).join('')
        + '</tbody></table></div></div>'
        : '<div class="hint" style="margin:0 0 12px">本期（' + m + '）尚未导入测压计划完成情况统计表，可到「测压计划完成情况」模块导入</div>')
      + '<div class="card"><h3>📋 月报正文（可直接修改）</h3><textarea id="rText" style="width:100%;min-height:340px;font-size:.9rem;line-height:1.7">' + esc(template) + '</textarea>'
      + '<div class="muted small" style="margin-top:8px">数据已自动拉取台账预填充，可手动调整。导出为 Word 初稿供进一步排版。</div></div>';
    $('#rMonth', el).onchange = () => { self.state.month = $('#rMonth', el).value; App.rerender(); };
    $('#expDoc', el).onclick = () => {
      const html = '<h2>动态监测月度报告（' + m + '）</h2><div style="white-space:pre-wrap;font-family:Microsoft YaHei;line-height:1.8">' + esc($('#rText', el).value).replace(/\n/g, '<br>') + '</div>';
      Exporter.doc('动态监测月报_' + m + '.doc', html);
    };
    $('#addCd', el).onclick = () => {
      const n = new Date(); n.setDate(25); if (n < new Date()) n.setMonth(n.getMonth() + 1);
      const d = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
      openForm('countdowns', null, { preset: { title: '动态监测月报/迎检 · ' + m, tag: 'work', date: d, note: '动态监测月度报告编制 / 半年迎检提醒' } });
    };
  }
};
