/* =========================================================
 * app-core.js  核心引擎：存储 / 同步 / 通知 / 模式联动 / 工具
 * ========================================================= */
'use strict';

/* ---------- 工具函数 ---------- */
const $  = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const addDays = (dstr, n) => { const d = new Date(dstr + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const monthStr = (dstr) => (dstr || todayStr()).slice(0, 7);
const fmtMoney = (n) => '¥' + Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
const weekKey = (dstr) => { const d = new Date(dstr + 'T00:00:00'); const on = new Date(d); on.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return on.getFullYear() + '-W' + String(Math.ceil((((on - new Date(on.getFullYear(), 0, 1)) / 864e5) + 1) / 7)).padStart(2, '0'); };

function toast(msg, cls) {
  const box = $('#toasts'); const t = document.createElement('div');
  t.className = 'toast ' + (cls || 'ok'); t.textContent = msg; box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, 2200);
}

/* ---------- 存储层 ----------
 * 结构: DB = { settings:{...}, collections:{ key:[record] }, notifications:[...] }
 * record: { id, mode, updatedAt, deleted?, ...fields }  按月分区依据 record.date
 */
const DB_KEY = 'workbench_db_v1';
const DB = {
  data: null,
  _batch: 0,
  load() {
    try { this.data = JSON.parse(localStorage.getItem(DB_KEY)) || null; } catch (e) { this.data = null; }
    if (!this.data) this.data = { settings: {}, collections: {}, notifications: [], rev: 0 };
    if (!this.data.settings) this.data.settings = {};
    if (!this.data.collections) this.data.collections = {};
    if (!this.data.notifications) this.data.notifications = [];
    return this.data;
  },
  save(silent) {
    this.data.rev = (this.data.rev || 0) + 1;
    this.data.savedAt = Date.now();
    try { localStorage.setItem(DB_KEY, JSON.stringify(this.data)); } catch (e) { toast('本地存储空间不足', 'err'); }
    if (!silent) Sync.push();
    try { Sync.bc && Sync.bc.postMessage({ type: 'db-updated', rev: this.data.rev }); } catch (e) {}
  },
  col(key) { if (!this.data.collections[key]) this.data.collections[key] = []; return this.data.collections[key]; },
  /* 有效记录（过滤墓碑），可按模式/月份过滤 */
  list(key, opt) {
    opt = opt || {};
    let rows = this.col(key).filter((r) => !r.deleted);
    if (opt.mode) rows = rows.filter((r) => !r.mode || r.mode === opt.mode);
    if (opt.month) rows = rows.filter((r) => r.date && monthStr(r.date) === opt.month);
    return rows;
  },
  get(key, id) { return this.col(key).find((r) => r.id === id); },
  upsert(key, rec) {
    const col = this.col(key);
    rec.updatedAt = Date.now();
    const i = col.findIndex((r) => r.id === rec.id);
    if (i >= 0) col[i] = Object.assign({}, col[i], rec); else { rec.id = rec.id || uid(); rec.createdAt = Date.now(); col.push(rec); }
    if (!this._batch) this.save();
    return rec;
  },
  remove(key, id) {
    const r = this.get(key, id);
    if (r) { r.deleted = true; r.updatedAt = Date.now(); if (!this._batch) this.save(); }
  },
  /* 批量模式：回调内所有 upsert/remove/setSetting 不自动 save，退出后统一 save 一次 */
  batch(fn) {
    this._batch++;
    try { fn(); } finally { this._batch--; if (!this._batch) this.save(); }
  },
  setting(k, def) { return this.data.settings[k] === undefined ? def : this.data.settings[k]; },
  setSetting(k, v) { this.data.settings[k] = v; if (!this._batch) this.save(); }
};

/* ---------- 同步引擎 ----------
 * 1) BroadcastChannel + storage 事件: 同设备多标签页实时同步
 * 2) 远端同步: 可在设置中配置同步服务地址(任意支持 GET/PUT JSON 的 KV 接口)+同步码
 *    离线自动排队, 联网后自动推送; 拉取采用记录级合并(updatedAt 新者胜, 墓碑保留)
 */
const Sync = {
  bc: null, pending: false, timer: null, lastSync: 0, status: 'local',
  init() {
    try {
      this.bc = new BroadcastChannel('workbench-sync');
      this.bc.onmessage = (ev) => { if (ev.data && ev.data.type === 'db-updated') { DB.load(); App.rerender(); } };
    } catch (e) {}
    window.addEventListener('storage', (ev) => { if (ev.key === DB_KEY) { DB.load(); App.rerender(); } });
    window.addEventListener('online', () => { toast('网络已恢复，正在同步…'); this.push(); this.pull(); });
    window.addEventListener('offline', () => { this.setStatus('offline'); toast('已离线，数据将缓存在本地', 'err'); });
    const cfg = this.cfg();
    const hasCloud = !!(cfg.getUrl || cfg.putUrl || cfg.url);
    if (hasCloud) { this.pull(); this.timer = setInterval(() => this.pull(), 30000); }
    this.setStatus(navigator.onLine ? (hasCloud ? 'cloud' : 'local') : 'offline');
  },
  cfg() {
    const cloud = (typeof window !== 'undefined' && window.CLOUD_SYNC) ? window.CLOUD_SYNC : {};
    return Object.assign({ url: '', key: '' }, cloud, DB.setting('syncCfg', {}));
  },
  isCloud() { const c = this.cfg(); return !!(c.getUrl && c.putUrl); },
  code() { const k = this.cfg().key || ''; return k.trim() || 'default'; },
  getUrl() { const c = this.cfg(); return c.getUrl || (c.url && c.key ? this.endpoint() : ''); },
  putUrl() { const c = this.cfg(); return c.putUrl || (c.url && c.key ? this.endpoint() : ''); },
  endpoint() { const c = this.cfg(); if (!c.url) return null; return c.url.replace(/\/+$/, '') + '/' + encodeURIComponent(c.key || 'default'); },
  setStatus(s) {
    this.status = s;
    const btn = $('#syncBtn');
    if (btn) { btn.textContent = s === 'offline' ? '📴' : s === 'cloud' ? '☁️' : '💾'; btn.title = s === 'offline' ? '离线模式（数据已本地缓存）' : s === 'cloud' ? '云同步已开启' : '本地存储模式（可在设置中配置云同步）'; }
  },
  merge(remote) {
    if (!remote || !remote.collections) return false;
    let changed = false;
    Object.keys(remote.collections).forEach((k) => {
      const local = DB.col(k); const map = {};
      local.forEach((r) => { map[r.id] = r; });
      (remote.collections[k] || []).forEach((rr) => {
        const lr = map[rr.id];
        if (!lr) { local.push(rr); changed = true; }
        else if ((rr.updatedAt || 0) > (lr.updatedAt || 0)) { Object.assign(lr, rr); changed = true; }
      });
    });
    if (remote.settings && (remote.settingsAt || 0) > (DB.data.settingsAt || 0)) { DB.data.settings = Object.assign({}, DB.data.settings, remote.settings); DB.data.settingsAt = remote.settingsAt; changed = true; }
    if (changed) { DB.save(true); }
    return changed;
  },
  async pull() {
    const url = this.getUrl(); if (!url || !navigator.onLine) return;
    try {
      const res = await fetch(url, { method: 'GET', cache: 'no-store' });
      if (res.ok) {
        const remote = await res.json();
        let data = remote;
        if (this.isCloud() && remote && remote.spaces) {
          data = remote.spaces[this.code()] || {};
        } else if (this.isCloud() && remote && remote.collections) {
          /* 兼容旧格式(无 spaces 包裹) */
          data = remote;
        }
        if (this.merge(data)) { App.rerender(); toast('已从云端同步最新数据'); }
        this.setStatus('cloud'); this.lastSync = Date.now();
      }
    } catch (e) { this.setStatus(navigator.onLine ? 'cloud' : 'offline'); }
  },
  async push() {
    const url = this.putUrl(); if (!url) return;
    if (!navigator.onLine) { this.pending = true; this.setStatus('offline'); return; }
    clearTimeout(this._pt);
    this._pt = setTimeout(async () => {
      try {
        DB.data.settingsAt = Date.now();
        if (this.isCloud()) {
          /* 读改写: 先取最新全量, 合并其他设备改动, 再更新本空间分区写回 */
          let all = { v: 1, spaces: {}, rev: 0 };
          try {
            const res = await fetch(this.getUrl(), { method: 'GET', cache: 'no-store' });
            if (res.ok) {
              const cur = await res.json();
              if (cur && cur.spaces) { all = cur; const sp = cur.spaces[this.code()] || {}; if (sp.collections) this.merge(sp); }
              else if (cur && cur.collections) { all.spaces['default'] = cur; all.rev = cur.rev || 0; this.merge(cur); }
            }
          } catch (e) {}
          all.spaces[this.code()] = {
            settings: DB.data.settings, collections: DB.data.collections,
            notifications: DB.data.notifications, settingsAt: DB.data.settingsAt, rev: (DB.data.rev || 0) + 1
          };
          await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(all) });
        } else {
          await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(DB.data) });
        }
        this.pending = false; this.lastSync = Date.now(); this.setStatus('cloud');
      } catch (e) { this.pending = true; }
    }, 800);
  }
};

