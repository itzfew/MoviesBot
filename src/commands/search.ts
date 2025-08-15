import { Context } from 'telegraf';
import { fetch } from 'undici';

// Movie structure from CSV
interface MovieItem {
  title: string;
  imdb_id: string;
  poster_path: string;
  wiki_link: string;
}

const MOVIE_CSV_URLS = [
  'https://raw.githubusercontent.com/itzfew/Movies-Bot/refs/heads/master/1950-1989/bollywood.csv',
  'https://raw.githubusercontent.com/itzfew/Movies-Bot/refs/heads/master/1990-2009/bollywood.csv',
  'https://raw.githubusercontent.com/itzfew/Movies-Bot/refs/heads/master/2010-2019/bollywood.csv',
];

let movieData: MovieItem[] = [];

async function fetchAndParseCSV(url: string): Promise<MovieItem[]> {
  try {
    const res = await fetch(url);
    const text = await res.text();

    return text
      .split('\n')
      .slice(1) // skip header if exists
      .map(line => line.trim())
      .filter(line => !!line)
      .map(line => {
        const [title, imdb_id, poster_path, wiki_link] = line.split(',').map(s => s.trim());
        return { title, imdb_id, poster_path, wiki_link };
      });
  } catch (err) {
    console.error(`Failed to fetch CSV from ${url}`, err);
    return [];
  }
}

async function initializeMovieData(): Promise<void> {
  const allMovies: MovieItem[] = [];

  for (const url of MOVIE_CSV_URLS) {
    const movies = await fetchAndParseCSV(url);
    allMovies.push(...movies);
  }

  // Remove duplicates based on imdb_id
  const seen = new Set<string>();
  movieData = allMovies.filter(m => {
    if (!m.imdb_id || seen.has(m.imdb_id)) return false;
    seen.add(m.imdb_id);
    return true;
  });

  console.log(`Loaded ${movieData.length} unique movies.`);
}

function rankedMatches(query: string): MovieItem[] {
  const q = query.toLowerCase();
  return movieData
    .map(m => ({
      ...m,
      rank: m.title.toLowerCase().includes(q)
        ? (q.length / m.title.length) * 100
        : 0
    }))
    .filter(m => m.rank > 0)
    .sort((a, b) => b.rank - a.rank);
}

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
      children: matches.map(item => ({
        tag: 'li',
        children: [
          { tag: 'strong', children: [item.title] },
          ' - ',
          { tag: 'a', attrs: { href: item.wiki_link, target: '_blank' }, children: ['Wiki'] },
          ' | ',
          { tag: 'a', attrs: { href: `https://www.imdb.com/title/${item.imdb_id}`, target: '_blank' }, children: ['IMDB'] },
          { tag: 'br' },
          { tag: 'img', attrs: { src: item.poster_path, width: '150' } }
        ]
      }))
    }
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

export function movieSearch() {
  return async (ctx: Context) => {
    try {
      if (movieData.length === 0) {
        await ctx.reply('⏳ Loading movie database, please wait...');
        await initializeMovieData();
      }

      const message = ctx.message as { text?: string; message_id: number } | undefined;
      if (!message?.text) return;

      const query = message.text.trim();
      if (!query) {
        await ctx.reply('❌ Please enter a movie name.', {
          reply_parameters: { message_id: message.message_id },
        });
        return;
      }

      const matches = rankedMatches(query);
      if (matches.length === 0) {
        await ctx.reply(`❌ No movies found for "${query}".`, {
          reply_parameters: { message_id: message.message_id },
        });
        return;
      }

      const telegraphURL = await createTelegraphPageForMatches(query, matches.slice(0, 20)); // Limit results
      await ctx.reply(
        `🔍 Found *${matches.length}* matches for *${query}*:\n[View movies](${telegraphURL})`,
        {
          parse_mode: 'Markdown',
          link_preview_options: { is_disabled: true },
          reply_parameters: { message_id: message.message_id },
        }
      );
    } catch (err) {
      console.error(err);
      await ctx.reply('❌ Something went wrong. Please try again later.', {
        reply_parameters: { message_id: (ctx.message as { message_id: number })?.message_id },
      });
    }
  };
}
