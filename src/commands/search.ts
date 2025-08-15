import { Context } from 'telegraf';
import { fetch } from 'undici';

// Interface for movie items, including poster_path
interface MovieItem {
  category: string;
  title: string;
  key: string;
  telegramLink: string;
  poster_path: string;
  wiki_link: string;
}

function createTelegramLink(key: string): string {
  return `https://t.me/MovieSearchBot?start=${key}`;
}

function createMediaBotLink(key: string): string {
  return `https://t.me/MovieMediaBot?start=${key}`;
}

let movieData: MovieItem[] = [];
async function initializeMovieData(): Promise<void> {
  const sources = [
    { category: '1950-1989', url: 'https://raw.githubusercontent.com/itzfew/MoviesBot/master/data/bollywood5089.csv' },
    { category: '1990-2009', url: 'https://raw.githubusercontent.com/itzfew/MoviesBot/master/data/bollywood9009.csv' },
    { category: '2010-2019', url: 'https://raw.githubusercontent.com/itzfew/MoviesBot/master/data/bollywood1019.csv' },
  ];

  const output: MovieItem[] = [];

  for (const source of sources) {
    try {
      const res = await fetch(source.url);
      if (!res.ok) {
        console.error(`Failed to fetch ${source.category} from ${source.url}: ${res.statusText}`);
        continue;
      }
      const text = await res.text();
      const lines = text.split('\n').filter((line) => line.trim());

      for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        // Parse CSV fields from the end to handle commas in titles
        let lastComma = line.lastIndexOf(',');
        if (lastComma === -1) continue;
        const wiki_link = line.slice(lastComma + 1).trim();
        line = line.slice(0, lastComma);

        lastComma = line.lastIndexOf(',');
        if (lastComma === -1) continue;
        const poster_path = line.slice(lastComma + 1).trim();
        line = line.slice(0, lastComma);

        lastComma = line.lastIndexOf(',');
        if (lastComma === -1) continue;
        const imdb_id = line.slice(lastComma + 1).trim();
        const title = line.slice(0, lastComma).trim(); // Title may have commas

        if (!title || !imdb_id || !poster_path || !wiki_link) continue;

        const key = imdb_id;
        const tgLink = createTelegramLink(key);

        output.push({
          category: source.category,
          title,
          key,
          telegramLink: tgLink,
          poster_path,
          wiki_link,
        });
      }
    } catch (e: unknown) {
      console.error(`Failed to load ${source.category} from ${source.url}:`, (e as Error).message || e);
    }
  }

  movieData = output;
}
initializeMovieData().catch(console.error);

function rankedMatches(query: string): MovieItem[] {
  const queryWords = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const results: { item: MovieItem; rank: number }[] = [];

  for (const item of movieData) {
    const fullText = `${item.category} ${item.title}`.toLowerCase();
    const fullWords = new Set(fullText.split(/\s+/));
    const matchedWords = queryWords.filter((word) => fullWords.has(word));
    const rank = Math.round((matchedWords.length / queryWords.length) * 100);
    if (rank > 0) {
      results.push({ item, rank });
    }
  }

  return results.sort((a, b) => b.rank - a.rank).map((r) => r.item);
}

// Pagination constants
const ITEMS_PER_PAGE = 5;

// Group and channel IDs (replace with actual IDs)
const GROUP_ID = '@YourMovieGroup'; // Replace with actual group ID or username
const CHANNEL_ID = '@YourMovieChannel'; // Replace with actual channel ID or username

