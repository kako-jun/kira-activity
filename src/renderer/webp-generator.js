import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { GitHubClient } from '../services/github.js';
import { HatenaBookmarkClient } from '../services/hatena.js';
import { DataProcessor } from '../utils/data-processor.js';
import { getPalette, sanitizePalette } from './palette.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const githubClient = new GitHubClient();
const hatenaClient = new HatenaBookmarkClient();

// Singleton browser instance for better performance
let browserInstance = null;

// Eager load the renderer HTML template at module init.
const HTML_TEMPLATE = readFileSync(join(__dirname, 'graph.html'), 'utf-8');

/**
 * Internal mapping: public view names -> renderer scene number.
 * The graph.html renderer still uses numeric scene IDs internally;
 * this is the only place where the public/internal vocabulary meets.
 */
const VIEW_TO_SCENE = {
  kira: 4,
  month: 2,
  week: 3
};

const ALL_VIEWS = ['kira', 'month', 'week'];

/**
 * Get or create browser instance (singleton pattern)
 */
async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    console.log('Launching browser instance...');
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });
    // Note: SIGTERM/SIGINT shutdown is wired up in server.js, which awaits
    // shutdown() before exiting. process.on('exit') cannot run async work,
    // so we don't register it here.
  }
  return browserInstance;
}

/**
 * Generate animated WebP cycling through kira -> month -> week.
 * Used by /api/graph?view=auto (the canonical export of /embed).
 *
 * @param {string} username - Username (GitHub or Hatena)
 * @param {string} source - 'github' or 'hatena'
 * @param {string} theme - Visualization theme. VALID_THEMES のいずれか
 *   ('film' | 'github' | 'hatena' | 'sepia' | 'mono')。それ以外は film にフォールバック。
 * @param {string} size - 'small' | 'medium' | 'large'
 * @param {object} [palette] - Resolved palette from server. If omitted, resolved here.
 * @returns {Promise<Buffer>} WebP buffer
 */
export async function generateAnimatedWebP(username, source, theme, size, palette) {
  console.log(`Generating animated WebP for ${username} (${source}, theme=${theme})...`);

  const resolvedPalette = sanitizePalette(palette ?? getPalette(theme, source));

  const activityData = await fetchActivityData(username, source);
  const processedData = DataProcessor.process(activityData);

  console.log('Rendering all views in parallel...');
  const startTime = Date.now();

  const framePromises = ALL_VIEWS.map((view) =>
    renderScene(processedData, VIEW_TO_SCENE[view], theme, size, resolvedPalette)
  );

  const frames = await Promise.all(framePromises);
  const renderTime = Date.now() - startTime;
  console.log(`Rendered ${frames.length} frames in ${renderTime}ms (parallel)`);

  // Per-frame delays in ms, matching ALL_VIEWS order (kira, month, week).
  // These are the same dwell times used by /embed VIEW_DELAYS and the
  // per-scene waitTime in renderScene(), so the iframe and the export
  // feel identical.
  const FRAME_DELAYS = [4000, 2500, 5000];

  const webpBuffer = await createAnimatedWebP(frames, FRAME_DELAYS);

  console.log(`Generated animated WebP (${webpBuffer.length} bytes)`);
  return webpBuffer;
}

/**
 * Generate a single-view WebP export.
 * Used by /api/graph?view=kira|month|week.
 *
 * @param {string} username
 * @param {string} source - 'github' | 'hatena'
 * @param {'kira'|'month'|'week'} view
 * @param {string} theme - VALID_THEMES のいずれか
 *   ('film' | 'github' | 'hatena' | 'sepia' | 'mono')。それ以外は film にフォールバック。
 * @param {string} size
 * @param {object} [palette] - Resolved palette from server. If omitted, resolved here.
 * @returns {Promise<Buffer>} WebP buffer
 */
