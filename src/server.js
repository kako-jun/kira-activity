import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { generateAnimatedWebP, generateView, shutdown as shutdownRenderer } from './renderer/webp-generator.js';
import { getPalette, sanitizePalette, VALID_THEMES as PALETTE_THEMES } from './renderer/palette.js';
import { CacheManager } from './services/cache.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const cache = new CacheManager();

// Shared query param contract
const VALID_SOURCES = new Set(['github', 'hatena', 'rss']);
const VALID_THEMES = new Set(PALETTE_THEMES);
const VALID_SIZES = new Set(['small', 'medium', 'large']);
const VALID_VIEWS = new Set(['kira', 'month', 'week', 'auto']);
// GitHub username spec: 1-39 chars, alphanumerics and hyphens.
// We accept underscore too for forward compatibility with hatena IDs.
const USER_PATTERN = /^[A-Za-z0-9_-]{1,39}$/;
// `feed` is a fully qualified http/https URL. We only enforce a coarse shape
// here (scheme + non-whitespace + length cap) because the client-side fetcher
// in services/rss.js will fail loudly on actual network/parse errors.
const FEED_URL_PATTERN = /^https?:\/\/[^\s]{1,2048}$/i;

function parseSharedParams(c) {
  const user = c.req.query('user');
  const source = c.req.query('source') || 'github';
  const theme = c.req.query('theme') || 'film';
  const size = c.req.query('size') || 'medium';
  const view = c.req.query('view') || 'auto';
  const rawFeed = (c.req.query('feed') || '').trim();

  if (!user) {
    return { error: 'user parameter is required' };
  }
  if (!USER_PATTERN.test(user)) {
    return { error: 'invalid user: must match /^[A-Za-z0-9_-]{1,39}$/' };
  }
  if (!VALID_SOURCES.has(source)) {
    return { error: `invalid source: ${source}` };
  }
  if (!VALID_THEMES.has(theme)) {
    return { error: `invalid theme: ${theme}` };
  }
  if (!VALID_SIZES.has(size)) {
    return { error: `invalid size: ${size}` };
  }
  if (!VALID_VIEWS.has(view)) {
    return { error: `invalid view: ${view}` };
  }

  // `feed` is required when source=rss and ignored otherwise. We discard it
  // for non-rss sources so it does not pollute the cache key (or accidentally
  // feed into a future provider that hasn't opted in to it yet).
  let feed;
  if (source === 'rss') {
    if (!rawFeed) {
      return { error: 'feed parameter is required when source=rss' };
    }
    if (!FEED_URL_PATTERN.test(rawFeed)) {
      return { error: 'invalid feed: must be an http(s) URL' };
    }
    feed = rawFeed;
  } else {
    feed = undefined;
  }

  // Resolve palette once per request and pass it down. Sanitized so any
  // accidental non-hex value is replaced before it reaches CSS injection.
  const palette = sanitizePalette(getPalette(theme, source));

  return { user, source, theme, size, view, palette, feed };
}

// Eager load template at module init. Failing fast at startup is preferable
// to lazily failing on the first request.
const EMBED_TEMPLATE = readFileSync(join(__dirname, 'renderer', 'embed.html'), 'utf-8');

/**
 * Render the embed template by replacing __USER__ / __SOURCE__ / __THEME__ /
 * __SIZE__ / __VIEW__ placeholders (script context, JSON-encoded) and
 * __PALETTE_*__ placeholders (CSS context, raw hex strings) in a single pass.
 *
 * Two contexts, two escaping strategies:
 *   - Script-context placeholders (USER/SOURCE/THEME/SIZE/VIEW) are
 *     JSON.stringify'd and have `<` escaped to `<` so a payload like
 *     `?user=</script>...` cannot break out of the script.
 *   - CSS-context placeholders (PALETTE_*) carry palette tokens that come
 *     from sanitizePalette() and are guaranteed `^#[0-9a-fA-F]{6}$`. They
 *     are emitted raw, suitable for `--kira-bg: #xxxxxx;`.
 *
 * Single-pass replacement also prevents placeholder collisions: a value such
 * as `?user=zzz__VIEW__zzz` cannot accidentally inject into a later
 * placeholder slot the way chained `.replace()` calls allowed.
 */
function renderEmbed(params) {
  const scriptMap = {
    USER: params.user,
    SOURCE: params.source,
    THEME: params.theme,
    SIZE: params.size,
    VIEW: params.view,
    // null when source != rss so the embed JS can skip appending &feed=.
    FEED: params.feed ?? null
  };
  const cssMap = {
    PALETTE_BG: params.palette.background,
    PALETTE_INK: params.palette.ink,
    PALETTE_GRID: params.palette.grid,
    PALETTE_ACCENT: params.palette.accent,
    PALETTE_HIGHLIGHT: params.palette.highlight
  };
  return EMBED_TEMPLATE.replace(
    /__(USER|SOURCE|THEME|SIZE|VIEW|FEED|PALETTE_BG|PALETTE_INK|PALETTE_GRID|PALETTE_ACCENT|PALETTE_HIGHLIGHT)__/g,
    (_, k) => {
      if (k in cssMap) return cssMap[k];
      return JSON.stringify(scriptMap[k]).replace(/</g, '\\u003c');
    }
  );
}

const app = new Hono();

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', message: 'KIRA Activity Server is running' });
});

/**
 * /embed — canonical renderer (HTML for iframe usage).
 * /api/graph is a WebP export over this same renderer with view=auto.
 */
