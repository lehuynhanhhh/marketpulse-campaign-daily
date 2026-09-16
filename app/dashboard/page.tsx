'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Shell } from '@/components/Shell';
import { Sidebar, PAGES } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { GreetBar, type FilterChip } from '@/components/GreetBar';
import { KpiCard } from '@/components/KpiCard';
import { ChartCard, CardState } from '@/components/ChartCard';
import { Legend } from '@/components/Legend';
import { FilterDrawer } from '@/components/FilterDrawer';
import { ExportModal } from '@/components/ExportModal';
import { Toast } from '@/components/Toast';
import { Icon, channelIcon } from '@/components/Icon';
import { DonutChart, sliceColor } from '@/components/charts/DonutChart';
import { TrendAreaChart } from '@/components/charts/TrendAreaChart';
import { MultiLineChart } from '@/components/charts/MultiLineChart';
import { RankBarChart } from '@/components/charts/RankBarChart';
import { MatrixTable } from '@/components/charts/MatrixTable';
import { layout, seriesColor, LGD1, LGD2, SIDE_RAIL, SIDE_WIDE, THRESHOLD } from '@/lib/tokens';
import * as A from '@/lib/aggregate';
import type { DataPayload, Filters, Grain, PageId, Row, Sel } from '@/lib/types';

/* Trang này CHỈ giữ state + bố cục. Toán tổng hợp ở lib/aggregate.ts, JSX chart ở components/charts. */

type LoadState = 'loading' | 'error' | 'ready';
type Region = 'loading' | 'error' | 'empty' | 'ready';
type Dim = 'channel' | 'campaign';

const NO_ROWS: Row[] = [];
const NO_DATES: string[] = [];
const ENV_VARS = ['GOOGLE_SHEETS_SPREADSHEET_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY'];
const AUTO_SYNC_MS = 30_000;   // auto-refresh — người dùng chọn 30 giây
const BAD: CSSProperties = { color: 'var(--bad)', fontWeight: 600 };
const WARN: CSSProperties = { color: 'var(--warn)', fontWeight: 600 };
const LEFT: CSSProperties = { textAlign: 'left' };

/** Nhóm đang lỗ: thêm chữ "(lỗ)" sau tên trong legend — màu --bad không đứng một mình (G35). */
const lossName = (name: string, roas: number | null): string =>
  roas != null && roas < THRESHOLD.roas ? `${name} (lỗ)` : name;

type LoadResult = { ok: true; json: DataPayload } | { ok: false; message: string };

/** Chỉ gọi route của chính app — client không bao giờ chạm credential. */
async function fetchData(): Promise<LoadResult> {
  try {
    const res = await fetch('/api/data', { cache: 'no-store' });
    const json = (await res.json()) as DataPayload;
    if (!res.ok || json.error) return { ok: false, message: json.error ?? `Máy chủ trả mã ${res.status}` };
    return { ok: true, json };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Lỗi không xác định' };
  }
}