/* ---------- 通知中心 ---------- */
const Notif = {
  add(title, body, group, dedupeKey) {
    if (dedupeKey && DB.data.notifications.some((n) => n.dk === dedupeKey)) return;
    /* 分组管控 */
    const mode = ModeCtl.current();
    const gs = DB.setting('notifGroups', { workInVacation: false, lifeInWork: false });
    if (group === 'work' && mode === 'life' && !gs.workInVacation) return;
    if (group === 'life' && mode === 'work' && !gs.lifeInWork) return;
    DB.data.notifications.unshift({ id: uid(), title, body: body || '', group: group || 'global', dk: dedupeKey || '', read: false, at: Date.now() });
    if (DB.data.notifications.length > 200) DB.data.notifications.length = 200;
    DB.save(true);
    this.renderBadge();
    /* 系统级推送(浏览器通知) */
    if (DB.setting('sysNotify', true) && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body: body || '', icon: 'icon.svg' }); } catch (e) {}
    }
  },
  renderBadge() {
    const n = DB.data.notifications.filter((x) => !x.read).length;
    const b = $('#notifBadge');
    if (b) { b.style.display = n ? 'flex' : 'none'; b.textContent = n > 99 ? '99+' : n; }
  },
  renderPanel() {
    const p = $('#notifPanel');
    const list = DB.data.notifications.slice(0, 60);
    const gname = { work: '工作', life: '生活', side: '兼职', global: '系统' };
    p.innerHTML = '<div style="display:flex;align-items:center;margin-bottom:8px"><b style="flex:1">通知中心</b>'
      + '<button class="btn sm" id="readAllBtn">全部已读</button></div>'
      + (list.length ? list.map((n) => '<div class="notif-item ' + (n.read ? '' : 'unread') + '" data-id="' + n.id + '">'
        + '<b>' + esc(n.title) + '</b> <span class="tag gray">' + (gname[n.group] || '通用') + '</span>'
        + (n.body ? '<div class="muted small" style="margin-top:3px">' + esc(n.body) + '</div>' : '')
        + '<div class="t">' + new Date(n.at).toLocaleString('zh-CN') + '</div></div>').join('') : '<div class="empty">暂无通知</div>');
    $('#readAllBtn', p).onclick = () => { DB.data.notifications.forEach((n) => n.read = true); DB.save(true); this.renderBadge(); this.renderPanel(); };
    $$('.notif-item', p).forEach((el) => el.onclick = () => { const n = DB.data.notifications.find((x) => x.id === el.dataset.id); if (n) { n.read = true; DB.save(true); this.renderBadge(); this.renderPanel(); } });
  },
  askPermission() { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); }
};

