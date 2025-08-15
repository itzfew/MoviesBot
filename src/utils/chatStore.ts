// src/utils/chatStore.ts
import fetch from 'node-fetch';

const SHEETS_WEBHOOK_URL = 'https://script.google.com/macros/s/XXXXXXXXXXXX/exec';

export const fetchChatIdsFromSheets = async (): Promise<string[]> => {
  const response = await fetch(`${SHEETS_WEBHOOK_URL}?action=getChatIds`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
};
