'use client';

import { useState, type ReactNode } from 'react';
import { Icon, channelIcon } from '@/components/Icon';
import * as A from '@/lib/aggregate';
import type { Filters, Row } from '@/lib/types';

const ROW_H = 28;        // chiều cao một hàng checkbox
const LIST_ROWS = 5;     // danh sách chiến dịch cao đúng 5 hàng — cắt giữa hàng trông như lỗi render
const CHIP_ON = { background: 'var(--sub2)', color: 'var(--ink)', borderColor: 'var(--ink3)' };

/* Sáu nhóm theo thứ tự: chỉ số · thời gian · kênh · chiến dịch (chip objective ở trên) · Xoá hết · Áp dụng.
   Sửa ở đây là NHÁP — chỉ ghi vào bộ lọc thật khi bấm Áp dụng. */
export function FilterDrawer({ open, filters, rows, dates, onApply, onClose }: {
  open: boolean;
  filters: Filters;
  rows: Row[];
  dates: string[];
  onApply: (f: Filters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Filters>(filters);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {            // mỗi lần mở: nháp bắt đầu từ bộ lọc đang áp
    setWasOpen(open);
    if (open) setDraft(filters);
  }

  const last = Math.max(0, dates.length - 1);
  const set = (patch: Partial<Filters>) => setDraft((d) => ({ ...d, ...patch }));

  const channels = A.distinct(rows, 'channel');
  const objectives = A.distinct(rows, 'objective');
  const allCampaigns = A.distinct(rows, 'campaign');
  const objOf = A.campaignObjective(rows);
  const campaigns = allCampaigns.filter((c) => A.inSel(draft.objectives, objOf.get(c) ?? ''));

  const countBy = (key: 'channel' | 'campaign') => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.t >= draft.from && r.t <= draft.to) m.set(r[key], (m.get(r[key]) ?? 0) + 1);
    return m;
  };
  const chCount = countBy('channel');
  const cpCount = countBy('campaign');

  const setFrom = (iso: string) => {
    const i = dates.findIndex((d) => d >= iso);
    set({ preset: 'custom', from: Math.min(i < 0 ? last : i, draft.to) });
  };
  const setTo = (iso: string) => {
    let i = 0;
    for (let k = last; k >= 0; k--) if (dates[k] <= iso) { i = k; break; }
    set({ preset: 'custom', to: Math.max(i, draft.from) });
  };

  const check = (key: string, on: boolean, label: ReactNode, n: number, onClick: () => void) => (
    <button key={key} className="cbx" role="checkbox" aria-checked={on} onClick={onClick} style={{ height: ROW_H }}>
      <span className={`box${on ? ' on' : ''}`}><Icon name="check" /></span>
      <span className="cn">{label}</span>
      <span className="n">{A.fmtInt(n)}</span>
    </button>
  );

  return (
    <>
      <div id="scrim" onClick={onClose} />
      <aside id="drawer" aria-label="Bộ lọc" aria-hidden={!open}>
        <div className="dh">
          <b>Bộ lọc</b>
          <button className="ibtn icon" onClick={onClose} aria-label="Đóng bộ lọc"><Icon name="x" /></button>
        </div>

        <div className="fl">Chỉ số theo dõi</div>
        <div className="seg">
          {A.PARAMS.map((p) => (
            <button key={p.key} className={draft.param === p.key ? 'on' : ''} style={{ flex: 1 }}
                    onClick={() => set({ param: p.key })}>{p.label}</button>
          ))}
        </div>

        <div className="fl">Khoảng thời gian</div>
        <div className="seg sm">
          {A.PRESETS.map((p) => (
            <button key={String(p.key)} className={draft.preset === p.key ? 'on' : ''} style={{ flex: 1 }}
                    onClick={() => set({ preset: p.key, ...A.presetRange(p.key, last) })}>{p.label}</button>
          ))}
        </div>
        <div className="dates">
          <label>Từ ngày
            <input type="date" value={dates[draft.from] ?? ''} min={dates[0]} max={dates[draft.to]}
                   onChange={(e) => { if (e.target.value) setFrom(e.target.value); }} />
          </label>
          <label>Đến ngày
            <input type="date" value={dates[draft.to] ?? ''} min={dates[draft.from]} max={dates[last]}
                   onChange={(e) => { if (e.target.value) setTo(e.target.value); }} />
          </label>
        </div>

        <div className="fl">Kênh</div>
        {channels.map((c) => check(
          c, A.inSel(draft.channels, c),
          <><span className="sq"><Icon name={channelIcon(c)} /></span><span className="nm">{c}</span></>,
          chCount.get(c) ?? 0,
          () => set({ channels: A.toggleSel(draft.channels, channels, c) }),
        ))}

        <div className="fl">Chiến dịch</div>
        <div className="chips" style={{ flexWrap: 'wrap', marginBottom: 6 }}>
          {objectives.map((o) => {
            const on = A.inSel(draft.objectives, o);
            return (
              <button key={o} className="chip" aria-pressed={on} style={on ? CHIP_ON : undefined}
                      onClick={() => set({ objectives: A.toggleSel(draft.objectives, objectives, o) })}>{o}</button>
            );
          })}
        </div>
        <div style={{ maxHeight: ROW_H * LIST_ROWS, overflowY: 'auto', flex: '0 0 auto' }}>
          {campaigns.length === 0
            ? <div className="cs">Không có chiến dịch nào thuộc mục tiêu đã chọn.</div>
            : campaigns.map((c) => check(
                c, A.inSel(draft.campaigns, c),
                <span className="nm">{c}</span>,
                cpCount.get(c) ?? 0,
                () => set({ campaigns: A.toggleSel(draft.campaigns, allCampaigns, c) }),
              ))}
        </div>

        <div className="dfoot">
          <button className="dbtn ghost" onClick={() => setDraft(A.defaultFilters(last))}>
            <Icon name="rotate-ccw" className="lu lu-sm" />Xoá hết
          </button>
          <button className="dbtn pri" onClick={() => onApply(draft)}>Áp dụng</button>
        </div>
      </aside>
    </>
  );
}