export async function generateView(username, source, view, theme, size, palette) {
  const scene = VIEW_TO_SCENE[view];
  if (!scene) {
    throw new Error(`Unknown view: ${view}`);
  }

  console.log(`Generating view '${view}' for ${username} (${source})...`);

  const resolvedPalette = sanitizePalette(palette ?? getPalette(theme, source));

  const activityData = await fetchActivityData(username, source);
  const processedData = DataProcessor.process(activityData);

  const frame = await renderScene(processedData, scene, theme, size, resolvedPalette);

  const webpBuffer = await sharp(frame)
    .webp({ quality: 90 })
    .toBuffer();

  console.log(`Generated view '${view}' (${webpBuffer.length} bytes)`);
  return webpBuffer;
}

/**
 * Fetch activity data from source
 */
async function fetchActivityData(username, source) {
  console.log(`Fetching ${source} data for ${username}...`);

  if (source === 'github') {
    return await githubClient.getComprehensiveActivity(username);
  } else if (source === 'hatena') {
    return await hatenaClient.getComprehensiveActivity(username);
  } else {
    throw new Error(`Unknown source: ${source}`);
  }
}

/**
 * Render a specific scene using Puppeteer (reuses browser).
 * Internal `scene` is a numeric scene ID consumed by graph.html.
 */
async function renderScene(processedData, scene, theme, size, palette) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    const dimensions = getSizeDimensions(size);
    await page.setViewport(dimensions);

    // Same XSS-safe pattern used for ACTIVITY_DATA / RENDER_THEME (see PR #11):
    // JSON-encode then escape `<` to `<` so a `</script>` payload cannot
    // break out of the injected script context. Palette values are already
    // hex-only via sanitizePalette() but we still pipe them through the same
    // escape for symmetry.
    const safeData = JSON.stringify(processedData).replace(/</g, '\\u003c');
    const safeTheme = JSON.stringify(theme).replace(/</g, '\\u003c');
    const safePalette = JSON.stringify(palette).replace(/</g, '\\u003c');
    const injectedHTML = HTML_TEMPLATE.replace(
      '</head>',
      `<script>
        window.ACTIVITY_DATA = ${safeData};
        window.RENDER_SCENE = ${scene};
        window.RENDER_THEME = ${safeTheme};
        window.RENDER_PALETTE = ${safePalette};
      </script></head>`
    );

    await page.setContent(injectedHTML, { waitUntil: 'networkidle0' });

    // scene=1 (random list) is dev-only auxiliary and not reachable via
    // VIEW_TO_SCENE, so it does not appear here.
    // - kira (4): rotating 3D surface, hold for the full carousel slot.
    // - week (3): weekly overlay accumulates ~4-12 layers at 400ms each;
    //   wait long enough for the cells to settle.
    // - month (2): static-ish overview, only needs a moment to render.
    const waitTime =
      scene === 4 ? 4000 :
      scene === 3 ? 5000 :
      scene === 2 ? 2500 :
      1500;
    await new Promise((resolve) => setTimeout(resolve, waitTime));

    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: false,
      captureBeyondViewport: false
    });

    return screenshot;
  } finally {
    await page.close();
  }
}

/**
 * Combine frames (one per view) into a single animated WebP.
 *
 * Sharp 0.34+ accepts an array of input buffers with `{ join: { animated: true } }`,
 * which stacks them as pages of a multi-page image. We then encode WebP with
 * per-frame `delay` and `loop: 0` (infinite). Frames must already share W x H
 * (Puppeteer renders all views with the same viewport via getSizeDimensions).
 *
 * Per-frame delays must match the order of frames (here ALL_VIEWS =
 * kira -> month -> week).
 */
async function createAnimatedWebP(frames, delays) {
  if (!frames.length) {
    throw new Error('No frames to combine');
  }

  return sharp(frames, { join: { animated: true } })
    .webp({
      quality: 80,
      effort: 4,
      delay: delays,
      loop: 0
    })
    .toBuffer();
}

/**
 * Get viewport dimensions based on size
 */
function getSizeDimensions(size) {
  switch (size) {
    case 'small':
      return { width: 600, height: 400 };
    case 'large':
      return { width: 1600, height: 900 };
    case 'medium':
    default:
      return { width: 1200, height: 630 };
  }
}

/**
 * Graceful shutdown - close browser
 */
export async function shutdown() {
  if (browserInstance) {
    console.log('Shutting down browser...');
    await browserInstance.close();
    browserInstance = null;
  }
}
