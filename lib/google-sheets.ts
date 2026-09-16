import 'server-only';
import { google } from 'googleapis';

/* Tab thật trong Sheet — specification.md §7. */
export const SHEET_TAB = 'marketpulse_campaign_daily';
const RANGE = `'${SHEET_TAB}'!A:L`;

export async function fetchSheetValues(): Promise<string[][]> {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  const email      = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '';
  const sheetId    = process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? '';

  if (!privateKey || !email || !sheetId) {
    throw new Error(
      'Thiếu biến môi trường. Cần GOOGLE_SHEETS_SPREADSHEET_ID, ' +
      'GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY trong .env.local'
    );
  }

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  /* Giữ FORMATTED_VALUE mặc định: ngày về đúng dạng 'yyyy-mm-dd', số không có dấu
     phân cách (đã kiểm khi đọc schema). UNFORMATTED_VALUE sẽ trả ô ngày thành số
     serial nếu Sheet lưu kiểu Date. */
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: RANGE,
  });

  const values = (res.data.values ?? []) as unknown[][];
  return values.map((r) => r.map((c) => (c == null ? '' : String(c))));
}
