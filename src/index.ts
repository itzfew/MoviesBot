import { Telegraf } from 'telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchChatIdsFromFirebase, getLogsByDate } from './utils/chatStore';
import { saveToFirebase } from './utils/saveToFirebase';
import { logMessage } from './utils/logMessage';
import { about } from './commands/about';
import { greeting, checkMembership } from './text/greeting';
import { production, development } from './core';
import { isPrivateChat } from './utils/groupSettings';
import { setupBroadcast } from './commands/broadcast';
import { studySearch } from './commands/study';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';
const ADMIN_ID = 6930703214;
const BOT_USERNAME = 'SearchNEETJEEBot';

if (!BOT_TOKEN) throw new Error('BOT_TOKEN not provided!');
console.log(`Running bot in ${ENVIRONMENT} mode`);

const bot = new Telegraf(BOT_TOKEN);

// Restrict command usage for private chats only
bot.use(async (ctx, next) => {
  if (ctx.chat && isPrivateChat(ctx.chat.type)) {
    const isAllowed = await checkMembership(ctx);
    if (!isAllowed) return;
  }
  await next();
});

// --- Commands ---

bot.command('add', async (ctx) => {
  if (!isPrivateChat(ctx.chat.type)) return;
  await ctx.reply('Please share through this bot: @NeetAspirantsBot', {
    reply_markup: {
      inline_keyboard: [[{ text: 'Open Bot', url: 'https://t.me/NeetAspirantsBot' }]],
    },
  });
});

bot.command('about', async (ctx) => {
  if (!isPrivateChat(ctx.chat.type)) return;
  await about()(ctx);
});

bot.command('start', async (ctx) => {
  if (!isPrivateChat(ctx.chat.type)) return;

  const user = ctx.from;
  const chat = ctx.chat;

  await greeting()(ctx);
  const alreadyNotified = await saveToFirebase(chat);
  await logMessage(chat.id, '/start', user);

  if (chat.id !== ADMIN_ID && !alreadyNotified) {
    const name = user?.first_name || 'Unknown';
    const username = user?.username ? `@${user.username}` : 'N/A';
    await ctx.telegram.sendMessage(
      ADMIN_ID,
      `*New user started the bot!*\n\n*Name:* ${name}\n*Username:* ${username}\n*Chat ID:* ${chat.id}\n*Type:* ${chat.type}`,
      { parse_mode: 'Markdown' }
    );
  }
});

bot.command('users', async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) return ctx.reply('You are not authorized.');
  try {
    const chatIds = await fetchChatIdsFromFirebase();
    await ctx.reply(`📊 Total users: ${chatIds.length}`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: 'Refresh', callback_data: 'refresh_users' }]],
      },
    });
  } catch (err) {
    console.error('Error fetching user count:', err);
    await ctx.reply('❌ Unable to fetch user count.');
  }
});

bot.command('logs', async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) return;
  const parts = ctx.message?.text?.split(' ') || [];
  if (parts.length < 2) return ctx.reply('Usage: /logs YYYY-MM-DD');

  const date = parts[1];
  try {
    const logs = await getLogsByDate(date);
    if (logs === 'No logs found for this date.') {
      await ctx.reply(logs);
    } else {
      await ctx.replyWithDocument({
        source: Buffer.from(logs, 'utf-8'),
        filename: `logs-${date}.txt`,
      });
    }
  } catch (err) {
    console.error('Error fetching logs:', err);
    await ctx.reply('❌ Error fetching logs.');
  }
});

// --- Inline Queries and Text Command ---
setupBroadcast(bot);

bot.on('text', async (ctx, next) => {
  let text = ctx.message?.text?.trim();
  if (!text) return;

  const chatType = ctx.chat?.type || '';
  const isGroup = chatType === 'group' || chatType === 'supergroup';
  const isPrivate = chatType === 'private';

  const mentionedEntity = ctx.message.entities?.find(
    (entity) =>
      entity.type === 'mention' &&
      text.slice(entity.offset, entity.offset + entity.length).toLowerCase() === `@${BOT_USERNAME.toLowerCase()}`
  );

  if (isPrivate || (isGroup && mentionedEntity)) {
    if (mentionedEntity) {
      text = text.replace(`@${BOT_USERNAME}`, '').trim();
      ctx.message.text = text;
    }
    await studySearch()(ctx);
  } else {
    await next();
  }
});

// --- New Chat Members ---
bot.on('new_chat_members', async (ctx) => {
  for (const member of ctx.message.new_chat_members) {
    const name = member.first_name || 'there';
    if (member.username === ctx.botInfo.username) {
      await ctx.reply(
        `*Thanks for adding me!*\n\nType *@${BOT_USERNAME} mtg bio* to get study material.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(
        `*Hi ${name}!* Welcome! \n\nType *@${BOT_USERNAME} mtg bio* to get study material.`,
        { parse_mode: 'Markdown' }
      );
    }
  }
});

// --- Private Message Logger ---
bot.on('message', async (ctx) => {
  const chat = ctx.chat;
  const user = ctx.from;
  const message = ctx.message;

  if (!chat?.id || !isPrivateChat(chat.type)) return;

  const alreadyNotified = await saveToFirebase(chat);

  const logText = message.text || `[${message?.media_group_id ? 'Media Group' : message?.photo ? 'Photo' : message?.document ? 'Document' : message?.video ? 'Video' : 'Non-text'} message]`;
  await logMessage(chat.id, logText, user);

  // Forward non-text messages
  if (!message.text) {
    const name = user?.first_name || 'Unknown';
    const username = user?.username ? `@${user.username}` : 'N/A';
    const time = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    const header = `*Non-text message received!*\n\n*Name:* ${name}\n*Username:* ${username}\n*Chat ID:* ${chat.id}\n*Time:* ${time}\n`;

    try {
      await ctx.telegram.sendMessage(ADMIN_ID, header, { parse_mode: 'Markdown' });
      await ctx.forwardMessage(ADMIN_ID, chat.id, message.message_id);
    } catch (err) {
      console.error('Failed to forward non-text message:', err);
    }
  }

  // Notify admin if new user
  if (chat.id !== ADMIN_ID && !alreadyNotified) {
    const name = user?.first_name || 'Unknown';
    const username = user?.username ? `@${user.username}` : 'N/A';
    await ctx.telegram.sendMessage(
      ADMIN_ID,
      `*New user interacted!*\n\n*Name:* ${name}\n*Username:* ${username}\n*Chat ID:* ${chat.id}\n*Type:* ${chat.type}`,
      { parse_mode: 'Markdown' }
    );
  }
});

// --- Refresh Button ---
bot.action('refresh_users', async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) return ctx.answerCbQuery('Unauthorized');

  try {
    const chatIds = await fetchChatIdsFromFirebase();
    await ctx.editMessageText(`📊 Total users: ${chatIds.length} (refreshed)`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: 'Refresh', callback_data: 'refresh_users' }]],
      },
    });
    await ctx.answerCbQuery('Refreshed!');
  } catch (err) {
    console.error('Failed to refresh user count:', err);
    await ctx.answerCbQuery('Refresh failed');
  }
});

// --- Vercel Export ---
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  await production(req, res, bot);
};

if (ENVIRONMENT !== 'production') {
  development(bot);
}
