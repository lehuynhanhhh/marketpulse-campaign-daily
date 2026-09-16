export type Row = {
  date: string;            // ISO 'yyyy-mm-dd', GIỮ NGUYÊN chuỗi
  t: number;               // chỉ số ngày 0..n-1, tính ở server khi parse
  channel: string;
  campaign: string;
  objective: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  qualified: number;       // cột qualified_leads
  conversions: number;
  revenue: number;
  budget: number;          // cột campaign_budget — ATTRIBUTE, MAX theo chiến dịch, không SUM
};

export type PageId = 'home' | 'channel' | 'campaign' | 'source';
export type Grain = 'day' | 'week' | 'month';
export type ParamKey = 'spend' | 'revenue' | 'conversions' | 'roas';
export type Preset = 7 | 30 | 90 | 'all' | 'custom';

/** 'all' = không lọc; mảng = chỉ những giá trị này (mảng rỗng = không chọn gì ⇒ trạng thái rỗng). */
export type Sel = 'all' | string[];

export type Filters = {
  param: ParamKey;
  preset: Preset;
  from: number;            // chỉ số ngày, KHÔNG phải chuỗi
  to: number;
  channels: Sel;
  campaigns: Sel;
  objectives: Sel;
};

/** Tỷ lệ = NaN khi mẫu số bằng 0 — hiển thị '—' (specification.md §8). */
export type Aggregate = {
  spend: number; revenue: number; impressions: number; clicks: number;
  leads: number; qualified: number; conversions: number;
  roas: number; cpl: number; cpa: number; ctr: number; cpc: number; cpm: number;
};

export type QualityCheck = { id: string; label: string; count: number };

export type DataPayload = {
  rows: Row[];
  count: number;
  dates: string[];         // danh sách ngày duy nhất đã sắp xếp; dates[t] là ngày của chỉ số t
  header: string[];
  quality: QualityCheck[];
  fetchedAt: string;       // ISO, lúc server đọc Sheet
  tab: string;
  error?: string;
};
