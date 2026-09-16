import type { Aggregate, Filters, Grain, PageId, ParamKey, Preset, Row, Sel } from '@/lib/types';
import { THRESHOLD } from '@/lib/tokens';

/* ═══════════════════════════════════════════════════════════════════════════
   lib/aggregate.ts — toàn bộ toán tổng hợp của dashboard.
   Luật số một: mọi tỷ lệ tính SUM(tử) / SUM(mẫu), KHÔNG lấy trung bình tỷ lệ
   từng ngày (specification.md §8).
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Schema — đúng thứ tự cột A..L của Sheet (specification.md §7) ───────── */
export const COLUMNS = [
  'date', 'channel', 'campaign', 'objective', 'spend', 'impressions', 'clicks',
  'leads', 'qualified_leads', 'conversions', 'revenue', 'campaign_budget',
] as const;

export const SCHEMA: { col: (typeof COLUMNS)[number]; field: keyof Row; type: string; role: string }[] = [
  { col: 'date',            field: 'date',        type: 'date',   role: 'DATE' },
  { col: 'channel',         field: 'channel',     type: 'text',   role: 'PRIMARY_DIM' },
  { col: 'campaign',        field: 'campaign',    type: 'text',   role: 'SECONDARY_DIM' },
  { col: 'objective',       field: 'objective',   type: 'text',   role: 'SECONDARY_DIM' },
  { col: 'spend',           field: 'spend',       type: 'number', role: 'METRIC' },
  { col: 'impressions',     field: 'impressions', type: 'number', role: 'METRIC' },
  { col: 'clicks',          field: 'clicks',      type: 'number', role: 'METRIC' },
  { col: 'leads',           field: 'leads',       type: 'number', role: 'METRIC' },
  { col: 'qualified_leads', field: 'qualified',   type: 'number', role: 'METRIC' },
  { col: 'conversions',     field: 'conversions', type: 'number', role: 'METRIC' },
  { col: 'revenue',         field: 'revenue',     type: 'number', role: 'METRIC' },
  { col: 'campaign_budget', field: 'budget',      type: 'number', role: 'ATTRIBUTE' },
];

/* ── Bốn lựa chọn chỉ số (specification.md §6) ──────────────────────────── */
export const PARAMS: { key: ParamKey; label: string }[] = [
  { key: 'spend',       label: 'Chi phí' },
  { key: 'revenue',     label: 'Doanh thu' },
  { key: 'conversions', label: 'Conversion' },
  { key: 'roas',        label: 'ROAS' },
];
const PARAM_LABEL: Record<ParamKey, string> = {
  spend: 'Chi phí', revenue: 'Doanh thu', conversions: 'Conversion', roas: 'ROAS',
};
export const paramLabel = (p: ParamKey): string => PARAM_LABEL[p];

/** Donut chỉ vẽ chỉ số cộng được; ROAS là tỷ lệ nên vẽ Chi phí (G12). */
export const donutParam = (p: ParamKey): 'spend' | 'revenue' | 'conversions' =>
  p === 'roas' ? 'spend' : p;

/* ── Tổng hợp ────────────────────────────────────────────────────────────── */
const SUMMED = ['spend', 'revenue', 'impressions', 'clicks', 'leads', 'qualified', 'conversions'] as const;
const div = (a: number, b: number): number => (b ? a / b : NaN);

export function agg(rows: Row[]): Aggregate {
  const a = { spend: 0, revenue: 0, impressions: 0, clicks: 0, leads: 0, qualified: 0, conversions: 0 };
  for (const r of rows) for (const k of SUMMED) a[k] += r[k];
  return {
    ...a,
    roas: div(a.revenue, a.spend),
    cpl:  div(a.spend, a.leads),
    cpa:  div(a.spend, a.conversions),
    ctr:  div(a.clicks, a.impressions),
    cpc:  div(a.spend, a.clicks),
    cpm:  div(a.spend * 1000, a.impressions),
  };
}

type Dim = 'channel' | 'campaign' | 'objective';
export type GroupAgg = Aggregate & { key: string };

export function group(rows: Row[], key: Dim): GroupAgg[] {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const list = m.get(r[key]);
    if (list) list.push(r); else m.set(r[key], [r]);
  }
  return [...m.entries()].map(([k, rs]) => ({ key: k, ...agg(rs) }));
}

const orderVal = (v: number): number => (Number.isFinite(v) ? v : -Infinity);
export function rankBy<T extends Aggregate>(list: T[], p: ParamKey): T[] {
  return [...list].sort((a, b) => {
    const x = orderVal(b[p]), y = orderVal(a[p]);
    return x === y ? 0 : x > y ? 1 : -1;
  });
}