app.get('/embed', (c) => {
  const params = parseSharedParams(c);
  if (params.error) {
    return c.json({ error: params.error }, 400);
  }

  const html = renderEmbed(params);

  c.header('Cache-Control', 'public, max-age=3600');
  return c.html(html);
});

/**
 * /api/graph — WebP export of /embed.
 * - view=auto (default): animated playback of all views
 * - view=kira|month|week: single-view static export
 */
app.get('/api/graph', async (c) => {
  const params = parseSharedParams(c);
  if (params.error) {
    return c.json({ error: params.error }, 400);
  }

  const { user, source, theme, size, view, palette, feed } = params;

  try {
    // Encode the feed URL into a short stable suffix so two different feeds
    // for the same source=rss don't collide in cache. base64url is safe for
    // a cache key (no '/', '+', '='). Truncating to 16 chars keeps the key
    // compact at the cost of a ~10^-9 collision risk per user, which is
    // acceptable for a 1-hour cached image.
    const feedKey = feed ? `_${Buffer.from(feed).toString('base64url').slice(0, 16)}` : '';
    const cacheKey = `graph_${source}_${user}_${theme}_${size}_${view}${feedKey}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return new Response(cached, {
        headers: {
          'Content-Type': 'image/webp',
          'Cache-Control': 'public, max-age=3600'
        }
      });
    }

    const webpBuffer = view === 'auto'
      ? await generateAnimatedWebP(user, source, theme, size, palette, feed)
      : await generateView(user, source, view, theme, size, palette, feed);

    cache.set(cacheKey, webpBuffer);

    return new Response(webpBuffer, {
      headers: {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (error) {
    console.error('Error generating graph:', error);
    return c.json({ error: 'Failed to generate graph', details: error.message }, 500);
  }
});

// Demo page
app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>KIRA Activity - Death Note Style Activity Graph</title>
  <style>
    body {
      font-family: 'Courier New', monospace;
      background: #000;
      color: #0f0;
      padding: 20px;
      text-align: center;
    }
    h1 { color: #f00; text-shadow: 0 0 10px #f00; }
    .container { max-width: 800px; margin: 0 auto; }
    input, select {
      background: #111;
      color: #0f0;
      border: 1px solid #0f0;
      padding: 10px;
      margin: 10px;
      font-family: 'Courier New', monospace;
    }
    button {
      background: #f00;
      color: #000;
      border: none;
      padding: 10px 20px;
      cursor: pointer;
      font-weight: bold;
    }
    button:hover { background: #ff3333; }
    .result { margin-top: 20px; }
    .example { margin-top: 40px; text-align: left; }
    code { background: #111; padding: 2px 5px; }
    iframe { width: 100%; max-width: 800px; height: 480px; border: 1px solid #0f0; }
  </style>
</head>
<body>
  <div class="container">
    <h1>KIRA ACTIVITY</h1>
    <p>Death Note L-Style Activity Visualization</p>

    <div>
      <input type="text" id="username" placeholder="Username" />
      <select id="view">
        <option value="auto">auto (animated)</option>
        <option value="kira">kira (3D)</option>
        <option value="month">month (calendar)</option>
        <option value="week">week (line)</option>
      </select>
      <button onclick="showEmbed()">Show /embed</button>
      <button onclick="showGraph()">Export /api/graph</button>
    </div>

    <div class="result" id="result"></div>

    <div class="example">
      <h3>Endpoints</h3>
      <p><code>/embed?user=USER&view=auto</code> - canonical iframe renderer</p>
      <p><code>/api/graph?user=USER</code> - WebP export (view=auto by default)</p>
      <p><code>/api/graph?user=USER&view=kira</code> - single-view static WebP</p>

      <h3>Shared parameters</h3>
      <p><code>user</code> required</p>
      <p><code>source</code> github | hatena (default github)</p>
      <p><code>theme</code> film | github | hatena | sepia | mono (default film)</p>
      <p><code>size</code> small | medium | large (default medium)</p>
      <p><code>view</code> kira | month | week | auto (default auto)</p>
    </div>
  </div>

  <script>
    function showEmbed() {
      const username = document.getElementById('username').value;
      const view = document.getElementById('view').value;
      if (!username) { alert('Enter a username'); return; }
      const result = document.getElementById('result');
      result.innerHTML = '<iframe src="/embed?user=' + encodeURIComponent(username) + '&view=' + view + '"></iframe>';
    }
    function showGraph() {
      const username = document.getElementById('username').value;
      const view = document.getElementById('view').value;
      if (!username) { alert('Enter a username'); return; }
      const result = document.getElementById('result');
      result.innerHTML = '<p>Generating...</p>';
      const img = new Image();
      img.src = '/api/graph?user=' + encodeURIComponent(username) + '&view=' + view;
      img.onload = () => { result.innerHTML = ''; result.appendChild(img); };
      img.onerror = () => { result.innerHTML = '<p style="color:#f00;">Failed</p>'; };
    }
  </script>
</body>
</html>`);
});

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`KIRA Activity Server running on http://localhost:${info.port}`);
  console.log(`L analysis mode: ACTIVE`);
});

async function gracefulShutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  await new Promise((resolve) => {
    if (server && typeof server.close === 'function') server.close(() => resolve());
    else resolve();
  });
  try {
    await shutdownRenderer();
  } catch (err) {
    console.error('Error during renderer shutdown:', err);
  }
  process.exit(0);
}

process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });
