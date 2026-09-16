import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { fetchSheetValues, SHEET_TAB } from '@/lib/google-sheets';
import { COLUMNS } from '@/lib/aggregate';
import type { DataPayload, QualityCheck, Row } from '@/lib/types';

/* Route Handler của Next 16 không cache mặc định ⇒ nút "Đồng bộ" đọc lại Sheet thật
   (components.md §13). Nơi DUY NHẤT chạm credential, cùng lib/google-sheets.ts. */

const NUMERIC = [4, 5, 6, 7, 8, 9, 10, 11];
const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isNum = (s: string): boolean => Number.isFinite(Number(s)) && Number(s) >= 0;

function fail(error: string, fetchedAt: string, status: number) {
  const body: DataPayload = { error, rows: [], count: 0, dates: [], header: [], quality: [], fetchedAt, tab: SHEET_TAB };
  return NextResponse.json(body, { status });
}

/* Sáu kiểm tra ở trang Nguồn dữ liệu (components.md §4) — chạy trên giá trị THÔ,
   trước khi Number() || 0 che mất ô trống và ô sai kiểu. */
function qualityChecks(body: string[][]): QualityCheck[] {
  let empty = 0, badDate = 0, badNum = 0, dup = 0, funnel = 0;
  const seen = new Set<string>();
  const budgets = new Map<string, Set<string>>();
  for (const r of body) {
    const cell = (i: number) => (r[i] ?? '').trim();
    if (COLUMNS.some((_, i) => cell(i) === '')) empty++;
    if (!isDate(cell(0))) badDate++;
    if (NUMERIC.some((i) => cell(i) !== '' && !isNum(cell(i)))) badNum++;
    const key = `${cell(0)}|${cell(1)}|${cell(2)}`;
    if (seen.has(key)) dup++; else seen.add(key);
    const b = budgets.get(cell(2)) ?? new Set<string>();
    b.add(cell(11));
    budgets.set(cell(2), b);
    if (Number(cell(6)) > Number(cell(5)) || Number(cell(8)) > Number(cell(7))) funnel++;
  }
  const unstable = new Set([...budgets.entries()].filter(([, s]) => s.size > 1).map(([c]) => c));
  const budget = body.filter((r) => unstable.has((r[2] ?? '').trim())).length;
  return [
    { id: 'empty',  label: 'Ô trống',                   count: empty },
    { id: 'date',   label: 'Ngày không đọc được',       count: badDate },
    { id: 'number', label: 'Số không hợp lệ',           count: badNum },
    { id: 'dup',    label: 'Trùng dòng',                count: dup },
    { id: 'budget', label: 'Ngân sách không nhất quán', count: budget },
    { id: 'funnel', label: 'Phễu ngược',                count: funnel },
  ];
}

export async function GET() {
  const fetchedAt = new Date().toISOString();

  /* proxy.ts chỉ chắn trang /dashboard (redirect HTML) — route này tự kiểm session
     để trả JSON 401, vì client gọi bằng fetch() và không xử lý được redirect HTML. */
  const session = await getServerSession(authOptions);
  if (!session) return fail('Chưa đăng nhập.', fetchedAt, 401);

  try {
    const values = await fetchSheetValues();
    const header = (values[0] ?? []).map((h) => h.trim());
    const wrong = COLUMNS.filter((c, i) => header[i] !== c);
    if (wrong.length) {
      return fail(`Tiêu đề cột không khớp specification.md §7 — sai hoặc thiếu: ${wrong.join(', ')}`, fetchedAt, 500);
    }

    const body = values.slice(1).filter((r) => r.some((c) => c.trim() !== ''));   // bỏ dòng trống cuối
    if (body.length === 0) return fail('Sheet chỉ có dòng tiêu đề, chưa có dữ liệu.', fetchedAt, 500);

    const quality = qualityChecks(body);
    const valid = body.filter((r) => isDate((r[0] ?? '').trim()));   // dòng không có ngày thì không đặt được lên trục thời gian
    const dates = [...new Set(valid.map((r) => r[0].trim()))].sort();
    const index = new Map(dates.map((d, i) => [d, i]));

    const rows: Row[] = valid.map((r) => ({
      date:        r[0].trim(),
      t:           index.get(r[0].trim()) ?? 0,
      channel:     (r[1] ?? '').trim(),
      campaign:    (r[2] ?? '').trim(),
      objective:   (r[3] ?? '').trim(),
      spend:       Number(r[4])  || 0,
      impressions: Number(r[5])  || 0,
      clicks:      Number(r[6])  || 0,
      leads:       Number(r[7])  || 0,
      qualified:   Number(r[8])  || 0,
      conversions: Number(r[9])  || 0,
      revenue:     Number(r[10]) || 0,
      budget:      Number(r[11]) || 0,   // ATTRIBUTE — MAX, không SUM
    }));

    const payload: DataPayload = { rows, count: rows.length, dates, header, quality, fetchedAt, tab: SHEET_TAB };
    return NextResponse.json(payload);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Lỗi không xác định', fetchedAt, 500);
  }
}
