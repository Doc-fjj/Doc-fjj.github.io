/* =========================================================
 * app-schemas.js  数据模型定义 + 导航配置
 * field: {k, l(abel), t(ype: text/number/date/select/textarea/check), opts, req, def}
 * ========================================================= */
'use strict';

/* ---------- 油田动态监测共享选项 ---------- */
const DM_PROJECTS = ['吸水指示曲线', '分层调配', '工程测井', '油水井测压', '吸水剖面', '产出剖面', '示踪剂', '剩余油', '水驱前缘'];
const DM_AREAS = ['安边', '安五', '新安边', '武峁子', '砖井', '学庄', '兴庄'];
const DM_TEAMS = ['西安佳润', '庆阳华宇', '庆阳东祥', '中油测井', '陕西宏博', '陕西金峪', '延安奥维'];
const DM_FAIL = ['道路中断', '井口井筒遇阻', '井下工具', '仪器故障', '交叉作业占井', '液面异常', '取消计划'];
const DM_ISSUE_CATS = ['进度滞后', '设备合规', '吊装安全', '队伍保障', '设计', '原始资料', '报告质量'];
const DM_ISSUE_SUBS = {
  '进度滞后': ['井筒遇阻', '交叉作业干扰', '吊装审批流程繁琐', '作业区未提前备井', '月度计划未分解'],
  '设备合规': ['仪器检验资料缺失', '吊装违章(吊臂站人/监护人缺位)', '队伍安全备案失效'],
  '队伍保障': ['关键岗位人员缺位', '备用设备不足', '合同审批停滞'],
  '设计': ['设计缺陷', '方案不完善'],
  '原始资料': ['设计缺陷', '原始记录缺失', '解释报告滞后', '资料上传超时'],
  '报告质量': ['解释报告滞后', '报告质量不达标'],
  '吊装安全': ['吊装违章', '审批流程缺失']
};

