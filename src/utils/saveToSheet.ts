export const saveToSheet = async (chat: {
  id: number;
  username?: string;
  first_name?: string;
}): Promise<boolean> => {
  const payload = {
    id: String(chat.id),
    username: chat.username || '',
    first_name: chat.first_name || '',
  };

  try {
    const response = await fetch(
      'https://script.google.com/macros/s/AKfycbwAxRvC5DncdYzmpAsn7rlLB-9jqNYyEroBPaOMwF-Nq2h05QNfSlMLdeHSfK26OhGr/exec',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );

    const resultText = await response.text();
    console.log('Google Sheet response:', resultText);

    if (response.ok) {
      if (resultText.includes('Already Notified')) {
        return true; // Already exists
      } else if (resultText.includes('Saved')) {
        return false; // Newly added
      }
    } else {
      console.error(`Sheet API error: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error in saveToSheet:', error);
  }

  return false; // fallback, treat as new
};
