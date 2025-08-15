import { Context } from 'telegraf';
import { fetch } from 'undici';

// Interface for movie items
interface MovieItem {
  category: string;
  title: string;
  key: string;
  telegramLink: string;
  poster_path: string;
  wiki_link: string;
}

function createTelegramLink(key: string): string {
  return `https://t.me/Search_indianMoviesbot?start=${key}`;
}

function createMediaBotLink(key: string): string {
  return `https://t.me/SearchMoviesbot_bot?start=${key}`;
}

let movieData: MovieItem[] = [];
const dataLoaded = initializeMovieData().then(() => console.log('Data loaded successfully')).catch(err => console.error('Data load error:', err));

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
        const title = line.slice(0, lastComma).trim();

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

// Pagination constants
const ITEMS_PER_PAGE = 10;

// Group IDs and join URLs (replace with actual numeric IDs for checkUserMembership)
const GROUPS = [
  { id: '-1001234567890', url: 'https://t.me/+2csYKkDagRBhMWRl', name: 'Group 1' },
  { id: '-1009876543210', url: 'https://t.me/+FUdbdVUKII02M2Jl', name: 'Group 2' },
];

async function checkUserMembership(ctx: Context, userId: number, group: { id: string }): Promise<boolean> {
  try {
    const member = await ctx.telegram.getChatMember(group.id, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (e: unknown) {
    console.error(`Failed to check membership for ${group.id}:`, (e as Error).message || e);
    return false;
  }
}

async function isJoinedAllGroups(ctx: Context, userId: number): Promise<{ joined: boolean; missing: typeof GROUPS }> {
  const missing = [];
  for (const group of GROUPS) {
    const isMember = await checkUserMembership(ctx, userId, group);
    if (!isMember) {
      missing.push(group);
    }
  }
  return { joined: missing.length === 0, missing };
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

  const mention = ctx.chat?.type?.includes('group') ? `@${ctx.from.username}` : ctx.from?.first_name || '';

  const totalPages = Math.ceil(matches.length / ITEMS_PER_PAGE);
  const text = `🔍 ${mention}, found *${matches.length}* matches for *${query}* (Page ${page + 1}/${totalPages}):\n\n` +
    pageMatches
      .map((item, index) => `${start + index + 1}. [${item.title}](${item.telegramLink}) (${item.category})`)
      .join('\n');

  const inlineKeyboard = [
    ...pageMatches.map((item, index) => ([{ text: `${start + index + 1}. ${item.title}`, url: item.telegramLink }])),
    [
      ...(page > 0 ? [{ text: '⬅️ Previous', callback_data: `prev|${query}|${page - 1}` }] : []),
      ...(page < totalPages - 1 ? [{ text: 'Next ➡️', callback_data: `next|${query}|${page + 1}` }] : []),
    ],
    [
      { text: 'Join Group 1', url: GROUPS[0].url },
      { text: 'Join Group 2', url: GROUPS[1].url },
    ],
    [
      { text: 'Share Bot', switch_inline_query: '' },
    ],
  ].filter(row => row.length > 0);

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_parameters: { message_id: (ctx.message as { message_id: number }).message_id },
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
}

async function sendSearchJoinMessage(ctx: Context, query: string) {
  const inlineKeyboard = [
    ...GROUPS.map(group => ({ text: `Join ${group.name}`, url: group.url })),
    { text: 'Verify', callback_data: `verify_search|${query}` },
  ];

  await ctx.reply(
    `🔍 Please join all our groups to access the search results for "${query}":`,
    {
      reply_markup: { inline_keyboard: [inlineKeyboard] },
    },
  );
}

async function sendMovieDetails(ctx: Context, movie: MovieItem) {
  const userId = ctx.from?.id;
  if (!userId) {
    console.error('No user ID found');
    await ctx.reply('❌ Unable to verify user.');
    return;
  }

  const membership = await isJoinedAllGroups(ctx, userId);

  if (!membership.joined) {
    const inlineKeyboard = [
      ...membership.missing.map(group => ({ text: `Join ${group.name}`, url: group.url })),
      { text: 'Verify', callback_data: `verify_${movie.key}` },
    ];

    await ctx.reply(
      `🎬 *${movie.title}* (${movie.category})\n\nPlease join all our groups to access the movie:`,
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

  try {
    await ctx.replyWithPhoto(
      movie.poster_path,
      {
        caption: `🎬 *${movie.title}* (${movie.category})\n\nWiki: ${movie.wiki_link}\n\nAccess the movie via @SearchMoviesbot_bot.`,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard },
      },
    );
  } catch (e: unknown) {
    console.error(`Failed to send photo for ${movie.title}:`, (e as Error).message || e);
    await ctx.reply(
      `🎬 *${movie.title}* (${movie.category})\n\nWiki: ${movie.wiki_link}\n\nAccess the movie via @SearchMoviesbot_bot.`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: inlineKeyboard },
      },
    );
  }
}

// -------------------- Bot Handler --------------------
export function movieSearch() {
  return async (ctx: Context) => {
    try {
      await dataLoaded; // Wait for data to load

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
        const movieId = query.split(' ')[1].trim();
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

      // For regular search query, check membership
      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.reply('❌ Unable to verify user.');
        return;
      }

      const membership = await isJoinedAllGroups(ctx, userId);
      if (!membership.joined) {
        await sendSearchJoinMessage(ctx, query);
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
      await dataLoaded; // Wait for data to load

      const callbackData = ctx.callbackQuery?.data;
      if (!callbackData) return;

      if (callbackData.startsWith('prev|') || callbackData.startsWith('next|')) {
        const [action, query, pageStr] = callbackData.split('|');
        const page = parseInt(pageStr, 10);
        const matches = rankedMatches(query);
        await sendMovieList(ctx, query, matches, page);
        await ctx.answerCbQuery();
      } else if (callbackData.startsWith('verify_')) {
        if (callbackData.startsWith('verify_search|')) {
          const query = callbackData.slice('verify_search|'.length);
          const userId = ctx.from?.id;
          if (!userId) {
            await ctx.answerCbQuery('❌ Unable to verify user.');
            return;
          }
          const membership = await isJoinedAllGroups(ctx, userId);
          if (!membership.joined) {
            await ctx.answerCbQuery('Please join all groups first.');
            return;
          }
          const matches = rankedMatches(query);
          await sendMovieList(ctx, query, matches, 0);
          await ctx.answerCbQuery('Access granted!');
        } else {
          const movieId = callbackData.slice('verify_'.length);
          const movie = movieData.find((item) => item.key === movieId);
          if (!movie) {
            await ctx.reply('❌ Movie not found.');
            return;
          }
          await sendMovieDetails(ctx, movie);
          await ctx.answerCbQuery();
        }
      }
    } catch (err: unknown) {
      console.error(err);
      await ctx.reply('❌ Something went wrong. Please try again later.');
      await ctx.answerCbQuery();
    }
  };
}