export function distinct(rows: Row[], key: Dim): string[] {
  return [...new Set(rows.map((r) => r[key]))].sort((a, b) => a.localeCompare(b, 'vi'));
}

export function campaignObjective(rows: Row[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) if (!m.has(r.campaign)) m.set(r.campaign, r.objective);
  return m;
}

/* ── Ngân sách: ATTRIBUTE — MAX theo chiến dịch, trên TOÀN BỘ dữ liệu (G7) ── */
export type BudgetStat = { spend: number; budget: number; first: number; last: number };   // first/last = chỉ số ngày chạy đầu / cuối

export function budgetStats(allRows: Row[]): Map<string, BudgetStat> {
  const m = new Map<string, BudgetStat>();
  for (const r of allRows) {
    const s = m.get(r.campaign) ?? { spend: 0, budget: 0, first: r.t, last: r.t };
    s.spend += r.spend;
    s.budget = Math.max(s.budget, r.budget);
    s.first = Math.min(s.first, r.t);
    s.last = Math.max(s.last, r.t);
    m.set(r.campaign, s);
  }
  return m;
}

/** % ngân sách = SUM(spend toàn kỳ) / SUM(MAX(campaign_budget)) của các chiến dịch. */
export function budgetPct(stats: Map<string, BudgetStat>, campaigns: Iterable<string>): number {
  let spend = 0, budget = 0;
  for (const c of campaigns) {
    const s = stats.get(c);
    if (s) { spend += s.spend; budget += s.budget; }
  }
  return div(spend, budget);
}

/* ── Lọc ─────────────────────────────────────────────────────────────────── */
export const inSel = (sel: Sel, v: string): boolean => sel === 'all' || sel.includes(v);

export const dimMatch = (r: Row, f: Filters): boolean =>
  inSel(f.channels, r.channel) && inSel(f.campaigns, r.campaign) && inSel(f.objectives, r.objective);

export const applyFilters = (rows: Row[], f: Filters): Row[] =>
  rows.filter((r) => r.t >= f.from && r.t <= f.to && dimMatch(r, f));

export const dateRows = (rows: Row[], f: Filters): Row[] =>
  rows.filter((r) => r.t >= f.from && r.t <= f.to);

/** Kỳ trước = cùng độ dài, liền ngay trước kỳ đang chọn (G13). null nếu dữ liệu không đủ dài. */
export function prevRows(rows: Row[], f: Filters): Row[] | null {
  const len = f.to - f.from + 1;
  const start = f.from - len;
  if (start < 0) return null;
  return rows.filter((r) => r.t >= start && r.t < f.from && dimMatch(r, f));
}

export const PRESETS: { key: Exclude<Preset, 'custom'>; label: string }[] = [
  { key: 7, label: '7 ngày' },
  { key: 30, label: '30 ngày' },
  { key: 90, label: '90 ngày' },
  { key: 'all', label: 'Toàn bộ' },
];

export function presetRange(p: Exclude<Preset, 'custom'>, maxT: number): { from: number; to: number } {
  const to = Math.max(0, maxT);
  return p === 'all' ? { from: 0, to } : { from: Math.max(0, to - p + 1), to };
}

/** Mặc định: ROAS, 30 ngày CUỐI CÙNG TRONG DỮ LIỆU — không tính từ hôm nay (G11, G13). */
export function defaultFilters(maxT: number): Filters {
  return {
    param: 'roas', preset: 30, ...presetRange(30, maxT),
    channels: 'all', campaigns: 'all', objectives: 'all',
  };
}

/** Sau khi đồng bộ lại, giữ bộ lọc nhưng kéo khoảng ngày về trong dữ liệu mới. */
export function clampFilters(f: Filters, maxT: number): Filters {
  if (f.preset !== 'custom') return { ...f, ...presetRange(f.preset, maxT) };
  const to = Math.min(f.to, Math.max(0, maxT));
  return { ...f, from: Math.min(f.from, to), to };
}

export function toggleSel(sel: Sel, all: string[], v: string): Sel {
  const cur = sel === 'all' ? all : sel;
  const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
  return next.length === all.length ? 'all' : next;
}

/* ── Kỳ thời gian ────────────────────────────────────────────────────────── */
export const GRAINS: { key: Grain; label: string }[] = [
  { key: 'day', label: 'Ngày' }, { key: 'week', label: 'Tuần' }, { key: 'month', label: 'Tháng' },
];
export const GRAIN_WORD: Record<Grain, string> = { day: 'ngày', week: 'tuần', month: 'tháng' };