/* ---------- 模式控制 + 倒数日联动引擎 ---------- */
const ModeCtl = {
  current() { return DB.setting('mode', 'work'); },
  /* 收集所有休假周期(含年度循环换算到今年), 返回 [{start,end,title,id}] */
  vacations() {
    return DB.list('countdowns').filter((c) => c.tag === 'vacation' && c.date && c.endDate)
      .map((c) => ({ id: c.id, title: c.title, start: c.date, end: c.endDate }));
  },
  /* 判断某日期处于哪个休假周期; 重叠时取最晚结束日期为基准 */
  activeVacation(dstr) {
    const vs = this.vacations().filter((v) => v.start <= dstr && dstr <= v.end);
    if (!vs.length) return null;
    vs.sort((a, b) => b.end.localeCompare(a.end));
    /* 合并重叠: 以最晚结束日期为切换基准 */
    return vs[0];
  },
  /* 手动切换：本轮休假周期内暂停自动逻辑 */
  manualSwitch(mode) {
    DB.setSetting('mode', mode);
    const v = this.activeVacation(todayStr());
    if (v) DB.setSetting('manualHold', { until: v.end, setAt: Date.now() });
    else DB.setSetting('manualHold', null);
    toast(mode === 'work' ? '已切换到牛马模式 🐮' : '已切换到休假模式 🏖️');
    App.gotoModeHome(mode);
  },
  /* 定时自动检测（每端本地执行） */
  autoCheck() {
    const t = todayStr();
    const hold = DB.setting('manualHold', null);
    if (hold && hold.until && t <= hold.until) return;  /* 手动优先: 本轮周期内暂停 */
    if (hold && hold.until && t > hold.until) DB.setSetting('manualHold', null); /* 周期结束恢复 */
    const v = this.activeVacation(t);
    const want = v ? 'life' : 'work';
    if (this.current() !== want) {
      DB.setSetting('mode', want);
      Notif.add(want === 'life' ? '已自动切换至休假模式 🏖️' : '已自动切换至牛马模式 🐮',
        v ? ('当前休假: ' + v.title + '（至' + v.end + '）') : '休假结束，回归工作', 'global', 'autoswitch-' + t + '-' + want);
      App.gotoModeHome(want);
    }
    /* 预警提醒: 开始前1天 / 结束前1天 */
    this.vacations().forEach((v2) => {
      if (daysBetween(t, v2.start) === 1) Notif.add('休假前提醒 ⏰', '「' + v2.title + '」明天开始，请梳理工作交接', 'global', 'vac-pre-' + v2.id + '-' + v2.start);
      if (daysBetween(t, v2.end) === 1) Notif.add('复工前提醒 💼', '「' + v2.title + '」明天结束，请提前做复工规划', 'global', 'vac-post-' + v2.id + '-' + v2.end);
    });
  }
};

