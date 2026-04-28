import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { generateAnimatedWebP, generateView } from './renderer/webp-generator.js';
import { CacheManager } from './services/cache.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const cache = new CacheManager();

// Shared query param contract
const VALID_SOURCES = new Set(['github', 'hatena']);
const VALID_THEMES = new Set(['deathnote']);
const VALID_SIZES = new Set(['small', 'medium', 'large']);
const VALID_VIEWS = new Set(['kira', 'month', 'week', 'auto']);

function parseSharedParams(c) {
  const user = c.req.query('user');
  const source = c.req.query('source') || 'github';
  const theme = c.req.query('theme') || 'deathnote';
  const size = c.req.query('size') || 'medium';
  const view = c.req.query('view') || 'auto';

  if (!user) {
    return { error: 'user parameter is required' };
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

  return { user, source, theme, size, view };
}

let embedTemplate = null;
function getEmbedTemplate() {
  if (!embedTemplate) {
    const htmlPath = join(__dirname, 'renderer', 'embed.html');
    embedTemplate = readFileSync(htmlPath, 'utf-8');
  }
  return embedTemplate;
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

  const html = getEmbedTemplate()
    .replace('__USER__', JSON.stringify(params.user))
    .replace('__SOURCE__', JSON.stringify(params.source))
    .replace('__THEME__', JSON.stringify(params.theme))
    .replace('__SIZE__', JSON.stringify(params.size))
    .replace('__VIEW__', JSON.stringify(params.view));

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

  const { user, source, theme, size, view } = params;

  try {
    const cacheKey = `graph_${source}_${user}_${theme}_${size}_${view}`;
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
      ? await generateAnimatedWebP(user, source, theme, size)
      : await generateView(user, source, view, theme, size);

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
        <option value="week">week (overlay)</option>
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
      <p><code>theme</code> deathnote (default deathnote)</p>
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

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`KIRA Activity Server running on http://localhost:${info.port}`);
  console.log(`L analysis mode: ACTIVE`);
});