/** Hạt tự động của line trang 2, 3 (G14). */
export const autoGrain = (days: number): Grain => (days <= 31 ? 'day' : days <= 120 ? 'week' : 'month');

function periodKey(iso: string, g: Grain): string {
  if (g === 'day') return iso;
  if (g === 'month') return iso.slice(0, 7);
  // Tính bằng UTC để không lệch ngày theo múi giờ của máy xem
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));   // về thứ hai đầu tuần ISO
  return dt.toISOString().slice(0, 10);
}

const periodLabel = (key: string, g: Grain): string =>
  g === 'month' ? `${key.slice(5, 7)}/${key.slice(0, 4)}` : ddmm(key);

function byGrain(rows: Row[], g: Grain): { label: string; rows: Row[] }[] {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const k = periodKey(r.date, g);
    const list = m.get(k);
    if (list) list.push(r); else m.set(k, [r]);
  }
  return [...m.keys()].sort().map((k) => ({ label: periodLabel(k, g), rows: m.get(k) ?? [] }));
}

const finiteOrNull = (v: number): number | null => (Number.isFinite(v) ? v : null);

export type TrendPoint = { label: string; value: number | null };
export const trend = (rows: Row[], g: Grain, p: ParamKey): TrendPoint[] =>
  byGrain(rows, g).map((b) => ({ label: b.label, value: finiteOrNull(agg(b.rows)[p]) }));

/* ── Xếp hạng, tỷ trọng, nhiều đường ─────────────────────────────────────── */
export type RankItem = { name: string; value: number; roas: number | null };

export const ranking = (rows: Row[], dim: Dim, p: ParamKey, limit = Infinity): RankItem[] =>
  rankBy(group(rows, dim), p)
    .filter((g) => Number.isFinite(g[p]))
    .slice(0, limit)
    .map((g) => ({ name: g.key, value: g[p], roas: finiteOrNull(g.roas) }));

export type Slice = { name: string; value: number; roas: number | null; other: boolean };

/** ≤ 6 nhóm thì vẽ đủ; nhiều hơn thì top 5 + "Khác" (G14). */
export function slices(rows: Row[], dim: Dim, p: 'spend' | 'revenue' | 'conversions'): Slice[] {
  const list = rankBy(group(rows, dim), p).filter((g) => g[p] > 0);
  const toSlice = (g: GroupAgg): Slice => ({ name: g.key, value: g[p], roas: finiteOrNull(g.roas), other: false });
  if (list.length <= 6) return list.map(toSlice);
  const rest = list.slice(5);
  return [
    ...list.slice(0, 5).map(toSlice),
    { name: `Khác (${rest.length})`, value: rest.reduce((s, g) => s + g[p], 0), roas: null, other: true },
  ];
}

export type LineData = {
  series: { key: string; name: string; roas: number | null }[];
  data: Record<string, string | number | null>[];
};

export function multiLine(rows: Row[], dim: Dim, p: ParamKey, g: Grain): LineData {
  const top = ranking(rows, dim, p, 5);
  const series = top.map((s, i) => ({ key: `s${i}`, name: s.name, roas: s.roas }));
  const data = byGrain(rows, g).map((b) => {
    const o: Record<string, string | number | null> = { label: b.label };
    for (const s of series) o[s.key] = finiteOrNull(agg(b.rows.filter((r) => r[dim] === s.name))[p]);
    return o;
  });
  return { series, data };
}

/* ── Ma trận kênh × 8 tuần gần nhất (7 ngày một cột, tính lùi từ ngày cuối kỳ) ── */
export type Matrix = {
  cols: { label: string; title: string }[];
  rows: { key: string; cells: number[] }[];
};

export function weekMatrix(rows: Row[], f: Filters, dates: string[], p: ParamKey): Matrix {
  const scoped = rows.filter((r) => dimMatch(r, f) && r.t <= f.to && r.t > f.to - 56);
  const buckets: { start: number; end: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const end = f.to - i * 7;
    if (end >= 0) buckets.push({ start: Math.max(0, end - 6), end });
  }
  const cols = buckets.map((b) => ({
    label: ddmm(dates[b.start]),
    title: `${ddmm(dates[b.start])} → ${ddmm(dates[b.end])}`,
  }));
  const out = rankBy(group(scoped, 'channel'), p).map((g) => ({
    key: g.key,
    cells: buckets.map((b) =>
      agg(scoped.filter((r) => r.channel === g.key && r.t >= b.start && r.t <= b.end))[p]),
  }));
  return { cols, rows: out };
}