/* ---------- 提醒调度(待办截止/兼职/倒数日/家务循环) ---------- */
const Reminder = {
  checkAll() {
    const t = todayStr();
    /* 待办截止 */
    DB.list('todos').forEach((x) => {
      if (x.status !== '已完成' && x.deadline) {
        const d = daysBetween(t, x.deadline);
        if (d === 0) Notif.add('任务今日截止 ⚠️', x.title, 'work', 'todo-due-' + x.id + '-' + t);
        else if (d === 1) Notif.add('任务明日截止', x.title, 'work', 'todo-pre-' + x.id + '-' + t);
        else if (d < 0) Notif.add('任务已逾期 ❗', x.title + '（截止 ' + x.deadline + '）', 'work', 'todo-over-' + x.id);
      }
    });
    /* 倒数日单条提醒 */
    DB.list('countdowns').forEach((c) => {
      if (!c.remind || !c.date) return;
      let target = c.date;
      if (c.yearly) { const now = new Date(); let y = now.getFullYear(); let md = c.date.slice(5); target = y + '-' + md; if (target < t) target = (y + 1) + '-' + md; }
      const d = daysBetween(t, target);
      const g = c.tag === 'work' ? 'work' : c.tag === 'vacation' ? 'global' : 'global';
      if (d === 0) Notif.add('倒数日提醒 📅', '「' + c.title + '」就是今天！', g, 'cd-' + c.id + '-' + target);
      else if (d === 3) Notif.add('倒数日提醒', '「' + c.title + '」还有3天（' + target + '）', g, 'cd3-' + c.id + '-' + target);
    });
    /* 兼职提醒(全局推送) */
    DB.list('sidereminds').forEach((r) => {
      if (r.date && daysBetween(t, r.date) === 0 && !r.done) Notif.add('兼职提醒 🎮✍️', r.title + (r.type ? '（' + r.type + '）' : ''), 'side', 'side-' + r.id + '-' + t);
    });
    /* 家务循环提醒 */
    DB.list('choreplans').forEach((p) => {
      if (!p.intervalDays) return;
      const logs = DB.list('chores').filter((c) => c.room === p.room && c.task === p.task && c.done === '完成');
      const last = logs.map((c) => c.date).sort().pop();
      if (!last || daysBetween(last, t) >= Number(p.intervalDays)) {
        Notif.add('家务提醒 🧹', p.room + ' - ' + p.task + (last ? '（上次: ' + last + '）' : '（尚无记录）'), 'life', 'chore-' + p.id + '-' + t);
      }
    });
    /* 动态监测问题闭环: 未闭环 截止当日/前1天/逾期 */
    DB.list('dm-issues').forEach((x) => {
      if (x.status === '已闭环' || !x.deadline) return;
      const d = daysBetween(t, x.deadline);
      if (d === 0) Notif.add('问题今日截止整改 ⚠️', x.title + '（' + (x.riskLevel || '') + '）', 'work', 'dmissue-due-' + x.id + '-' + t);
      else if (d === 1) Notif.add('问题明日截止整改', x.title, 'work', 'dmissue-pre-' + x.id + '-' + t);
      else if (d < 0) Notif.add('问题整改已逾期 ❗', x.title + '（截止 ' + x.deadline + '）', 'work', 'dmissue-over-' + x.id);
    });
    /* 解释报告超20天未上传 */
    DB.list('dmExpl').forEach((r) => {
      if (!r.uploaded && r.assignDate && daysBetween(r.assignDate, t) > 20) Notif.add('解释报告上传超期 ⚠️', (r.unit || '') + ' ' + (r.well || '') + ' 已超20天未上传', 'work', 'dmexpl-' + r.id);
    });
    /* 月报编制提醒: 每月25日 */
    const dom = new Date().getDate();
    if (dom === 25) Notif.add('月报编制提醒 📋', '今日25日，请编制动态监测月度报告', 'work', 'dmreport-' + monthStr());
    /* 半年迎检节点(6-30 / 12-31) */
    const mmdd = (new Date().getMonth() + 1) + '-' + dom;
    if (mmdd === '6-30' || mmdd === '12-31') Notif.add('半年迎检倒计时 ⏳', '半年专项核查节点，请整理动态监测全部台账', 'work', 'dmhalf-' + new Date().getFullYear() + '-' + mmdd);
    /* 烹饪: 晚间提醒规划次日三餐(19点后, 若次日尚未规划) */
    if (DB.setting('cookRemind', true) && new Date().getHours() >= 19) {
      const tmr = addDays(t, 1);
      if (!DB.list('cooking').some((r) => r.date === tmr)) {
        Notif.add('晚餐规划提醒 🍳', '今天还没安排明天的三餐哦，记得规划菜单和采购清单~', 'life', 'cook-plan-' + t);
      }
    }
  }
};

