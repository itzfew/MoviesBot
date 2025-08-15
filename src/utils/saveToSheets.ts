// src/utils/saveToSheets.ts
import { google } from 'googleapis';
import { sheetsAuth } from './sheetsAuth'; // You'll need to create this for authentication

const SHEET_ID = 'YOUR_SHEET_ID';
const SHEET_NAME = 'Users';

export const saveToSheets = async (chat: any): Promise<boolean> => {
  const auth = await sheetsAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // Fetch all chat IDs from sheet
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A2:F`, // Assuming A1:F1 is headers
  });

  const rows = res.data.values || [];
  const chatIdStr = String(chat.id);
  let foundRowIndex: number | null = null;

  rows.forEach((row, index) => {
    if (row[0] === chatIdStr) {
      foundRowIndex = index + 2; // +2 for header offset
    }
  });

  const now = new Date().toISOString();

  if (foundRowIndex) {
    // Update lastInteraction only
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!F${foundRowIndex}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[now]],
      },
    });
    return true; // Already existed
  }

  // Add new row
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:F`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        chatIdStr,
        chat.username || '',
        chat.first_name || '',
        chat.last_name || '',
        now,  // dateJoined
        now   // lastInteraction
      ]],
    },
  });

  console.log(`Saved new chat to Sheets: ${chatIdStr}`);
  return false;
};