/* ── Bảng chỉ số đầy đủ ──────────────────────────────────────────────────── */
export type MetricRow = { key: string; channel: string; objective: string; a: Aggregate; budgetPct: number };

/**
 * Sắp theo chỉ số đang chọn giảm dần (G28).
 * `allRows` (KHÔNG lọc theo ngày) dùng riêng để suy tập chiến dịch của mỗi nhóm cho
 * `budgetPct` — % ngân sách tính trên toàn bộ dữ liệu chiến dịch, không theo bộ lọc ngày
 * (specification.md §8, G7). Dùng `rows` (đã lọc) ở đây sẽ loại các chiến dịch không còn
 * dòng nào trong kỳ đang chọn khỏi mẫu số/tử số ngân sách của kênh — lỗi im lặng.
 */
export function metricRows(rows: Row[], dim: 'channel' | 'campaign', p: ParamKey,
                           stats: Map<string, BudgetStat>, allRows: Row[]): MetricRow[] {
  return rankBy(group(rows, dim), p).map((g) => {
    const rs = rows.filter((r) => r[dim] === g.key);
    const allRs = allRows.filter((r) => r[dim] === g.key);
    return {
      key: g.key,
      channel: rs[0]?.channel ?? allRs[0]?.channel ?? '',
      objective: rs[0]?.objective ?? allRs[0]?.objective ?? '',
      a: g,
      budgetPct: budgetPct(stats, new Set(allRs.map((r) => r.campaign))),
    };
  });
}

/* ── Cảnh báo (components.md §8) ─────────────────────────────────────────── */
export type Alert = {
  id: string; level: 'bad' | 'warn'; text: string; value: string;
  page: PageId; channel?: string; campaign?: string;
  from?: number; to?: number;   // khoảng ngày chuyển tới khi bấm (G32)
};

export function alerts(rowsInRange: Row[], stats: Map<string, BudgetStat>): Alert[] {
  const out: Alert[] = [];
  for (const g of group(rowsInRange, 'channel')) {
    if (Number.isFinite(g.roas) && g.roas < THRESHOLD.roas)
      out.push({ id: `roas-${g.key}`, level: 'bad', text: `${g.key} đang lỗ`, value: fmtRoas(g.roas), page: 'channel', channel: g.key });
    if (Number.isFinite(g.cpl) && g.cpl > THRESHOLD.cpl)
      out.push({ id: `cpl-${g.key}`, level: 'warn', text: `CPL ${g.key} vượt ngưỡng`, value: fmtMoney(g.cpl), page: 'channel', channel: g.key });
  }
  /* Ngân sách xét MỌI chiến dịch, không theo khoảng ngày (G7, G32). */
  for (const [c, s] of stats) {
    const pct = div(s.spend, s.budget);
    if (Number.isFinite(pct) && pct > THRESHOLD.budget)
      out.push({ id: `budget-${c}`, level: 'warn', text: `${c} — ngân sách đã dùng`, value: fmtPct(pct, 0),
                 page: 'campaign', campaign: c, from: s.first, to: s.last });
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1));
}

/* ── Năm thẻ KPI (specification.md §5) ───────────────────────────────────── */
export const KPI_LABELS = ['Chi phí', 'Doanh thu', 'Conversion', 'CPL', 'ROAS'] as const;
export type Tone = 'ok' | 'warn' | 'bad' | null;
export type KpiModel = {
  value: string; full: string; delta: number | null; inverse: boolean;
  spark: number[]; baseline: number; tone: Tone; note: string;
};

const mean = (v: number[]): number => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN);

/** Giá trị theo từng ngày — tỷ lệ vẫn SUM/SUM trong ngày; ngày không có mẫu số thì bỏ. */
function daily(rows: Row[], pick: (a: Aggregate) => number): number[] {
  const m = new Map<number, Row[]>();
  for (const r of rows) {
    const list = m.get(r.t);
    if (list) list.push(r); else m.set(r.t, [r]);
  }
  return [...m.keys()].sort((a, b) => a - b)
    .map((t) => pick(agg(m.get(t) ?? [])))
    .filter((v) => Number.isFinite(v));
}

function change(now: number, prev: number | null): number | null {
  if (prev == null || !Number.isFinite(now) || !Number.isFinite(prev) || prev === 0) return null;
  return (now - prev) / prev;
}