/* ---------- CSV 解析(微信/支付宝账单) ---------- */
const CSVImport = {
  parse(text) {
    /* 通用CSV解析,兼容引号包裹 */
    const rows = []; let cur = [''], inQ = false, ri = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; } else inQ = false; } else cur[cur.length - 1] += ch; }
      else if (ch === '"') inQ = true;
      else if (ch === ',') cur.push('');
      else if (ch === '\n' || ch === '\r') { if (cur.length > 1 || cur[0] !== '') { rows.push(cur); } cur = ['']; if (ch === '\r' && text[i + 1] === '\n') i++; }
      else cur[cur.length - 1] += ch;
    }
    if (cur.length > 1 || cur[0] !== '') rows.push(cur);
    return rows;
  },
  /* 识别微信/支付宝格式并转为记账记录 */
  toLedger(rows) {
    let headerIdx = -1, map = null, src = '';
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const line = rows[i].join(',');
      if (line.includes('交易时间') && (line.includes('金额') || line.includes('收/支'))) {
        headerIdx = i;
        src = line.includes('交易对方') && line.includes('支付方式') ? '微信' : '支付宝';
        const h = rows[i].map((s) => s.trim());
        map = {
          time: h.findIndex((x) => x.includes('交易时间') || x.includes('交易创建时间')),
          type: h.findIndex((x) => x === '收/支' || x.includes('收/支')),
          amount: h.findIndex((x) => x.includes('金额')),
          peer: h.findIndex((x) => x.includes('交易对方')),
          item: h.findIndex((x) => x.includes('商品') || x.includes('商品说明') || x.includes('商品名称')),
          cat: h.findIndex((x) => x.includes('交易分类') || x.includes('交易类型'))
        };
        break;
      }
    }
    if (headerIdx < 0) return { ok: false, msg: '未识别到微信/支付宝账单表头，请确认CSV格式' };
    const out = [], bad = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i]; if (r.length < 3) continue;
      const g = (idx) => (idx >= 0 && r[idx] != null ? String(r[idx]).trim() : '');
      const timeRaw = g(map.time); const m = timeRaw.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
      const amtRaw = g(map.amount).replace(/[¥￥,\s]/g, '');
      const amt = parseFloat(amtRaw);
      const io = g(map.type);
      if (!m || isNaN(amt) || amt <= 0 || (io && io !== '收入' && io !== '支出' && io !== '不计收支' && io !== '/')) { if (timeRaw || amtRaw) bad.push({ line: i + 1, raw: r.join(',').slice(0, 60) }); continue; }
      if (io === '不计收支' || io === '/') continue;
      const note = [g(map.peer), g(map.item)].filter(Boolean).join(' | ');
      out.push({
        date: m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0'),
        type: io === '收入' ? '收入' : '支出',
        amount: amt,
        category: Ledger.autoCat(note + ' ' + g(map.cat), io === '收入' ? '收入' : '支出'),
        account: src, note
      });
    }
    return { ok: true, list: out, bad, src };
  }
};

