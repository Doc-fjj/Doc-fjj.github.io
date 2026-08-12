/* =========================================================
 * app-main.js  应用主控制器：路由 / 导航 / 主题 / 定时调度
 * ========================================================= */
'use strict';

const App = {
  version: 'v11',
  page: null,

  init() {
    DB.load();
    Sync.init();
    /* 主题 */
    document.documentElement.dataset.theme = DB.setting('theme', 'dark');
    /* 页面记忆: 恢复当前模式上次浏览页面 */
    ModeCtl.autoCheck();
    const mem = DB.setting('pageMemory', {});
    const mode = ModeCtl.current();
    this.page = mem[mode] || (mode === 'work' ? 'dash-work' : 'dash-life');
    if (!this.validPage(this.page)) this.page = mode === 'work' ? 'dash-work' : 'dash-life';

    this.bindChrome();
    this.render();
    Notif.renderBadge();
    Notif.askPermission();

    /* 定时调度: 每60秒检测模式自动切换 + 各类提醒 */
    Reminder.checkAll();
    setInterval(() => { ModeCtl.autoCheck(); Reminder.checkAll(); Notif.renderBadge(); }, 60000);

    /* Service Worker：注册并监听更新，发现新版本立即提示刷新 */
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const newSW = reg.installing;
          newSW.addEventListener('statechange', () => {
            if (newSW.state === 'activated') {
              if (confirm('工作台已更新到新版，点击确定立即刷新生效')) location.reload();
            }
          });
        });
      }).catch(() => {});
    }
  },

  validPage(id) { return !!Views[id] && this.allNavItems().some((x) => x.id === id); },
  allNavItems() {
    const mode = ModeCtl.current();
    return getNav(mode).concat(getNav('global'));
  },

  go(id) {
    if (!Views[id]) return;
    this.page = id;
    const mem = DB.setting('pageMemory', {});
    mem[ModeCtl.current()] = id;
    DB.data.settings.pageMemory = mem; DB.save(true); /* 静默保存页面记忆 */
    this.render();
    /* 移动端自动收起侧栏 */
    $('#sidebar').classList.remove('open');
    $('#sideMask').style.display = 'none';
    window.scrollTo(0, 0);
  },

  gotoModeHome(mode) { this.page = mode === 'work' ? 'dash-work' : 'dash-life'; this.render(); },

  render() {
    this.renderNav();
    this.renderTop();
    const el = $('#content');
    const v = Views[this.page];
    if (!v) { el.innerHTML = '<div class="card"><div class="empty">页面不存在</div></div>'; return; }
    v.render(el, v);
    this.renderFab();
  },
  rerender() { this.render(); Notif.renderBadge(); },

  renderNav() {
    const mode = ModeCtl.current();
    const nav = $('#nav');
    const groups = [[mode, mode === 'work' ? '🐮 牛马模式' : '🏖️ 休假模式'], ['global', '🌐 全局常驻']];
    nav.innerHTML = groups.map(([g, gn]) =>
      '<div class="nav-group-title s-label">' + gn + '</div>'
      + getNav(g).filter((x) => !x.hidden).map((x) =>
        '<div class="nav-item ' + (this.page === x.id ? 'active' : '') + '" data-page="' + x.id + '" draggable="true" data-g="' + g + '">'
        + '<span class="ico">' + x.icon + '</span><span class="s-label">' + esc(x.name) + '</span>'
        + '<span class="drag-handle s-label">⠿</span></div>').join('')
    ).join('');
    $$('.nav-item', nav).forEach((item) => {
      item.onclick = () => this.go(item.dataset.page);
      /* 侧栏内直接拖拽排序 */
      item.addEventListener('dragstart', () => { item.classList.add('dragging'); nav.dataset.drag = item.dataset.page; nav.dataset.dragG = item.dataset.g; });
      item.addEventListener('dragend', () => item.classList.remove('dragging'));
      item.addEventListener('dragover', (e) => e.preventDefault());
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromId = nav.dataset.drag, g = nav.dataset.dragG;
        if (!fromId || item.dataset.g !== g || fromId === item.dataset.page) return;
        const list = getNav(g);
        const fi = list.findIndex((x) => x.id === fromId), ti = list.findIndex((x) => x.id === item.dataset.page);
        const [mv] = list.splice(fi, 1); list.splice(ti, 0, mv);
        saveNav(g, list); toast('模块顺序已调整'); this.render();
      });
    });
  },

  renderTop() {
    const mode = ModeCtl.current();
    const pill = $('#modeBtn');
    pill.className = 'mode-pill ' + (mode === 'work' ? 'work' : 'life');
    $('#modeIco').textContent = mode === 'work' ? '🐮' : '🏖️';
    $('#modeTxt').textContent = mode === 'work' ? '牛马模式' : '休假模式';
    const nav = this.allNavItems().find((x) => x.id === this.page);
    $('#pageTitle').textContent = nav ? nav.name : (Views[this.page] && Views[this.page].title) || '工作台';
  },

  toggleTheme() {
    const cur = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = cur;
    DB.setSetting('theme', cur);
    toast(cur === 'light' ? '已切换浅色模式 ☀️' : '已切换深色模式 🌙');
    this.render();
  },

  /* 移动端快捷录入浮钮 */
  renderFab() {
    const mode = ModeCtl.current();
    const menu = $('#fabMenu');
    const items = mode === 'work'
      ? [['💰 快捷记一笔', () => openForm('ledger')], ['✅ 快建待办', () => openForm('todos')], ['🍅 开番茄钟', () => { this.go('pomodoro'); setTimeout(() => { const b = $('#p25'); b && b.click(); }, 120); }], ['🛢️ 记施工井次', () => openForm('dm-workload')], ['🚨 记现场问题', () => openForm('dm-issues')], ['🗄️ 记资料台账', () => openForm('dmDiaopei')]]
      : [['💰 快捷记一笔', () => openForm('ledger')], ['📏 记身高体重', () => openForm('growth')], ['🩺 记健康档案', () => openForm('childhealth')], ['🍚 记一顿饭', () => openForm('meals')]];
    items.push(['🎮 记直播/收益', () => openForm('liveincome')], ['⏳ 加倒数日', () => openForm('countdowns')]);
    menu.innerHTML = items.map((x, i) => '<button class="fab-item" data-f="' + i + '">' + x[0] + '</button>').join('');
    $$('.fab-item', menu).forEach((b) => b.onclick = () => { menu.classList.remove('show'); items[Number(b.dataset.f)][1](); });
  },

  bindChrome() {
    $('#collapseBtn').onclick = () => { $('#sidebar').classList.toggle('collapsed'); $('#main').classList.toggle('collapsed'); };
    $('#menuBtn').onclick = () => { $('#sidebar').classList.add('open'); $('#sideMask').style.display = 'block'; };
    $('#sideMask').onclick = () => { $('#sidebar').classList.remove('open'); $('#sideMask').style.display = 'none'; };
    $('#themeBtn').onclick = () => this.toggleTheme();
    $('#modeBtn').onclick = () => {
      const cur = ModeCtl.current();
      const next = cur === 'work' ? 'life' : 'work';
      if (confirm('切换到' + (next === 'work' ? '「牛马模式」' : '「休假模式」') + '？\n(手动切换后，本轮休假周期内将暂停自动切换)')) ModeCtl.manualSwitch(next);
    };
    $('#notifBtn').onclick = (e) => {
      e.stopPropagation();
      const p = $('#notifPanel');
      if (p.classList.contains('show')) p.classList.remove('show');
      else { Notif.renderPanel(); p.classList.add('show'); }
    };
    document.addEventListener('click', (e) => {
      const p = $('#notifPanel');
      if (p.classList.contains('show') && !p.contains(e.target) && e.target.id !== 'notifBtn') p.classList.remove('show');
    });
    $('#syncBtn').onclick = () => { this.go('settings'); };
    $('#fab').onclick = () => $('#fabMenu').classList.toggle('show');
    document.addEventListener('click', (e) => { if (!$('#fab').contains(e.target) && !$('#fabMenu').contains(e.target)) $('#fabMenu').classList.remove('show'); });
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