export function kpiModels(cur: Row[], prev: Row[] | null): KpiModel[] {
  const a = agg(cur);
  const b = prev ? agg(prev) : null;
  const defs: { id: string; pick: (x: Aggregate) => number; inverse: boolean; fmt: (v: number) => string; full: (v: number) => string }[] = [
    { id: 'spend',       pick: (x) => x.spend,       inverse: true,  fmt: fmtShort, full: fmtMoney },
    { id: 'revenue',     pick: (x) => x.revenue,     inverse: false, fmt: fmtShort, full: fmtMoney },
    { id: 'conversions', pick: (x) => x.conversions, inverse: false, fmt: fmtInt,   full: fmtInt },
    { id: 'cpl',         pick: (x) => x.cpl,         inverse: true,  fmt: fmtMoney, full: fmtMoney },
    { id: 'roas',        pick: (x) => x.roas,        inverse: false, fmt: fmtRoas,  full: fmtRoas },
  ];

  return defs.map((d) => {
    const v = d.pick(a);
    const spark = daily(cur, d.pick);
    let baseline = mean(spark);
    let tone: Tone = null;
    let note = `TB kỳ ${d.fmt(baseline)}`;

    if (d.id === 'cpl') {
      const th = THRESHOLD.cpl;
      baseline = th;
      tone = Number.isFinite(v) ? (v > th ? 'bad' : 'ok') : null;
      note = !Number.isFinite(v) ? `ngưỡng ${fmtMoney(th)}`
        : v > th ? `ngưỡng ${fmtMoney(th)} · đang vượt ${fmtMoney(v - th)}`
        : `ngưỡng ${fmtMoney(th)} · còn cách ${fmtMoney(th - v)}`;
    }
    if (d.id === 'roas') {
      const target = THRESHOLD.target;
      baseline = target;
      tone = !Number.isFinite(v) ? null : v < THRESHOLD.roas ? 'bad' : v < target ? 'warn' : 'ok';
      note = !Number.isFinite(v) ? `mục tiêu ${fmtRoas(target)}`
        : v < target ? `mục tiêu ${fmtRoas(target)} · đang thiếu ${fmtRoas(target - v)}`
        : `mục tiêu ${fmtRoas(target)} · đang vượt ${fmtRoas(v - target)}`;
    }

    return {
      value: d.fmt(v), full: d.full(v),
      delta: change(v, b ? d.pick(b) : null),
      inverse: d.inverse, spark,
      baseline: Number.isFinite(baseline) ? baseline : 0,
      tone, note,
    };
  });
}

/* ── Định dạng số — tiếng Việt: chấm hàng nghìn, phẩy thập phân ──────────── */
const nf = (d: number) => new Intl.NumberFormat('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });
const NF0 = nf(0), NF1 = nf(1), NF2 = nf(2);

export const fmtInt = (v: number): string => (Number.isFinite(v) ? NF0.format(v) : '—');
export const fmtMoney = fmtInt;
export function fmtShort(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `${NF2.format(v / 1e9)} tỷ`;
  if (a >= 1e6) return `${NF1.format(v / 1e6)} tr`;
  return NF0.format(v);
}
export const fmtRoas = (v: number): string => (Number.isFinite(v) ? `${NF2.format(v)}x` : '—');
export const fmtPct = (v: number, d = 1): string =>
  Number.isFinite(v) ? `${(d === 0 ? NF0 : d === 2 ? NF2 : NF1).format(v * 100)}%` : '—';

export const fmtParam = (v: number, p: ParamKey): string =>
  p === 'roas' ? fmtRoas(v) : p === 'conversions' ? fmtInt(v) : fmtShort(v);
export const fmtAxis = (v: number, p: ParamKey): string =>
  p === 'roas' ? `${NF1.format(v)}x` : p === 'conversions' ? NF0.format(v) : fmtShort(v);

export const ddmm = (iso?: string): string => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
export const ddmmyyyy = (iso?: string): string => (iso ? `${ddmm(iso)}/${iso.slice(0, 4)}` : '—');

/* ── Giờ Việt Nam (UTC+7) — không theo giờ máy ───────────────────────────── */
const TZ = 'Asia/Ho_Chi_Minh';
const hourVN = (d: Date): number =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(d));

/** Sáng 05–12 · chiều 12–18 · tối 18–05 (G25). */
export function greetVN(d: Date): string {
  const h = hourVN(d);
  return h >= 5 && h < 12 ? 'Chào buổi sáng' : h >= 12 && h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
}
export function todayVN(d: Date): string {
  const s = new Intl.DateTimeFormat('vi-VN', {
    timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export const clockVN = (d: Date): string =>
  new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