/* ---------- 记账自动分类 ---------- */
const Ledger = {
  defaultRules: [
    { kw: '餐|饭|外卖|美团|饿了么|食|奶茶|咖啡|超市|买菜|水果', cat: '餐饮食品' },
    { kw: '打车|滴滴|地铁|公交|加油|停车|高速|火车|机票|航空', cat: '交通出行' },
    { kw: '房租|物业|水费|电费|燃气|宽带|话费|通信', cat: '居住缴费' },
    { kw: '淘宝|京东|拼多多|服饰|鞋|化妆|护肤|日用', cat: '购物消费' },
    { kw: '医院|药|诊|体检|挂号', cat: '医疗健康' },
    { kw: '幼儿园|学费|培训|绘本|玩具|童装|奶粉|尿不湿', cat: '育儿教育' },
    { kw: '电影|游戏|会员|视频|娱乐|旅游|门票|酒店', cat: '休闲娱乐' },
    { kw: '工资|薪|奖金|绩效', cat: '工资薪酬' },
    { kw: '直播|打赏|礼物分成', cat: '直播收益' },
    { kw: '稿费|稿酬|小说|全勤', cat: '稿费收入' },
    { kw: '红包|转账', cat: '人情往来' }
  ],
  rules() { return DB.setting('catRules', this.defaultRules); },
  autoCat(text, type) {
    const rs = this.rules();
    for (const r of rs) { try { if (new RegExp(r.kw).test(text || '')) return r.cat; } catch (e) {} }
    return type === '收入' ? '其他收入' : '其他支出';
  },
  categories(type) {
    const base = type === '收入' ? ['工资薪酬', '直播收益', '稿费收入', '人情往来', '理财收益', '其他收入']
      : ['餐饮食品', '交通出行', '居住缴费', '购物消费', '医疗健康', '育儿教育', '休闲娱乐', '人情往来', '其他支出'];
    const custom = DB.setting('customCats_' + type, []);
    return Array.from(new Set(base.concat(custom)));
  }
};

