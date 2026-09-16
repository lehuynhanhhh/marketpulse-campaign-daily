'use client';

import { Icon } from '@/components/Icon';

/* Báo "vừa có dữ liệu mới" sau một lượt auto-refresh im lặng. Không chặn thao tác
   (pointer-events tắt khi ẩn), tự biến mất — logic đóng nằm ở nơi gọi (dashboard/page.tsx). */
export function Toast({ message }: { message: string | null }) {
  return (
    <div className={`toast${message ? ' on' : ''}`} role="status" aria-live="polite">
      <i><Icon name="circle-check" className="lu lu-sm" /></i>
      <span>{message}</span>
    </div>
  );
}