const SCHEMAS = {
  /* ===== 记账(双模式各自隔离, mode 字段区分) ===== */
  ledger: {
    title: '收支记录', icon: '💰', modeScoped: true,
    fields: [
      { k: 'date', l: '日期', t: 'date', req: 1, def: () => todayStr() },
      { k: 'type', l: '收/支', t: 'select', opts: ['支出', '收入'], req: 1 },
      { k: 'amount', l: '金额(元)', t: 'number', req: 1 },
      { k: 'category', l: '分类', t: 'select', opts: (rec) => Ledger.categories(rec && rec.type === '收入' ? '收入' : '支出').concat(['自动识别']) },
      { k: 'account', l: '账户/来源', t: 'select', opts: ['现金', '微信', '支付宝', '银行卡', '其他'] },
      { k: 'note', l: '备注', t: 'text' }
    ],
    cols: ['date', 'type', 'amount', 'category', 'account', 'note']
  },
  /* ===== 工作待办 ===== */
  todos: {
    title: '工作待办', icon: '✅', mode: 'work',
    fields: [
      { k: 'title', l: '任务名称', t: 'text', req: 1 },
      { k: 'priority', l: '优先级', t: 'select', opts: ['P0-紧急', 'P1-重要', 'P2-常规'], def: () => 'P1-重要' },
      { k: 'ttype', l: '任务类型', t: 'select', opts: ['技术方案', '报告', 'PPT', '会议筹备', '日常事务', '其他'] },
      { k: 'date', l: '创建日期', t: 'date', def: () => todayStr() },
      { k: 'deadline', l: '截止日期', t: 'date' },
      { k: 'status', l: '状态', t: 'select', opts: ['待开始', '进行中', '已完成'], def: () => '待开始' },
      { k: 'note', l: '备注', t: 'textarea' }
    ],
    cols: ['title', 'priority', 'ttype', 'deadline', 'status']
  },
  /* ===== 会议 ===== */
  meetings: {
    title: '会议安排', icon: '📅', mode: 'work',
    fields: [
      { k: 'title', l: '会议主题', t: 'text', req: 1 },
      { k: 'date', l: '日期', t: 'date', req: 1, def: () => todayStr() },
      { k: 'time', l: '时间', t: 'text', ph: '如 14:30' },
      { k: 'place', l: '地点/线上', t: 'text' },
      { k: 'prep', l: '需准备材料', t: 'textarea' }
    ],
    cols: ['date', 'time', 'title', 'place']
  },
  /* ===== 番茄/自由时段 ===== */
  pomodoros: {
    title: '专注记录', icon: '🍅', mode: 'work',
    fields: [
      { k: 'date', l: '日期', t: 'date', req: 1, def: () => todayStr() },
      { k: 'ptype', l: '类型', t: 'select', opts: ['番茄钟', '自由时段'] },
      { k: 'minutes', l: '时长(分钟)', t: 'number', req: 1 },
      { k: 'label', l: '专注内容', t: 'text' }
    ],
    cols: ['date', 'ptype', 'minutes', 'label']
  },
  /* ===== 工作进度追踪 ===== */
  progress: {
    title: '进度追踪', icon: '📈', mode: 'work',
    stages: ['选题', '初稿', '修改', '定稿'],
    fields: [
      { k: 'title', l: '项目名称', t: 'text', req: 1 },
      { k: 'ptype', l: '类型', t: 'select', opts: ['技术论文', '演讲稿', '汇报PPT', '技术材料', '其他'] },
      { k: 'stage', l: '当前节点', t: 'select', opts: ['选题', '初稿', '修改', '定稿'], def: () => '选题' },
      { k: 'date', l: '开始日期', t: 'date', def: () => todayStr() },
      { k: 'deadline', l: '目标完成', t: 'date' },
      { k: 'note', l: '备注', t: 'textarea' }
    ],
    cols: ['title', 'ptype', 'stage', 'deadline']
  },
  /* ===== 育儿 ===== */
  growth: {
    title: '身高体重台账', icon: '📏', mode: 'life',
    fields: [
      { k: 'date', l: '日期', t: 'date', req: 1, def: () => todayStr() },
      { k: 'height', l: '身高(cm)', t: 'number' },
      { k: 'weight', l: '体重(kg)', t: 'number' },
      { k: 'note', l: '备注', t: 'text' }
    ],
    cols: ['date', 'height', 'weight', 'note']
  },
  attendance: {
    title: '幼儿园出勤', icon: '🏫', mode: 'life',
    fields: [
      { k: 'date', l: '日期', t: 'date', req: 1, def: () => todayStr() },
      { k: 'status', l: '出勤情况', t: 'select', opts: ['出勤', '请假(事)', '请假(病)', '节假日'], req: 1 },
      { k: 'note', l: '备注', t: 'text' }
    ],
    cols: ['date', 'status', 'note']
  },
  childhealth: {
    title: '儿童健康档案', icon: '🩺', mode: 'life',
    fields: [
      { k: 'date', l: '日期', t: 'date', req: 1, def: () => todayStr() },
      { k: 'htype', l: '类型', t: 'select', opts: ['过敏', '用药', '体检', '忌口', '就诊', '疫苗'], req: 1 },
      { k: 'detail', l: '详情', t: 'textarea', req: 1 },
      { k: 'photo', l: '附件照片', t: 'photo' }
    ],
    cols: ['date', 'htype', 'detail']
  },
  toys: {
    title: '玩具登记', icon: '🧸', mode: 'life',
    fields: [
      { k: 'name', l: '玩具名称', t: 'text', req: 1 },
      { k: 'date', l: '购入日期', t: 'date', def: () => todayStr() },
      { k: 'price', l: '价格(元)', t: 'number' },
      { k: 'status', l: '状态', t: 'select', opts: ['在用', '收纳', '损坏', '送人/处理'] },
      { k: 'note', l: '备注', t: 'text' }
    ],
    cols: ['name', 'date', 'price', 'status']
  },
  /* ===== 家务 ===== */
  chores: {
    title: '家务记录', icon: '🧹', mode: 'life',
    rooms: ['客厅', '主卧', '次卧', '书房', '餐厅', '厨房'],
    fields: [
      { k: 'date', l: '日期', t: 'date', req: 1, def: () => todayStr() },
      { k: 'room', l: '分区', t: 'select', opts: ['客厅', '主卧', '次卧', '书房', '餐厅', '厨房'], req: 1 },
      { k: 'task', l: '家务项', t: 'select', opts: ['扫地', '拖地', '除尘', '整理收纳', '其他'], req: 1 },
      { k: 'done', l: '状态', t: 'select', opts: ['完成', '未完成'], def: () => '完成' },
      { k: 'note', l: '备注', t: 'text' }
    ],
    cols: ['date', 'room', 'task', 'done']
  },
  choreplans: {
    title: '循环提醒计划', icon: '🔁', mode: 'life',
    fields: [
      { k: 'room', l: '分区', t: 'select', opts: ['客厅', '主卧', '次卧', '书房', '餐厅', '厨房'], req: 1 },
      { k: 'task', l: '家务项', t: 'select', opts: ['扫地', '拖地', '除尘', '整理收纳', '其他'], req: 1 },
      { k: 'intervalDays', l: '每隔几天提醒', t: 'number', req: 1, def: () => 3 }
    ],
    cols: ['room', 'task', 'intervalDays']
  },
  /* ===== 烹饪: 常用菜品库(供规划页快速选择) ===== */
  dishes: {
    title: '常用菜品库', icon: '🍲', mode: 'life',
    fields: [
      { k: 'name', l: '菜品名称', t: 'text', req: 1 },
      { k: 'tags', l: '标签', t: 'text', ph: '如 早餐/快手/孩子爱吃/硬菜' },
      { k: 'note', l: '做法/备注', t: 'textarea' }
    ],
    cols: ['name', 'tags', 'note']
  },
  /* ===== 三餐&健康 ===== */
  meals: {
    title: '饮食记录', icon: '🍚', mode: 'life',
    fields: [
      { k: 'date', l: '日期', t: 'date', req: 1, def: () => todayStr() },
      { k: 'meal', l: '餐次', t: 'select', opts: ['早餐', '午餐', '晚餐', '加餐'], req: 1 },
      { k: 'food', l: '饮食内容', t: 'text', req: 1 },
      { k: 'note', l: '备注(忌口/感受)', t: 'text' }
    ],
    cols: ['date', 'meal', 'food', 'note']
  },
  bodylog: {
    title: '体质日志', icon: '🌡️', mode: 'life',
    fields: [
      { k: 'date', l: '日期', t: 'date', req: 1, def: () => todayStr() },
      { k: 'state', l: '整体状态', t: 'select', opts: ['很好', '一般', '疲惫', '不适'] },
      { k: 'symptom', l: '症状/体感', t: 'text', ph: '如 咽部不适、结节区域感受等' },
      { k: 'note', l: '记录', t: 'textarea' }
    ],
    cols: ['date', 'state', 'symptom']
  },
  therapy: {
    title: '食疗/艾灸记录', icon: '🫖', mode: 'life',
    fields: [
      { k: 'date', l: '日期', t: 'date', req: 1, def: () => todayStr() },
      { k: 'ttype', l: '类型', t: 'select', opts: ['食疗', '艾灸', '中药调理', '运动', '其他'], req: 1 },
      { k: 'detail', l: '内容', t: 'text', req: 1, ph: '如 陈皮山楂茶 / 艾灸足三里' },
      { k: 'minutes', l: '时长(分钟)', t: 'number' },
      { k: 'note', l: '感受/备注', t: 'text' }
    ],
    cols: ['date', 'ttype', 'detail', 'minutes']
  },
  /* ===== 阅读 ===== */
  books: {
    title: '书单', icon: '📚', mode: 'life',
    fields: [
      { k: 'title', l: '书名', t: 'text', req: 1 },
      { k: 'author', l: '作者', t: 'text' },
      { k: 'total', l: '总页数', t: 'number' },
      { k: 'current', l: '当前页数', t: 'number', def: () => 0 },
      { k: 'status', l: '状态', t: 'select', opts: ['想读', '在读', '已读完', '弃读'], def: () => '想读' },
      { k: 'date', l: '加入日期', t: 'date', def: () => todayStr() }
    ],
    cols: ['title', 'author', 'status', 'current', 'total']
  },
  readnotes: {
    title: '读书笔记', icon: '📝', mode: 'life',
    fields: [
      { k: 'date', l: '日期', t: 'date', req: 1, def: () => todayStr() },
      { k: 'book', l: '书名', t: 'text', req: 1 },
      { k: 'note', l: '笔记内容', t: 'textarea', req: 1 }
    ],
    cols: ['date', 'book', 'note']
  },
  /* ===== 出行 ===== */
  trips: {
    title: '旅行行程', icon: '✈️', mode: 'life',
    fields: [
      { k: 'name', l: '行程名称', t: 'text', req: 1 },
      { k: 'date', l: '出发日期', t: 'date', req: 1 },
      { k: 'endDate', l: '返回日期', t: 'date' },
      { k: 'status', l: '状态', t: 'select', opts: ['规划中', '已订票', '进行中', '已完成'], def: () => '规划中' },
      { k: 'note', l: '行程概要', t: 'textarea' }
    ],
    cols: ['name', 'date', 'endDate', 'status']
  },
  tripinfo: {
    title: '票务/酒店', icon: '🎫', mode: 'life',
    fields: [
      { k: 'trip', l: '所属行程', t: 'text', req: 1 },
      { k: 'itype', l: '类型', t: 'select', opts: ['机票', '火车票', '酒店', '门票', '租车', '其他'], req: 1 },
      { k: 'date', l: '日期', t: 'date' },
      { k: 'detail', l: '信息(航班号/酒店名/订单号)', t: 'textarea', req: 1 },
      { k: 'cost', l: '费用(元)', t: 'number' },
      { k: 'photo', l: '票据照片', t: 'photo' }
    ],
    cols: ['trip', 'itype', 'date', 'detail', 'cost']
  },
  packing: {
    title: '出行物品清单', icon: '🎒', mode: 'life',
    fields: [
      { k: 'trip', l: '所属行程', t: 'text', req: 1 },
      { k: 'item', l: '物品', t: 'text', req: 1 },
      { k: 'packed', l: '状态', t: 'select', opts: ['未装', '已装'], def: () => '未装' }
    ],
    cols: ['trip', 'item', 'packed']
  },
  /* ===== 兼职 - 直播 ===== */
  livehours: {
    title: '直播时长台账', icon: '🎮', global: true,
    fields: [
      { k: 'date', l: '日期', t: 'date', req: 1, def: () => todayStr() },
      { k: 'start', l: '开播时间', t: 'text', ph: '如 20:00' },
      { k: 'hours', l: '时长(小时)', t: 'number', req: 1 },
      { k: 'topic', l: '直播内容', t: 'text' }
    ],
    cols: ['date', 'start', 'hours', 'topic']
  },
  liveincome: {
    title: '直播收益台账', icon: '💵', global: true,
    fields: [
      { k: 'date', l: '日期', t: 'date', req: 1, def: () => todayStr() },
      { k: 'platform', l: '平台', t: 'text' },
      { k: 'gross', l: '税前(元)', t: 'number', req: 1 },
      { k: 'net', l: '税后(元)', t: 'number' },
      { k: 'note', l: '备注', t: 'text' }
    ],
    cols: ['date', 'platform', 'gross', 'net', 'note']
  },
  livetopics: {
    title: '直播选题备忘', icon: '💡', global: true,
    fields: [
      { k: 'topic', l: '选题', t: 'text', req: 1 },
      { k: 'status', l: '状态', t: 'select', opts: ['备选', '已排期', '已播', '放弃'], def: () => '备选' },
      { k: 'date', l: '计划日期', t: 'date' },
      { k: 'note', l: '备注', t: 'text' }
    ],
    cols: ['topic', 'status', 'date', 'note']
  },
  /* ===== 兼职 - 小说 ===== */
  inspirations: {
    title: '灵感标签库', icon: '✨', global: true,
    fields: [
      { k: 'date', l: '日期', t: 'date', def: () => todayStr() },
      { k: 'tags', l: '标签', t: 'text', req: 1, ph: '如 重生/追妻/团宠, 用/分隔' },
      { k: 'content', l: '灵感内容', t: 'textarea', req: 1 }
    ],
    cols: ['date', 'tags', 'content']
  },
  tropes: {
    title: '女频爆点素材库', icon: '🔥', global: true,
    fields: [
      { k: 'title', l: '素材标题', t: 'text', req: 1 },
      { k: 'ttype', l: '类型', t: 'select', opts: ['开篇钩子', '打脸名场面', '情感爆点', '误会反转', '身份揭露', '金句', '其他'] },
      { k: 'content', l: '素材内容/热度摘要', t: 'textarea', req: 1 },
      { k: 'heat', l: '热度值', t: 'number', def: () => 0, ph: '抖音热度指数（自动获取或手动填写）' },
      { k: 'date', l: '收录日期', t: 'date', def: () => todayStr() },
      { k: 'source', l: '数据来源', t: 'select', opts: ['手动录入', '抖音热榜', '其他'], def: () => '手动录入' }
    ],
    cols: ['title', 'ttype', 'heat', 'content', 'source']
  },
  novelprogress: {
    title: '写作进度', icon: '✍️', global: true,
    fields: [
      { k: 'date', l: '日期', t: 'date', req: 1, def: () => todayStr() },
      { k: 'work', l: '作品名', t: 'text', req: 1 },
      { k: 'words', l: '当日码字(字)', t: 'number' },
      { k: 'stock', l: '存稿(章)', t: 'number' },
      { k: 'milestone', l: '节点', t: 'select', opts: ['日常更新', '开新书', '投稿', '签约', '上架', '完结'], def: () => '日常更新' },
      { k: 'note', l: '备注', t: 'text' }
    ],
    cols: ['date', 'work', 'words', 'stock', 'milestone']
  },
  sideincome: {
    title: '兼职收益汇总', icon: '🪙', global: true,
    fields: [
      { k: 'date', l: '日期', t: 'date', req: 1, def: () => todayStr() },
      { k: 'source', l: '来源', t: 'select', opts: ['游戏直播', '小说稿费', '其他兼职'], req: 1 },
      { k: 'amount', l: '金额(元)', t: 'number', req: 1 },
      { k: 'note', l: '备注', t: 'text' }
    ],
    cols: ['date', 'source', 'amount', 'note']
  },
  sidereminds: {
    title: '兼职提醒', icon: '⏰', global: true,
    fields: [
      { k: 'title', l: '提醒事项', t: 'text', req: 1 },
      { k: 'type', l: '类型', t: 'select', opts: ['直播计划', '小说更新', '投稿截止', '其他'], req: 1 },
      { k: 'date', l: '提醒日期', t: 'date', req: 1 },
      { k: 'done', l: '已完成', t: 'check' }
    ],
    cols: ['title', 'type', 'date', 'done']
  },
  /* ===== 倒数日 ===== */
  countdowns: {
    title: '倒数日', icon: '⏳', global: true,
    fields: [
      { k: 'title', l: '事项名称', t: 'text', req: 1 },
      { k: 'tag', l: '标签', t: 'select', opts: [['work', '工作事项'], ['vacation', '休假日程'], ['anniversary', '重点纪念日']], req: 1 },
      { k: 'date', l: '目标/休假开始日期', t: 'date', req: 1 },
      { k: 'endDate', l: '休假结束日期(休假必填)', t: 'date' },
      { k: 'birthday', l: '生日(纪念日填)', t: 'date', ph: '重点纪念日填写，用于生日礼物建议' },
      { k: 'who', l: '关系', t: 'select', opts: ['自己', '伴侣', '孩子', '父母', '朋友', '同事', '其他'], ph: '用于个性化礼物建议' },
      { k: 'yearly', l: '年度循环', t: 'check' },
      { k: 'remind', l: '开启提醒', t: 'check', def: () => true },
      { k: 'note', l: '文字备注', t: 'textarea' }
    ],
    cols: ['title', 'tag', 'date', 'endDate']
  },
  /* ===== 动态监测1: 施工工作量统计台账 ===== */
  'dm-workload': {
    title: '施工工作量台账', icon: '🛢️',
    fields: [
      { k: 'planDate', l: '计划日期', t: 'date', ph: '对应Excel「计划下达时间」列（计划下发日期）' },
      { k: 'date', l: '开始日期', t: 'date', req: 1, def: () => todayStr(), ph: '对应Excel「开始日期」列（实际开工日期）' },
      { k: 'endDate', l: '结束日期', t: 'date', ph: '留空=测试进行中；填「未完成」=测试失败井' },
      { k: 'wellNo', l: '井号', t: 'text', ph: '对应Excel「井号」列' },
      { k: 'project', l: '测试项目/作业内容', t: 'text', req: 1, ph: '对应Excel「作业内容」列' },
      { k: 'area', l: '作业区', t: 'select', opts: DM_AREAS, req: 1 },
      { k: 'team', l: '施工承包商队伍', t: 'select', opts: DM_TEAMS, req: 1, ph: '对应Excel「技术服务公司」列' },
      { k: 'subTeam', l: '测试小队名称', t: 'text', ph: '对应Excel「测试小队名称」列' },
      { k: 'completed', l: '上井次数', t: 'number', req: 1, def: () => 0, ph: '对应Excel「上井次数」列' },
      { k: 'failed', l: '失败井次', t: 'number', def: () => 0 },
      { k: 'failReason', l: '失败原因', t: 'text', ph: '抓取Excel「备注」列关键字' },
      { k: 'contractAmount', l: '合同履约金额(元)', t: 'number', def: () => 0, ph: '对应Excel「结算金额（元）」列' },
      { k: 'status', l: '测试状态', t: 'select', opts: ['完成', '进行中', '失败', '未开工'], def: () => '完成' },
      { k: 'offlineDesign', l: '线下吸水剖面设计单数量', t: 'number', def: () => 0 },
      { k: 'selfTest', l: '作业区自测井次', t: 'number', def: () => 0 },
      { k: 'note', l: '备注', t: 'text' }
    ],
    cols: ['planDate', 'date', 'wellNo', 'project', 'area', 'team', 'subTeam', 'completed', 'endDate', 'failed', 'failReason', 'contractAmount', 'status', 'note']
  },
  /* ===== 动态监测2: 问题闭环台账 ===== */
  'dm-issues': {
    title: '问题闭环台账', icon: '🚨',
    fields: [
      { k: 'title', l: '问题描述', t: 'text', req: 1 },
      { k: 'biz', l: '业务类别', t: 'text', ph: '产品 / 地面工程 / 井筒工程 / 油维工程（导入自质量表）' },
      { k: 'category', l: '问题大类', t: 'select', opts: DM_ISSUE_CATS, ph: '手动新增时选择' },
      { k: 'subType', l: '细分问题', t: 'select', opts: (r) => DM_ISSUE_SUBS[r && r.category] || [] },
      { k: 'qualityCat', l: '质量问题类别', t: 'text', ph: '如 施工设计质量 / 采购产品质量（导入自质量表）' },
      { k: 'project', l: '工程名称/产品', t: 'text' },
      { k: 'checkUnit', l: '检查单位', t: 'text' },
      { k: 'riskLevel', l: '风险等级', t: 'select', opts: ['一般', '重点', '紧急'], req: 1, def: () => '一般' },
      { k: 'area', l: '责任作业区', t: 'select', opts: DM_AREAS },
      { k: 'team', l: '责任单位/施工队伍', t: 'text', ph: '对应质量表「责任单位 / 被处理单位」' },
      { k: 'owner', l: '责任人/落实人', t: 'text' },
      { k: 'date', l: '检查日期', t: 'date', req: 1, def: () => todayStr() },
      { k: 'deadline', l: '整改期限', t: 'date' },
      { k: 'status', l: '闭环状态', t: 'select', opts: ['未整改', '整改中', '已闭环', '要求复测'], req: 1, def: () => '未整改' },
      { k: 'photo', l: '现场/整改照片', t: 'photo' },
      { k: 'rectifyNote', l: '整改/问责记录', t: 'textarea' },
      { k: 'note', l: '备注/原因分析', t: 'text' }
    ],
    cols: ['date', 'title', 'biz', 'category', 'subType', 'qualityCat', 'riskLevel', 'status', 'team', 'owner', 'deadline']
  },
  /* ===== 动态监测2.5: 测压计划完成情况(井记录, 可手动新增) ===== */
  'dmCeyaPlan': {
    title: '测压计划井记录', icon: '🛢️',
    fields: [
      { k: 'well', l: '井号', t: 'text', req: 1, ph: '对应Excel「井号」列' },
      { k: 'category', l: '类别', t: 'text', ph: '如 开发试井' },
      { k: 'monitorItem', l: '监测项目', t: 'text', ph: '如 油井分层测试 / 不稳定试井' },
      { k: 'workContent', l: '作业内容', t: 'text', ph: '如 不停井分层测压 / 二流量试井 / 提泵测压' },
      { k: 'company', l: '技术服务公司', t: 'text', ph: '对应Excel「技术服务公司」列' },
      { k: 'team', l: '测试小队名称', t: 'text', ph: '对应Excel「测试小队名称」列' },
      { k: 'planDate', l: '计划下达时间', t: 'date', ph: '对应Excel「计划下达时间」列' },
      { k: 'startDate', l: '开始日期', t: 'date', ph: '对应Excel「开始日期」列' },
      { k: 'endDate', l: '结束日期', t: 'date', ph: '对应Excel「结束日期」列' },
      { k: 'trips', l: '上井次数', t: 'number', def: () => 0 },
      { k: 'emptyRuns', l: '空跑次数', t: 'number', def: () => 0 },
      { k: 'wellType', l: '井别', t: 'text', ph: '如 采油井' },
      { k: 'area', l: '作业区', t: 'select', opts: DM_AREAS },
      { k: 'block', l: '区块', t: 'text' },
      { k: 'note', l: '备注', t: 'text' }
    ],
    cols: ['planDate', 'well', 'category', 'monitorItem', 'workContent', 'company', 'team', 'startDate', 'endDate', 'trips', 'emptyRuns', 'wellType', 'area', 'block', 'note']
  },
  /* ===== 动态监测3: 系统资料录入管控(子表) ===== */
  'dmDbProgress': {
    title: '数据库进度登记', icon: '📊',
    fields: [
      { k: 'well', l: '井号', t: 'text', req: 1 },
      { k: 'tech', l: '监测技术', t: 'text', ph: '对应Excel「监测技术」列' },
      { k: 'team', l: '测试小队', t: 'text', ph: '对应Excel「测试单位小队」列' },
      { k: 'testDate', l: '测试日期', t: 'date', ph: '对应Excel「测试日期」列' },
      { k: 'finishDate', l: '完工日期', t: 'date', ph: '对应Excel「完工日期」列' },
      { k: 'status', l: '当前状态', t: 'select', opts: ['已完成', '正在进行', '失败', '待开工', '其他'], def: () => '已完成' },
      { k: 'uploadDate', l: '资料上传日期', t: 'date', ph: '对应Excel「资料上传日期」列' },
      { k: 'dbStatus', l: '库内状态', t: 'text', ph: '对应Excel「TRACESTATUS」列' },
      { k: 'note', l: '备注', t: 'text' }
    ],
    cols: ['well', 'tech', 'team', 'testDate', 'finishDate', 'status', 'uploadDate', 'dbStatus', 'note']
  },
  'dmDiaopei': {
    title: '调配资料台账', icon: '🔀',
    fields: [
      { k: 'well', l: '井号', t: 'text', req: 1 },
      { k: 'count', l: '待审核调配井数量', t: 'number', def: () => 1 },
      { k: 'due', l: '计划上传截止日期', t: 'date', req: 1 },
      { k: 'uploaded', l: '已上传', t: 'check' },
      { k: 'note', l: '备注', t: 'text' }
    ],
    cols: ['well', 'count', 'due', 'uploaded', 'note']
  },
  'dmCeya': {
    title: '待起设备测压井', icon: '🛢️',
    fields: [
      { k: 'well', l: '井号', t: 'text', req: 1 },
      { k: 'expectDate', l: '预计起设备时间', t: 'date' },
      { k: 'uploadNode', l: '报告上传节点', t: 'text' },
      { k: 'note', l: '备注', t: 'text' }
    ],
    cols: ['well', 'expectDate', 'uploadNode', 'note']
  },
  'dmExpl': {
    title: '解释报告督办', icon: '📑',
    fields: [
      { k: 'unit', l: '报告单位', t: 'select', opts: ['中油测井', '其他'], req: 1 },
      { k: 'well', l: '井号/项目', t: 'text', req: 1 },
      { k: 'assignDate', l: '派发/登记日期', t: 'date', req: 1, def: () => todayStr() },
      { k: 'uploaded', l: '已上传报告', t: 'check' },
      { k: 'note', l: '备注', t: 'text' }
    ],
    cols: ['unit', 'well', 'assignDate', 'uploaded', 'note']
  },
  'dmMemo': {
    title: '系统操作备忘', icon: '📝',
    fields: [
      { k: 'date', l: '日期', t: 'date', req: 1, def: () => todayStr() },
      { k: 'title', l: '节点/主题', t: 'text', req: 1 },
      { k: 'content', l: '规则说明/核对记录', t: 'textarea', req: 1 }
    ],
    cols: ['date', 'title', 'content']
  }
};