/* ---------- 迷你图表(canvas, 无外部依赖) ---------- */
const Chart2 = {
  colors: ['#9b6dd6', '#4cc38a', '#e0a84b', '#e06c75', '#c77fd6', '#5b8def', '#d97fc0', '#7aa86a', '#8c7bd6', '#5fc9b2'],
  _setup(cv, h) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.parentElement ? cv.parentElement.clientWidth - 4 : 320;
    cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px';
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    return { ctx, w, h };
  },
  txtColor() { return document.documentElement.dataset.theme === 'light' ? '#6b7385' : '#8b93a5'; },
  bar(cv, labels, series, opt) { /* series: [{name,data,color}] */
    opt = opt || {}; const { ctx, w, h } = this._setup(cv, opt.h || 200);
    const pad = { l: 44, r: 8, t: 12, b: 26 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const max = Math.max(1, ...series.flatMap((s) => s.data));
    ctx.font = '10px sans-serif'; ctx.fillStyle = this.txtColor(); ctx.strokeStyle = 'rgba(128,138,160,.18)';
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ih - (ih * i / 4);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(this._fmt(max * i / 4), 2, y + 3);
    }
    const gw = iw / labels.length;
    labels.forEach((lb, i) => {
      const bw = Math.min(26, (gw - 8) / series.length);
      series.forEach((s, si) => {
        const v = s.data[i] || 0; const bh = ih * v / max;
        ctx.fillStyle = s.color || this.colors[si];
        const x = pad.l + gw * i + gw / 2 - bw * series.length / 2 + bw * si;
        ctx.beginPath(); ctx.roundRect(x, pad.t + ih - bh, bw - 2, Math.max(bh, v > 0 ? 2 : 0), 3); ctx.fill();
      });
      if (opt.showValue) {
        const maxV = Math.max(0, ...series.map((s) => s.data[i] || 0));
        const bh = ih * maxV / max;
        const vy = pad.t + ih - bh - 4;
        ctx.fillStyle = this.txtColor(); ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(opt.valueFmt ? opt.valueFmt(maxV) : String(maxV), pad.l + gw * i + gw / 2, vy);
        ctx.textAlign = 'left';
      }
      ctx.fillStyle = this.txtColor();
      const tw = ctx.measureText(lb).width;
      if (gw > tw + 4 || i % Math.ceil(labels.length / 8) === 0) ctx.fillText(lb, pad.l + gw * i + gw / 2 - tw / 2, h - 8);
    });
  },
  line(cv, labels, series, opt) {
    opt = opt || {}; const { ctx, w, h } = this._setup(cv, opt.h || 200);
    const pad = { l: 40, r: 10, t: 12, b: 26 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const all = series.flatMap((s) => s.data).filter((v) => v != null);
    let max = Math.max(1, ...all), min = opt.zero ? 0 : Math.min(...all, max);
    if (max === min) { max += 1; min = Math.max(0, min - 1); }
    ctx.font = '10px sans-serif';
    ctx.strokeStyle = 'rgba(128,138,160,.18)';
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ih - ih * i / 4;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillStyle = this.txtColor(); ctx.fillText(this._fmt(min + (max - min) * i / 4), 2, y + 3);
    }
    const step = labels.length > 1 ? iw / (labels.length - 1) : 0;
    series.forEach((s, si) => {
      ctx.strokeStyle = s.color || this.colors[si]; ctx.lineWidth = 2; ctx.beginPath();
      let started = false;
      s.data.forEach((v, i) => {
        if (v == null) return;
        const x = pad.l + step * i, y = pad.t + ih - ih * (v - min) / (max - min);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      });
      ctx.stroke();
      s.data.forEach((v, i) => {
        if (v == null) return;
        const x = pad.l + step * i, y = pad.t + ih - ih * (v - min) / (max - min);
        ctx.fillStyle = s.color || this.colors[si]; ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
      });
    });
    ctx.fillStyle = this.txtColor();
    labels.forEach((lb, i) => { if (i % Math.ceil(labels.length / 7) === 0 || i === labels.length - 1) { const tw = ctx.measureText(lb).width; ctx.fillText(lb, Math.min(pad.l + step * i - tw / 2, w - tw - 2), h - 8); } });
  },
  pie(cv, items, opt) { /* items: [{label,value}] */
    opt = opt || {}; const { ctx, w, h } = this._setup(cv, opt.h || 190);
    const total = items.reduce((s, x) => s + x.value, 0) || 1;
    const cx = h / 2 + 6, cy = h / 2, r = h / 2 - 14;
    let a = -Math.PI / 2;
    items.forEach((it, i) => {
      const ang = it.value / total * Math.PI * 2;
      ctx.fillStyle = this.colors[i % this.colors.length];
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a, a + ang); ctx.closePath(); ctx.fill();
      if (opt.showValue && ang > 0.32) {
        const mid = a + ang / 2;
        const tx = cx + Math.cos(mid) * r * 0.74, ty = cy + Math.sin(mid) * r * 0.74;
        ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(it.value), tx, ty);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      }
      a += ang;
    });
    /* 中空 */
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, 7); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    /* 图例 */
    ctx.font = '11px sans-serif';
    let ly = 18;
    items.slice(0, 8).forEach((it, i) => {
      ctx.fillStyle = this.colors[i % this.colors.length];
      ctx.fillRect(h + 14, ly - 8, 10, 10);
      ctx.fillStyle = this.txtColor();
      const pct = (it.value / total * 100).toFixed(1) + '%';
      ctx.fillText(it.label + (opt.showValue ? '  ' + it.value + '  (' + pct + ')' : '  ' + pct), h + 30, ly);
      ly += 20;
    });
  },
  _fmt(n) { return n >= 10000 ? (n / 10000).toFixed(1) + 'w' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)); }
};

