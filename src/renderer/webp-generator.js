import puppeteer from 'puppeteer';
import sharp from 'sharp';
import webpmux from 'node-webpmux';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { fetchActivity } from '../services/registry.js';
import { DataProcessor } from '../utils/data-processor.js';
import { getPalette, sanitizePalette } from './palette.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
 * @param {string} username - User identifier or display label (depends on source)
 * @param {string} source - SUPPORTED_SOURCES のいずれか ('github' | 'hatena' | 'rss')
 * @param {string} theme - Visualization theme. VALID_THEMES のいずれか
 *   ('film' | 'github' | 'hatena' | 'sepia' | 'mono')。それ以外は film にフォールバック。
 * @param {string} size - 'small' | 'medium' | 'large'
 * @param {object} [palette] - Resolved palette from server. If omitted, resolved here.
 * @param {string} [feed] - Feed URL when source='rss'. Ignored otherwise.
 * @returns {Promise<Buffer>} WebP buffer
 */
export async function generateAnimatedWebP(username, source, theme, size, palette, feed) {
  console.log(`Generating animated WebP for ${username} (${source}, theme=${theme})...`);

  const resolvedPalette = sanitizePalette(palette ?? getPalette(theme, source));

  const activityData = await fetchActivityData(username, source, feed);
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
 * @param {string} source - SUPPORTED_SOURCES のいずれか ('github' | 'hatena' | 'rss')
 * @param {'kira'|'month'|'week'} view
 * @param {string} theme - VALID_THEMES のいずれか
 *   ('film' | 'github' | 'hatena' | 'sepia' | 'mono')。それ以外は film にフォールバック。
 * @param {string} size
 * @param {object} [palette] - Resolved palette from server. If omitted, resolved here.
 * @param {string} [feed] - Feed URL when source='rss'. Ignored otherwise.
 * @returns {Promise<Buffer>} WebP buffer
 */
export async function generateView(username, source, view, theme, size, palette, feed) {
  const scene = VIEW_TO_SCENE[view];
  if (!scene) {
    throw new Error(`Unknown view: ${view}`);
  }

  console.log(`Generating view '${view}' for ${username} (${source})...`);

  const resolvedPalette = sanitizePalette(palette ?? getPalette(theme, source));

  const activityData = await fetchActivityData(username, source, feed);
  const processedData = DataProcessor.process(activityData);

  const frame = await renderScene(processedData, scene, theme, size, resolvedPalette);

  const webpBuffer = await sharp(frame)
    .webp({ quality: 90 })
    .toBuffer();

  console.log(`Generated view '${view}' (${webpBuffer.length} bytes)`);
  return webpBuffer;
}

/**
 * Fetch normalized activity via the provider registry.
 * Source-specific branches now live in services/registry.js, not here.
 */
async function fetchActivityData(username, source, feed) {
  console.log(`Fetching ${source} data for ${username}...`);
  return await fetchActivity(source, { user: username, feed });
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
 * Combine PNG frames (one per view) into a single animated WebP.
 *
 * Sharp does not support encoding animated WebP from a set of static frames:
 * its animated output path only works when re-encoding already-animated
 * input (GIF / animated WebP / multi-page TIFF). `sharp(arr, { join: { animated: true } })`
 * silently produces a single-page WebP with no VP8X / ANIM / ANMF chunks.
 *
 * We therefore encode each PNG frame as a static lossy WebP via sharp,
 * then mux them into a true animated WebP container (VP8X + ANIM + N x ANMF)
 * with node-webpmux (pure JS, no native deps). Delays / loops are set on
 * the muxer.
 *
 * Frames must already share W x H (Puppeteer renders all views with the
 * same viewport via getSizeDimensions). Per-frame delays must match the
 * order of frames (here ALL_VIEWS = kira -> month -> week).
 *
 * @param {Buffer[]} frames - PNG buffers, one per view
 * @param {number[]} delays - Per-frame display duration in ms
 * @returns {Promise<Buffer>} Animated WebP buffer
 */
async function createAnimatedWebP(frames, delays) {
  if (!frames.length) {
    throw new Error('No frames to combine');
  }
  if (delays.length !== frames.length) {
    throw new Error(`delays (${delays.length}) must match frames (${frames.length})`);
  }

  // Single-frame case: skip muxing, just return a plain static WebP.
  if (frames.length === 1) {
    return sharp(frames[0]).webp({ quality: 80, effort: 4 }).toBuffer();
  }

  // Encode each PNG frame as a static lossy WebP (smaller than PNG, and
  // node-webpmux's generateFrame consumes WebP buffers).
  const webpFrames = await Promise.all(
    frames.map((png) => sharp(png).webp({ quality: 80, effort: 4 }).toBuffer())
  );

  const Image = webpmux.Image;
  await Image.initLib();

  // Determine the output canvas size from the first encoded frame so the
  // muxed VP8X header reports the correct dimensions.
  const firstMeta = await sharp(webpFrames[0]).metadata();
  const width = firstMeta.width;
  const height = firstMeta.height;

  const muxFrames = [];
  for (let i = 0; i < webpFrames.length; i++) {
    const f = await Image.generateFrame({
      buffer: webpFrames[i],
      delay: delays[i]
    });
    muxFrames.push(f);
  }

  // loops: 0 = infinite (WebP standard).
  return Image.save(null, {
    frames: muxFrames,
    width,
    height,
    loops: 0
  });
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
