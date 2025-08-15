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
  return `https://t.me/Search_indianMoviesbot?start=${key}`;
}

function createMediaBotLink(key: string): string {
  return `https://t.me/SearchMoviesbot_bot?start=${key}`;
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
  console.log(`Initialized movieData with ${movieData.length} movies`);
}
initializeMovieData().catch((err) => console.error('Failed to initialize movie data:', err));

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

// Group IDs and join URLs (replace chat_ids with actual numeric IDs)
const GROUPS = [
  { id: '-1001234567890', url: 'https://t.me/+2csYKkDagRBhMWRl', name: 'Group 1' }, // Replace id with actual chat_id
  { id: '-1009876543210', url: 'https://t.me/+FUdbdVUKII02M2Jl', name: 'Group 2' }, // Replace id with actual chat_id
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
    ...pageMatches.map((item, index) => ([{ text: `${start + index + 1}. ${item.title}`, url: item.telegramLink }])),
    [
      ...(page > 0 ? [{ text: '⬅️ Previous', callback_data: `prev_${query}_${page - 1}` }] : []),
      ...(page < totalPages - 1 ? [{ text: 'Next ➡️', callback_data: `next_${query}_${page + 1}` }] : []),
    ],
    [
      { text: 'Join Group', url: GROUPS[0].url },
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
    console.error('No user ID found in context');
    await ctx.reply('❌ Unable to verify user.', {
      reply_parameters: { message_id: (ctx.message as { message_id: number })?.message_id },
    });
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
      const message = ctx.message as { text?: string; message_id: number } | undefined;
      if (!message || !('text' in message) || !message.text) {
        console.error('No valid message or text found in context');
        return;
      }

      const query = message.text.trim();
      if (!query) {
        console.error('Empty query received');
        await ctx.reply('❌ Please enter a movie name.', {
          reply_parameters: { message_id: message.message_id },
        });
        return;
      }

      // Handle /start with movie ID
      if (query.startsWith('/start ') && query.split(' ').length > 1) {
        const movieId = query.split(' ')[1].trim();
        console.log(`Processing /start with movieId: ${movieId}`);
        const movie = movieData.find((item) => item.key === movieId);
        if (!movie) {
          console.error(`Movie not found for ID: ${movieId}, movieData length: ${movieData.length}`);
          await ctx.reply('❌ Movie not found.', {
            reply_parameters: { message_id: message.message_id },
          });
          return;
        }
        console.log(`Found movie: ${movie.title} (${movie.key})`);
        await sendMovieDetails(ctx, movie);
        return;
      }

      const matches = rankedMatches(query);
      if (matches.length === 0) {
        console.log(`No matches found for query: ${query}`);
        await ctx.reply(`❌ No movies found for "${query}".`, {
          reply_parameters: { message_id: message.message_id },
        });
        return;
      }

      console.log(`Found ${matches.length} matches for query: ${query}`);
      await sendMovieList(ctx, query, matches, 0);
    } catch (err: unknown) {
      console.error('Error in movieSearch:', (err as Error).message || err);
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
      if (!callbackData) {
        console.error('No callback data received');
        return;
      }

      if (callbackData.startsWith('prev_') || callbackData.startsWith('next_')) {
        const [action, query, pageStr] = callbackData.split('_');
        const page = parseInt(pageStr, 10);
        console.log(`Navigating to page ${page} for query: ${query}`);
        const matches = rankedMatches(query);
        await sendMovieList(ctx, query, matches, page);
        await ctx.answerCbQuery();
      } else if (callbackData.startsWith('verify_')) {
        const movieId = callbackData.split('_')[1];
        console.log(`Verifying membership for movieId: ${movieId}`);
        const movie = movieData.find((item) => item.key === movieId);
        if (!movie) {
          console.error(`Movie not found for ID: ${movieId}`);
          await ctx.reply('❌ Movie not found.');
          return;
        }
        await sendMovieDetails(ctx, movie);
        await ctx.answerCbQuery();
      }
    } catch (err: unknown) {
      console.error('Error in handleCallback:', (err as Error).message || err);
      await ctx.reply('❌ Something went wrong. Please try again later.');
      await ctx.answerCbQuery();
    }
  };
}
