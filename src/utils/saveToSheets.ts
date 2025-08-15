// src/utils/saveToSheets.ts
import fetch from 'node-fetch';

// Replace with your Google Apps Script Web App URL
const SHEETS_WEBHOOK_URL = 'https://script.google.com/macros/s/XXXXXXXXXXXX/exec';

export const saveToSheets = async (chat: any): Promise<boolean> => {
  const chatId = String(chat.id);

  // First check if this chat ID is already in Sheets
  const checkResponse = await fetch(`${SHEETS_WEBHOOK_URL}?action=checkChatId&chatId=${chatId}`);
  const checkData = await checkResponse.json();
  if (checkData.exists) {
    return true; // Already saved
  }

  // Save only chatId to Google Sheets
  const saveResponse = await fetch(SHEETS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'saveChatId',
      chatId: chatId,
      savedAt: new Date().toISOString()
    })
  });

  if (!saveResponse.ok) {
    console.error(`Failed to save chat ID to Sheets: ${chatId}`);
    return false;
  }

  console.log(`Saved chat ID to Sheets: ${chatId}`);
  return false;
};