async function checkUserMembership(ctx: Context, userId: number, chatId: string): Promise<boolean> {
  try {
    const member = await ctx.telegram.getChatMember(chatId, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (e: unknown) {
    console.error(`Failed to check membership for ${chatId}:`, (e as Error).message || e);
    return false;
  }
}

async function sendMovieList(ctx: Context, query: string, matches: MovieItem[], page: number = 0) {
  const start = page * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const pageMatches = matches.slice(start, end);

  if (pageMatches.length === 0) {
    await ctx.reply(`❌ No movies found for "${query}".`, {
      reply_parameters: { message_id: (ctx.message as { message_id: number }).message_id },
    });
    return;
  }

  const mention =
    ctx.chat?.type?.includes('group') && ctx.from?.username
      ? `@${ctx.from.username}`
      : ctx.from?.first_name || '';

  const totalPages = Math.ceil(matches.length / ITEMS_PER_PAGE);
  const text = `🔍 ${mention}, found *${matches.length}* matches for *${query}* (Page ${page + 1}/${totalPages}):\n\n` +
    pageMatches
      .map((item, index) => `${start + index + 1}. [${item.title}](${item.telegramLink}) (${item.category})`)
      .join('\n');

  const inlineKeyboard = [
    pageMatches.map((item, index) => ({
      text: `${start + index + 1}. ${item.title}`,
      url: item.telegramLink,
    })),
    [
      ...(page > 0 ? [{ text: '⬅️ Previous', callback_data: `prev_${query}_${page - 1}` }] : []),
      ...(page < totalPages - 1 ? [{ text: 'Next ➡️', callback_data: `next_${query}_${page + 1}` }] : []),
    ],
    [
      { text: 'Join Group', url: `https://t.me/${GROUP_ID.replace('@', '')}` },
      { text: 'Share Bot', switch_inline_query: '' },
    ],
  ].filter(row => row.length > 0);

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_parameters: { message_id: (ctx.message as { message_id: number }).message_id },
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
}

async function sendMovieDetails(ctx: Context, movie: MovieItem) {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.reply('❌ Unable to verify user.', {
      reply_parameters: { message_id: (ctx.message as { message_id: number })?.message_id },
    });
    return;
  }

  const isGroupMember = await checkUserMembership(ctx, userId, GROUP_ID);
  const isChannelMember = await checkUserMembership(ctx, userId, CHANNEL_ID);

  if (!isGroupMember || !isChannelMember) {
    const inlineKeyboard = [
      ...(isGroupMember ? [] : [{ text: 'Join Group', url: `https://t.me/${GROUP_ID.replace('@', '')}` }]),
      ...(isChannelMember ? [] : [{ text: 'Join Channel', url: `https://t.me/${CHANNEL_ID.replace('@', '')}` }]),
      { text: 'Verify', callback_data: `verify_${movie.key}` },
    ].filter(row => row.length > 0);

    await ctx.reply(
      `🎬 *${movie.title}* (${movie.category})\n\nPlease join our group and channel to access the movie:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [inlineKeyboard] },
      },
    );
    return;
  }

  const inlineKeyboard = [
    [{ text: 'Watch Movie', url: createMediaBotLink(movie.key) }],
    [{ text: 'Wikipedia', url: movie.wiki_link }],
  ];

  await ctx.replyWithPhoto(
    movie.poster_path,
    {
      caption: `🎬 *${movie.title}* (${movie.category})\n\nAccess the movie via @MovieMediaBot.`,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: inlineKeyboard },
    },
  );
}

// -------------------- Bot Handler --------------------
export function movieSearch() {
  return async (ctx: Context) => {
    try {
      const message = ctx.message as { text?: string; message_id: number } | undefined;
      if (!message || !('text' in message) || !message.text) return;

      const query = message.text.trim();
      if (!query) {
        await ctx.reply('❌ Please enter a movie name.', {
          reply_parameters: { message_id: message.message_id },
        });
        return;
      }

      // Handle /start with movie ID
      if (query.startsWith('/start ') && query.split(' ').length > 1) {
        const movieId = query.split(' ')[1];
        const movie = movieData.find((item) => item.key === movieId);
        if (!movie) {
          await ctx.reply('❌ Movie not found.', {
            reply_parameters: { message_id: message.message_id },
          });
          return;
        }
        await sendMovieDetails(ctx, movie);
        return;
      }

      const matches = rankedMatches(query);
      if (matches.length === 0) {
        await ctx.reply(`❌ No movies found for "${query}".`, {
          reply_parameters: { message_id: message.message_id },
        });
        return;
      }

      await sendMovieList(ctx, query, matches, 0);
    } catch (err: unknown) {
      console.error(err);
      await ctx.reply('❌ Something went wrong. Please try again later.', {
        reply_parameters: { message_id: (ctx.message as { message_id: number })?.message_id },
      });
    }
  };
}

// -------------------- Callback Query Handler --------------------
export function handleCallback() {
  return async (ctx: Context) => {
    try {
      const callbackData = ctx.callbackQuery?.data;
      if (!callbackData) return;

      if (callbackData.startsWith('prev_') || callbackData.startsWith('next_')) {
        const [action, query, pageStr] = callbackData.split('_');
        const page = parseInt(pageStr, 10);
        const matches = rankedMatches(query);
        await sendMovieList(ctx, query, matches, page);
        await ctx.answerCbQuery();
      } else if (callbackData.startsWith('verify_')) {
        const movieId = callbackData.split('_')[1];
        const movie = movieData.find((item) => item.key === movieId);
        if (!movie) {
          await ctx.reply('❌ Movie not found.');
          return;
        }
        await sendMovieDetails(ctx, movie);
        await ctx.answerCbQuery();
      }
    } catch (err: unknown) {
      console.error(err);
      await ctx.reply('❌ Something went wrong. Please try again later.');
      await ctx.answerCbQuery();
    }
  };
}