/* ---------- 导航配置(支持拖拽排序/重命名/隐藏, 存settings) ---------- */
const NAV_DEF = {
  work: [
    { id: 'dash-work', name: '今日工作仪表盘', icon: '🐮' },
    { id: 'ledger', name: '智能记账', icon: '💰' },
    { id: 'todos', name: '工作待办&日程', icon: '✅' },
    { id: 'pomodoro', name: '番茄专注计时', icon: '🍅' },
    { id: 'progress', name: '工作进度追踪', icon: '📈' },
    { id: 'dm-workload', name: '动态监测施工量台账', icon: '🛢️' },
    { id: 'dm-workload', name: '动态监测施工量台账', icon: '🛢️' },
    { id: 'dm-issues', name: '动态监测问题闭环', icon: '🚨' },
    { id: 'dm-ceya-plan', name: '测压计划完成情况', icon: '🛢️' },
    { id: 'dm-data', name: '动态监测资料管控', icon: '🗄️' },
    { id: 'dm-report', name: '动态监测月报看板', icon: '📋' }
  ],
  life: [
    { id: 'dash-life', name: '休假总览仪表盘', icon: '🏖️' },
    { id: 'parenting', name: '育儿模块', icon: '🧒' },
    { id: 'chores', name: '分区家务管理', icon: '🧹' },
    { id: 'health', name: '三餐&健康管理', icon: '🥗' },
    { id: 'reading', name: '阅读打卡', icon: '📚' },
    { id: 'travel', name: '家庭出行规划', icon: '✈️' },
    { id: 'ledger', name: '家庭记账', icon: '💰' }
  ],
  global: [
    { id: 'sidejob', name: '兼职模块', icon: '🎮' },
    { id: 'countdown', name: '倒数日', icon: '⏳' },
    { id: 'settings', name: '设置', icon: '⚙️' }
  ]
};

function getNav(group) {
  const saved = DB.setting('nav_' + group, null);
  const def = NAV_DEF[group];
  if (!saved) return def.map((d) => Object.assign({ hidden: false }, d));
  /* 按保存的顺序/名称/隐藏合并, 补充新增模块 */
  const out = [];
  saved.forEach((s) => { const d = def.find((x) => x.id === s.id); if (d) out.push(Object.assign({}, d, s)); });
  def.forEach((d) => { if (!out.some((x) => x.id === d.id)) out.push(Object.assign({ hidden: false }, d)); });
  return out;
}
function saveNav(group, list) {
  DB.setSetting('nav_' + group, list.map((x) => ({ id: x.id, name: x.name, hidden: !!x.hidden })));
}
