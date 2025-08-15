import { Context } from 'telegraf';
import { fetch } from 'undici';

// Interface for movie items
interface MovieItem {
  category: string;
  title: string;
  key: string;
  telegramLink: string;
}

function createTelegramLink(key: string): string {
  return `https://t.me/MovieSearchBot?start=${key}`;
}

let movieData: MovieItem[] = [];
async function initializeMovieData(): Promise<void> {
  const sources = [
    { category: '1950-1989', url: 'https://raw.githubusercontent.com/itzfew/MoviesBot/master/data/bollywood5089.csv' },
    { category: '1990-2009', url: 'https://raw.githubusercontent.com/itzfew/MoviesBot/master/data/bollywood9009.csv'' },
    { category: '2010-2019', url: 'https://raw.githubusercontent.com/itzfew/MoviesBot/master/data/bollywood1019.csv'' },
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
        const title = line.slice(0, lastComma).trim(); // Title may have commas, but this captures it fully

        if (!title || !imdb_id || !poster_path || !wiki_link) continue;

        const key = imdb_id;
        const tgLink = createTelegramLink(key);

        output.push({
          category: source.category,
          title,
          key,
          telegramLink: tgLink,
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

const defaultInstructions = [
  {
    tag: 'p',
    children: [
      '🎬 How to watch: ',
      {
        tag: 'a',
        attrs: { href: 'https://youtu.be/your-movie-guide-link' },
        children: ['Watch Guide'],
      },
    ],
  },
  {
    tag: 'p',
    children: ['📢 Join our movie channels:'],
  },
  {
    tag: 'ul',
    children: [
      {
        tag: 'li',
        children: [{ tag: 'a', attrs: { href: 'https://t.me/MovieSearchBot' }, children: ['@MovieSearchBot'] }, ' - Search for movies'],
      },
    ],
  },
];

let accessToken: string | null = null;
interface TelegraphResponse {
  ok: boolean;
  result?: { access_token?: string; path?: string };
  error?: string;
}

async function createTelegraphAccount() {
  const res = await fetch('https://api.telegra.ph/createAccount', {
    method: 'POST',
    body: new URLSearchParams({ short_name: 'moviebot', author_name: 'Movie Bot' }),
  });
  const data = (await res.json()) as TelegraphResponse;
  if (data.ok && data.result?.access_token) accessToken = data.result.access_token;
  else throw new Error(data.error || 'Failed to create Telegraph account');
}

async function createTelegraphPageForMatches(query: string, matches: MovieItem[]): Promise<string> {
  if (!accessToken) await createTelegraphAccount();

  const content = [
    { tag: 'h3', children: [`Search results for: "${query}"`] },
    { tag: 'p', children: [`Found ${matches.length} movies:`] },
    {
      tag: 'ul',
      children: matches.map((item) => ({
        tag: 'li',
        children: [
          '• ',
          { tag: 'a', attrs: { href: item.telegramLink, target: '_blank' }, children: [item.title] },
          ` (${item.category})`,
        ],
      })),
    },
    { tag: 'hr' },
    { tag: 'h4', children: ['ℹ️ Instructions & Links'] },
    ...defaultInstructions,
    { tag: 'p', attrs: { style: 'color: gray; font-size: 0.8em' }, children: ['Generated by Movie Bot'] },
  ];

  const res = await fetch('https://api.telegra.ph/createPage', {
    method: 'POST',
    body: new URLSearchParams({
      access_token: accessToken!,
      title: `Movies: ${query.slice(0, 50)}`,
      author_name: 'Movie Bot',
      content: JSON.stringify(content),
      return_content: 'true',
    }),
  });

  const data = (await res.json()) as TelegraphResponse;
  if (data.ok && data.result?.path) return `https://telegra.ph/${data.result.path}`;
  throw new Error(data.error || 'Failed to create Telegraph page');
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

      const mention =
        ctx.chat?.type?.includes('group') && ctx.from?.username
          ? `@${ctx.from.username}`
          : ctx.from?.first_name || '';

      const matches = rankedMatches(query);
      if (matches.length === 0) {
        await ctx.reply(`❌ ${mention}, no movies found for "${query}".`, {
          reply_parameters: { message_id: message.message_id },
        });
        return;
      }

      const telegraphURL = await createTelegraphPageForMatches(query, matches);
      const shortQuery = query.split(/\s+/).slice(0, 3).join(' ');

      await ctx.reply(
        `🔍 ${mention}, found *${matches.length}* matches for *${shortQuery}*:\n[View movies](${telegraphURL})`,
        {
          parse_mode: 'Markdown',
          link_preview_options: { is_disabled: true },
          reply_parameters: { message_id: message.message_id },
        },
      );
    } catch (err: unknown) {
      console.error(err);
      await ctx.reply('❌ Something went wrong. Please try again later.', {
        reply_parameters: { message_id: (ctx.message as { message_id: number })?.message_id },
      });
    }
  };
}
