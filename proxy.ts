import { withAuth } from 'next-auth/middleware';

/* Next.js 16: quy ước file "middleware.ts" đã đổi tên thành "proxy.ts" (proxy.js|ts ở gốc
   project, cùng cấp package.json) — hàm bên trong không đổi, chỉ đổi tên file/export
   (xem node_modules/next/dist/docs/.../file-conventions/proxy.md).
   Chỉ chắn route /dashboard (yêu cầu #1) — /api/data tự kiểm session riêng
   (route.ts) để trả JSON 401 thay vì redirect HTML, vì client gọi bằng fetch(). */
export default withAuth({
  pages: { signIn: '/' },
  secret: process.env.AUTH_SECRET,
});

export const config = {
  matcher: ['/dashboard/:path*'],
};
