import { Telegraf, Context } from 'telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import { about } from './commands/about';
import { greeting } from './text/greeting';
import { production, development } from './core';
import { movieSearch } from './commands/search'; // your movie search.ts

// ====== CONFIG ======
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';
const ADMIN_ID = 6930703214;
const BOT_USERNAME = 'SearchNEETJEEBot';
const GOOGLE_SHEETS_WEBAPP_URL = process.env.SHEETS_WEBAPP_URL || ''; // Your deployed Apps Script web app endpoint

if (!BOT_TOKEN) throw new Error('BOT_TOKEN not provided!');
if (!GOOGLE_SHEETS_WEBAPP_URL) console.warn('⚠️ SHEETS_WEBAPP_URL not provided! Chat saving will fail.');

console.log(`Running bot in ${ENVIRONMENT} mode`);

const bot = new Telegraf(BOT_TOKEN);

// ===== Helper: Save Chat to Google Sheets =====
async function saveChatToSheets(chat: any, user?: any) {
  if (!GOOGLE_SHEETS_WEBAPP_URL) return;
  try {
    const payload = {
      chat_id: chat.id,
      chat_type: chat.type,
      name: user?.first_name || chat.title || 'Unknown',
      username: user?.username || chat.username || '',
      date: new Date().toISOString(),
    };
    await axios.post(GOOGLE_SHEETS_WEBAPP_URL, payload);
  } catch (err) {
    console.error('Failed to save chat to Sheets:', err);
  }
}

// ===== Commands =====
bot.command('add', async (ctx) => {
  if (ctx.chat?.type !== 'private') return;
  await ctx.reply('Please share through this bot: @NeetAspirantsBot', {
    reply_markup: {
      inline_keyboard: [[{ text: 'Open Bot', url: 'https://t.me/NeetAspirantsBot' }]],
    },
  });
});

bot.command('about', async (ctx) => {
  if (ctx.chat?.type !== 'private') return;
  await about()(ctx);
});

bot.command('start', async (ctx) => {
  const chat = ctx.chat;
  const user = ctx.from;
  if (!chat || !user) return;

  await saveChatToSheets(chat, user);

  if (ctx.chat?.type === 'private') {
    await greeting()(ctx);
  }

  if (chat.id !== ADMIN_ID) {
    const name = user.first_name || chat.title || 'Unknown';
    const username = user.username ? `@${user.username}` : chat.username ? `@${chat.username}` : 'N/A';
    const chatTypeLabel = chat.type.charAt(0).toUpperCase() + chat.type.slice(1);

    await ctx.telegram.sendMessage(
      ADMIN_ID,
      `*New ${chatTypeLabel} started the bot!*\n\n*Name:* ${name}\n*Username:* ${username}\n*Chat ID:* ${chat.id}\n*Type:* ${chat.type}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// Admin: /users (from Sheets)
bot.command('users', async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) return ctx.reply('You are not authorized.');
  try {
    const res = await axios.get(`${GOOGLE_SHEETS_WEBAPP_URL}?action=getUserCount`);
    const count = res.data.count || 0;
    await ctx.reply(`📊 Total interacting entities: ${count}`);
  } catch (err) {
    console.error('Error fetching user count:', err);
    await ctx.reply('❌ Unable to fetch user count.');
  }
});

// ===== Message Handler =====
bot.on('message', async (ctx) => {
  const chat = ctx.chat;
  const user = ctx.from;
  const message = ctx.message;

  if (!chat?.id || !user) return;

  await saveChatToSheets(chat, user);

  const isPrivate = chat.type === 'private';
  const isGroup = chat.type === 'group' || chat.type === 'supergroup';
  const mentionedEntity = message.entities?.find(
    (e) =>
      e.type === 'mention' &&
      message.text?.slice(e.offset, e.offset + e.length).toLowerCase() ===
        `@${BOT_USERNAME.toLowerCase()}`
  );

  if (message.text && (isPrivate || (isGroup && mentionedEntity))) {
    if (mentionedEntity) {
      ctx.message.text = message.text.replace(`@${BOT_USERNAME}`, '').trim();
    }
    await movieSearch()(ctx);
  }

  if (chat.id !== ADMIN_ID) {
    const name = user.first_name || chat.title || 'Unknown';
    const username = user.username ? `@${user.username}` : chat.username ? `@${chat.username}` : 'N/A';
    const chatTypeLabel = chat.type.charAt(0).toUpperCase() + chat.type.slice(1);

    await ctx.telegram.sendMessage(
      ADMIN_ID,
      `*New ${chatTypeLabel} interacted!*\n\n*Name:* ${name}\n*Username:* ${username}\n*Chat ID:* ${chat.id}\n*Type:* ${chat.type}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ===== New Group Members =====
bot.on('new_chat_members', async (ctx) => {
  for (const member of ctx.message.new_chat_members) {
    const name = member.first_name || 'there';
    if (member.username === ctx.botInfo?.username) {
      await ctx.reply(`*Thanks for adding me!*\n\nType *@${BOT_USERNAME} movie name* to search movies.`, {
        parse_mode: 'Markdown',
      });
    } else {
      await ctx.reply(`*Hi ${name}!* Welcome! \n\nType *@${BOT_USERNAME} movie name* to search movies.`, {
        parse_mode: 'Markdown',
      });
    }
  }
});

// ===== Vercel Export =====
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  await production(req, res, bot);
};

if (ENVIRONMENT !== 'production') {
  development(bot);
}