/* ---------- 导出 ---------- */
const Exporter = {
  download(name, content, mime) {
    const blob = new Blob(['\ufeff' + content], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  },
  csv(name, headers, rows) {
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    this.download(name, headers.map(q).join(',') + '\n' + rows.map((r) => r.map(q).join(',')).join('\n'), 'text/csv;charset=utf-8');
    toast('已导出 ' + name);
  },
  /* 真实 Excel(.xls) / Word(.doc)：用 HTML 表格封装，Excel/Word 可直接打开 */
  _xlsTable(headers, rows) {
    const q = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let h = '<tr>' + headers.map((x) => '<th>' + q(x) + '</th>').join('') + '</tr>';
    let b = rows.map((r) => '<tr>' + r.map((c) => '<td>' + q(c) + '</td>').join('') + '</tr>').join('');
    return '<table border="1" cellspacing="0" cellpadding="4">' + h + b + '</table>';
  },
  xls(name, headers, rows) {
    const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"></head><body>' + this._xlsTable(headers, rows) + '</body></html>';
    this.download(name.replace(/\.csv$/i, '') + '.xls', html, 'application/vnd.ms-excel');
    toast('已导出 Excel: ' + name);
  },
  doc(name, htmlBody) {
    const doc = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"></head><body>' + htmlBody + '</body></html>';
    this.download(name.replace(/\.docx?$/i, '') + '.doc', doc, 'application/msword');
    toast('已导出 Word 初稿: ' + name);
  },
  fullBackup() {
    this.download('工作台全量备份_' + todayStr() + '.json', JSON.stringify(DB.data, null, 1), 'application/json');
    toast('已导出全量备份');
  },
  monthBackup(month) {
    const out = { month, collections: {} };
    Object.keys(DB.data.collections).forEach((k) => {
      out.collections[k] = DB.list(k).filter((r) => r.date && monthStr(r.date) === month);
    });
    this.download('工作台月度数据_' + month + '.json', JSON.stringify(out, null, 1), 'application/json');
    toast('已导出 ' + month + ' 月数据');
  },
  importBackup(file, cb) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const j = JSON.parse(fr.result);
        if (j.collections) { Sync.merge(j); toast('备份数据已合并导入'); cb && cb(); }
        else toast('文件格式不正确', 'err');
      } catch (e) { toast('解析失败: ' + e.message, 'err'); }
    };
    fr.readAsText(file);
  }
};
