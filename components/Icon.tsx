import { ICON_SPRITE, type IconName } from '@/lib/icons';

/* Sprite nạp MỘT lần ở app/layout.tsx; mọi chỗ dùng chỉ <use href="#i-…">.
   Nội dung là hằng số trong repo, không có dữ liệu người dùng ⇒ an toàn. */
export function IconSprite() {
  return (
    <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden
         dangerouslySetInnerHTML={{ __html: ICON_SPRITE }} />
  );
}

/** className luôn phải có `lu` (fill:none, stroke) — `lu-sm` / `lu-xs` chỉ đổi cỡ. */
export function Icon({ name, className = 'lu' }: { name: IconName; className?: string }) {
  return <svg className={className} aria-hidden><use href={`#i-${name}`} /></svg>;
}

/** Sprite không có logo thương hiệu — dùng icon gần nghĩa nhất (G25). */
export function channelIcon(channel: string): IconName {
  const c = channel.toLowerCase();
  if (c.includes('facebook')) return 'users';
  if (c.includes('google')) return 'search';
  if (c.includes('email')) return 'mail';
  return 'activity';
}