export default function DashboardPage() {
  const [data, setData] = useState<DataPayload | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(true);
  const [filters, setFilters] = useState<Filters | null>(null);
  const [page, setPage] = useState<PageId>('home');
  const [grain, setGrain] = useState<Grain>('week');
  const [rail, setRail] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [drawer, setDrawer] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const busyRef = useRef(false);       // chặn hai lượt fetch chồng nhau (thủ công lẫn tự động)
  const mountedRef = useRef(true);
  const fpRef = useRef('');            // "dấu vân tay" rẻ tiền của lần đọc trước, để biết auto-refresh có đổi gì không
  /* setup PHẢI đặt lại true, không chỉ cleanup đặt false — React Strict Mode (dev) chạy
     setup → cleanup → setup cho mọi effect ngay sau mount. Effect chỉ có cleanup (không setup)
     sẽ kẹt mountedRef ở false vĩnh viễn sau lượt "cleanup" giả lập đó ⇒ apply() luôn return
     sớm ⇒ syncing/loading không bao giờ tắt, busyRef không bao giờ được mở lại — dashboard
     treo mãi ở "Đang tải…", nút Đồng bộ bấm không phản hồi (đã xảy ra thật, chỉ ở dev). */
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /* Ghi kết quả đọc dữ liệu vào state — chỉ gọi trong callback, không gọi thẳng trong effect.
     silent=true (auto-refresh nền): giữ nguyên dữ liệu cũ trên màn nếu lỗi, không set state='error';
     có dữ liệu mới thật sự (khác lần trước) thì báo bằng toast thay vì đổi cả layout. */
  const apply = useCallback((r: LoadResult, silent: boolean) => {
    if (!mountedRef.current) return;
    if (r.ok) {
      const maxT = r.json.dates.length - 1;
      const fp = `${r.json.count}|${r.json.dates[maxT] ?? ''}`;
      const changed = fpRef.current !== '' && fpRef.current !== fp;
      fpRef.current = fp;
      setData(r.json);
      setFilters((f) => (f ? A.clampFilters(f, maxT) : A.defaultFilters(maxT)));
      setState('ready');
      if (silent && changed) setToast('Vừa cập nhật dữ liệu mới');
    } else if (!silent) {
      setError(r.message);
      setState('error');
    }
    // silent + lỗi: bỏ qua, giữ nguyên dữ liệu đang hiển thị — một lượt tự động trục trặc
    // không nên biến cả dashboard thành màn lỗi khi dữ liệu cũ vẫn còn dùng được.
    setSyncing(false);
    busyRef.current = false;
  }, []);

  /**
   * mode='blocking': bấm nút Đồng bộ — cập nhật ngay, đưa mọi vùng dữ liệu về trạng thái đang tải
   * (components.md §13). mode='silent': tick tự động — giữ nguyên chart đang hiển thị, chỉ xoay icon.
   * Đang có một lượt chạy thì bỏ qua lượt mới (không chồng request).
   */
  const runFetch = useCallback((mode: 'blocking' | 'silent') => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSyncing(true);
    if (mode === 'blocking') setState('loading');
    void fetchData().then((r) => apply(r, mode === 'silent'));
  }, [apply]);

  /* Fetch MỘT lần khi mount; mọi thao tác lọc chạy trên mảng đã có trong bộ nhớ.
     Không gọi runFetch() ở đây: nó setState đồng bộ trong thân effect (bị chặn bởi
     react-hooks/set-state-in-effect) — với lần đầu, giá trị khởi tạo của state/syncing
     đã đúng là 'loading'/true rồi nên không cần set lại, chỉ cần khoá busyRef và fetch. */
  useEffect(() => {
    busyRef.current = true;
    void fetchData().then((r) => apply(r, false));
  }, [apply]);

  /* Auto-refresh mỗi 30 giây, chỉ khi tab đang xem (Page Visibility API) — tab ẩn thì bỏ lượt đó,
     tránh tốn quota Google Sheets cho tab không ai nhìn. Không tự refresh trong lúc bảng xuất dữ liệu
     đang mở, để không đổi tập dòng dưới chân người dùng giữa lúc họ đang xem "Sẽ xuất n dòng". */
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (exporting) return;
      runFetch('silent');
    }, AUTO_SYNC_MS);
    return () => clearInterval(id);
  }, [runFetch, exporting]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const retry = () => runFetch('blocking');
  /* Đồng bộ: mọi vùng dữ liệu về trạng thái đang tải trong lúc đọc lại Sheet (components.md §13). */
  const resync = retry;

  const L = useMemo(() => layout(rail ? SIDE_RAIL : SIDE_WIDE), [rail]);
  const rows = data?.rows ?? NO_ROWS;
  const dates = data?.dates ?? NO_DATES;
  const f = useMemo(() => filters ?? A.defaultFilters(0), [filters]);
  const ready = state === 'ready' && filters !== null;

  const cur = useMemo(() => (ready ? A.applyFilters(rows, f) : NO_ROWS), [ready, rows, f]);
  const stats = useMemo(() => A.budgetStats(rows), [rows]);
  const kpis = useMemo(() => (ready ? A.kpiModels(cur, A.prevRows(rows, f)) : null), [ready, cur, rows, f]);
  const alerts = useMemo(() => (ready ? A.alerts(A.dateRows(rows, f), stats) : []), [ready, rows, f, stats]);

  const region: Region = state !== 'ready' ? state : cur.length ? 'ready' : 'empty';
  const P = f.param;
  const PL = A.paramLabel(P);
  const fmt = (v: number) => A.fmtParam(v, P);
  const axis = (v: number) => A.fmtAxis(v, P);
  const days = f.to - f.from + 1;

  const setF = (patch: Partial<Filters>) => setFilters((x) => (x ? { ...x, ...patch } : x));

  /* Bấm donut / bar ở trang 1: lọc ngay, hiện thành chip; bấm lại cùng nhóm là bỏ (G29). */
  const pickOnly = (key: 'channels' | 'campaigns', name: string) => setFilters((x) => {
    if (!x) return x;
    const s = x[key];
    const next: Sel = s !== 'all' && s.length === 1 && s[0] === name ? 'all' : [name];
    return key === 'channels' ? { ...x, channels: next } : { ...x, campaigns: next };
  });

  /* Chip bộ lọc đang áp ở thanh chào — × bỏ ngay (G29). */
  const chips: FilterChip[] = [];
  const addChip = (key: string, label: string, sel: Sel, unit: string, clear: () => void) => {
    if (sel === 'all') return;
    const value = sel.length === 0 ? 'không chọn' : sel.length <= 2 ? sel.join(', ') : `${sel.length} ${unit}`;
    chips.push({ key, label, value, onRemove: clear });
  };
  if (filters) {
    addChip('ch', 'Kênh', filters.channels, 'kênh', () => setF({ channels: 'all' }));
    addChip('cp', 'Chiến dịch', filters.campaigns, 'chiến dịch', () => setF({ campaigns: 'all' }));
    addChip('ob', 'Mục tiêu', filters.objectives, 'mục tiêu', () => setF({ objectives: 'all' }));
  }
  const clearDims = () => setF({ channels: 'all', campaigns: 'all', objectives: 'all' });

  const context = page === 'source'
    ? 'Trang này không áp bộ lọc'
    : ready && dates.length ? `Kỳ ${A.ddmm(dates[f.from])} → ${A.ddmmyyyy(dates[f.to])} · ${days} ngày` : '';

  /* Cảnh báo: lọc sẵn nhóm vượt ngưỡng rồi nhảy trang (components.md §8). */
  const onAlert = (a: A.Alert) => {
    const range = a.from != null && a.to != null ? { preset: 'custom' as const, from: a.from, to: a.to } : {};
    setF({ channels: a.channel ? [a.channel] : 'all', campaigns: a.campaign ? [a.campaign] : 'all', objectives: 'all', ...range });
    setPage(a.page);
  };

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;   // đặt trước khi render lại để CSS() đọc đúng token mới
    setTheme(next);
  };

  const stateBody = (r: Region): ReactNode =>
    r === 'ready' ? null : <CardState state={r} message={error} onRetry={retry} />;
  const sb = stateBody(region);
  const isReady = region === 'ready';

  /* ── Nội dung Row 2 / Row 3 theo trang (layout.md §6) ──────────────────── */
  let row2: ReactNode;
  let row3: ReactNode;

  if (page === 'home') {
    const sl = isReady ? A.slices(cur, 'channel', 'spend') : [];
    const trendData = isReady ? A.trend(cur, grain, P) : [];
    const topCampaigns = isReady ? A.ranking(cur, 'campaign', P, 8) : [];
    const matrix = isReady ? A.weekMatrix(rows, f, dates, P) : null;

    row2 = (
      <>
        <ChartCard width={L.a} title="Tỷ trọng Chi phí theo kênh" subtitle="Bấm một phần để lọc theo kênh"
                   legend={isReady ? <Legend two items={sl.map((s, i) => ({ name: lossName(s.name, s.roas), color: sliceColor(s, i) }))} /> : undefined}>
          {sb ?? <DonutChart data={sl} width={L.p2a.w} height={L.p2a.h - LGD2} format={A.fmtMoney}
                             onSelect={(n) => pickOnly('channels', n)} />}
        </ChartCard>
        <ChartCard width={L.b} title={`Xu hướng ${PL}`} subtitle={`Theo ${A.GRAIN_WORD[grain]}`}
                   control={
                     <div className="seg sm">
                       {A.GRAINS.map((g) => (
                         <button key={g.key} className={grain === g.key ? 'on' : ''} onClick={() => setGrain(g.key)}>{g.label}</button>
                       ))}
                     </div>
                   }>
          {sb ?? <TrendAreaChart data={trendData} width={L.p2b.w} height={L.p2b.h} format={fmt} axis={axis} name={PL} />}
        </ChartCard>
      </>
    );
    row3 = (
      <>
        <ChartCard width={L.c} title={`Top 8 chiến dịch theo ${PL}`} subtitle="Bấm một thanh để lọc theo chiến dịch">
          {sb ?? <RankBarChart data={topCampaigns} width={L.p3c.w} height={L.p3c.h} format={fmt} roasNote={P !== 'roas'}
                               onSelect={(n) => pickOnly('campaigns', n)} />}
        </ChartCard>
        <ChartCard width={L.d} title={`${PL} theo kênh × 8 tuần gần nhất`} subtitle="Mỗi cột 7 ngày, tính lùi từ ngày cuối kỳ">
          {sb ?? (matrix && <MatrixTable matrix={matrix} rowLabel="Kênh" width={L.p3d.w} height={L.p3d.h} format={fmt}
                                          badIf={P === 'roas' ? (v) => v < THRESHOLD.roas : undefined} />)}
        </ChartCard>
      </>
    );
  } else if (page === 'channel' || page === 'campaign') {
    const dim: Dim = page;
    const word = dim === 'channel' ? 'kênh' : 'chiến dịch';
    const g = A.autoGrain(days);
    const dp = A.donutParam(P);
    const rank = isReady ? A.ranking(cur, dim, P, dim === 'channel' ? Infinity : 10) : [];
    const lines = isReady ? A.multiLine(cur, dim, P, g) : null;
    const series = lines ? lines.series.map((s, i) => ({ key: s.key, name: lossName(s.name, s.roas), rank: i, color: seriesColor({ roas: s.roas }, i) })) : [];
    const sl = isReady ? A.slices(cur, dim, dp) : [];
    const table = isReady ? A.metricRows(cur, dim, P, stats, rows) : [];

    row2 = (
      <>
        <ChartCard width={L.a} title={dim === 'channel' ? `Xếp hạng kênh theo ${PL}` : `Top 10 chiến dịch theo ${PL}`}>
          {sb ?? <RankBarChart data={rank} width={L.p2a.w} height={L.p2a.h} format={fmt} roasNote={P !== 'roas'} />}
        </ChartCard>
        <ChartCard width={L.b} title={`Top 5 ${word} theo ${PL}`} subtitle={`Theo ${A.GRAIN_WORD[g]}`}
                   legend={isReady ? <Legend items={series.map((s) => ({ name: s.name, color: s.color }))} /> : undefined}>
          {sb ?? (lines && <MultiLineChart data={lines.data} series={series} width={L.p2b.w} height={L.p2b.h - LGD1}
                                           format={fmt} axis={axis} />)}
        </ChartCard>
      </>
    );
    row3 = (
      <>
        <ChartCard width={L.c} title={`Tỷ trọng ${A.paramLabel(dp)} theo ${word}`}
                   legend={isReady ? <Legend two items={sl.map((s, i) => ({ name: lossName(s.name, s.roas), color: sliceColor(s, i) }))} /> : undefined}>
          {sb ?? <DonutChart data={sl} width={L.p3c.w} height={L.p3c.h - LGD2} format={(v) => A.fmtParam(v, dp)} />}
        </ChartCard>
        <ChartCard width={L.d} title={`Chỉ số đầy đủ theo ${word}`} subtitle={`Sắp theo ${PL} giảm dần`}>
          {sb ?? <MetricsTable rows={table} dim={dim} width={L.p3d.w} height={L.p3d.h} />}
        </ChartCard>
      </>
    );
  } else {
    /* Trang 4 · Nguồn dữ liệu — không băng KPI, không áp bộ lọc. */
    const s = state === 'ready' ? null : stateBody(state);
    const first = rows[0];
    const info: [string, string][] = data ? [
      ['Nguồn', 'Google Sheets'],
      ['Tab', data.tab],
      ['Số dòng', A.fmtInt(data.count)],
      ['Số ngày', A.fmtInt(dates.length)],
      ['Khoảng ngày', `${A.ddmmyyyy(dates[0])} → ${A.ddmmyyyy(dates[dates.length - 1])}`],
      ['Quyền', 'spreadsheets.readonly'],
      ['Đồng bộ gần nhất', `${A.clockVN(new Date(data.fetchedAt))} · ${A.todayVN(new Date(data.fetchedAt))}`],
    ] : [];

    row2 = (
      <>
        <ChartCard width={L.a} title="Thông tin kết nối">
          {s ?? (
            <div className="tscroll">
              <table>
                <tbody>
                  {info.map(([k, v]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td>
                        {k === 'Đồng bộ gần nhất'
                          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="clock" className="lu lu-xs" />{v}</span>
                          : v}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
        <ChartCard width={L.b} title="Schema và vai trò từng cột" subtitle="Theo specification.md §7">
          {s ?? (
            <div className="tscroll">
              <table>
                <thead><tr><th>Cột</th><th style={LEFT}>Kiểu</th><th style={LEFT}>Vai trò</th><th>Ví dụ</th></tr></thead>
                <tbody>
                  {A.SCHEMA.map((c) => (
                    <tr key={c.col}>
                      <td className="mono">{c.col}</td>
                      <td style={LEFT}>{c.type}</td>
                      <td style={LEFT}><span className="role">{c.role === 'ATTRIBUTE' ? 'ATTRIBUTE · MAX' : c.role}</span></td>
                      <td>{first ? String(first[c.field]) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </>
    );
    row3 = (
      <>
        <ChartCard width={L.c} title="Biến môi trường" subtitle="Chỉ tên biến — giá trị chỉ đọc ở server">
          {s ?? (
            <div className="tscroll">
              <table>
                <thead><tr><th>Biến</th><th>Đọc ở</th></tr></thead>
                <tbody>{ENV_VARS.map((v) => <tr key={v}><td className="mono">{v}</td><td>server</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </ChartCard>
        <ChartCard width={L.d} title="Kiểm tra chất lượng dữ liệu" subtitle="Chạy trên giá trị thô của Sheet">
          {s ?? (
            <div className="tscroll">
              <table>
                <thead><tr><th>Kiểm tra</th><th>Số dòng lỗi</th><th>Trạng thái</th></tr></thead>
                <tbody>
                  {(data?.quality ?? []).map((q) => (
                    <tr key={q.id}>
                      <td>{q.label}</td>
                      <td>{A.fmtInt(q.count)}</td>
                      <td>
                        {q.count === 0
                          ? <span className="ok"><Icon name="circle-check" className="lu lu-xs" />Đạt</span>
                          : <span style={{ ...WARN, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <Icon name="triangle-alert" className="lu lu-xs" />Cần xem
                            </span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </>
    );
  }

  const meta = PAGES.find((p) => p.id === page) ?? PAGES[0];
  const stageClass = [rail && 'rail', drawer && 'drawer', exporting && 'modal'].filter(Boolean).join(' ');

  return (
    <Shell className={stageClass}>
      <Sidebar rail={rail} page={page} onPage={setPage} onToggleRail={() => setRail((v) => !v)} />

      <main id="main">
        <TopBar label={meta.label} icon={meta.icon}
                syncing={syncing} syncedAt={data ? A.clockVN(new Date(data.fetchedAt)) : ''} onSync={resync}
                alerts={alerts} onAlert={onAlert}
                theme={theme} onTheme={toggleTheme}
                onExport={() => { if (ready) setExporting(true); }}
                onFilter={() => { if (ready) setDrawer(true); }}
                filterCount={chips.length} />

        <div id="body" className={page === 'source' ? 'nokpi' : ''}>
          <GreetBar context={context} chips={page === 'source' ? [] : chips} onClearAll={clearDims} />

          {page !== 'source' && (
            <div id="kpis">
              {A.KPI_LABELS.map((label, i) => (
                <KpiCard key={label} label={label} model={kpis?.[i] ?? null} state={region}
                         sparkWidth={L.kpiW - 28} onRetry={retry} />
              ))}
            </div>
          )}

          {/* Trang 4 giãn hai hàng bằng flex 1 1 0; minHeight 0 để bảng dài cuộn trong khối
              thay vì kéo một hàng cao hơn hàng kia. */}
          <div id="row2" style={page === 'source' ? { minHeight: 0 } : undefined}>{row2}</div>
          <div id="row3" style={page === 'source' ? { minHeight: 0 } : undefined}>{row3}</div>
        </div>
      </main>

      {data && filters && (
        <FilterDrawer open={drawer} filters={filters} rows={rows} dates={dates}
                      onApply={(next) => { setFilters(next); setDrawer(false); }}
                      onClose={() => setDrawer(false)} />
      )}
      {data && filters && (
        <ExportModal open={exporting} onClose={() => setExporting(false)}
                     filteredRows={cur} allRows={rows} dates={dates} range={{ from: f.from, to: f.to }} />
      )}
      <Toast message={toast} />
    </Shell>
  );
}

/* Bảng chỉ số đầy đủ (components.md §12). Ô chỉ tô màu khi so với ngưỡng, luôn kèm giá trị (G28).
   Rộng hơn khung thì cuộn ngang trong khối, cột tên ghim cố định; tiền rút gọn, đầy đủ trong tooltip (G34). */
const CELL: CSSProperties = { padding: '5px 5px' };
const PIN: CSSProperties = { position: 'sticky', left: 0, zIndex: 1, background: 'var(--card)' };
const PIN_HEAD: CSSProperties = { position: 'sticky', left: 0, zIndex: 3 };
const METRIC_HEADS = ['Chi phí', 'Doanh thu', 'ROAS', 'Leads', 'CPL', 'Conversion', 'CPA', 'CTR', 'CPC', 'CPM', '% ngân sách'];

function MetricsTable({ rows, dim, width, height }: {
  rows: A.MetricRow[];
  dim: Dim;
  width: number;
  height: number;
}) {
  const money = (v: number) => <td style={CELL} title={A.fmtMoney(v)}>{A.fmtShort(v)}</td>;
  const flag = (on: boolean, tone: CSSProperties): CSSProperties => (on ? { ...CELL, ...tone } : CELL);

  return (
    <div style={{ width, height, overflow: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th style={{ ...CELL, ...PIN_HEAD }}>{dim === 'channel' ? 'Kênh' : 'Chiến dịch'}</th>
            {dim === 'campaign' && <><th style={{ ...CELL, ...LEFT }}>Kênh</th><th style={{ ...CELL, ...LEFT }}>Mục tiêu</th></>}
            {METRIC_HEADS.map((h) => <th key={h} style={CELL}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={{ ...CELL, ...PIN }}>
                <span className="cn">
                  {dim === 'channel' && <span className="sq"><Icon name={channelIcon(r.key)} /></span>}
                  <span className="nm">{r.key}</span>
                </span>
              </td>
              {dim === 'campaign' && <><td style={{ ...CELL, ...LEFT }}>{r.channel}</td><td style={{ ...CELL, ...LEFT }}>{r.objective}</td></>}
              {money(r.a.spend)}
              {money(r.a.revenue)}
              <td style={flag(r.a.roas < THRESHOLD.roas, BAD)}>{A.fmtRoas(r.a.roas)}</td>
              <td style={CELL}>{A.fmtInt(r.a.leads)}</td>
              <td style={flag(r.a.cpl > THRESHOLD.cpl, BAD)}>{A.fmtMoney(r.a.cpl)}</td>
              <td style={CELL}>{A.fmtInt(r.a.conversions)}</td>
              {money(r.a.cpa)}
              <td style={CELL}>{A.fmtPct(r.a.ctr, 2)}</td>
              <td style={CELL}>{A.fmtMoney(r.a.cpc)}</td>
              <td style={CELL}>{A.fmtMoney(r.a.cpm)}</td>
              <td style={flag(r.budgetPct > THRESHOLD.budget, WARN)}>{A.fmtPct(r.budgetPct, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
