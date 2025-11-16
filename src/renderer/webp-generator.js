import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { GitHubClient } from '../services/github.js';
import { HatenaBookmarkClient } from '../services/hatena.js';
import { DataProcessor } from '../utils/data-processor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const githubClient = new GitHubClient();
const hatenaClient = new HatenaBookmarkClient();

// Singleton browser instance for better performance
let browserInstance = null;
let htmlTemplate = null; // Cache HTML template

/**
 * Get or create browser instance (singleton pattern)
 */
async function getBrowser() {
  if (!browserInstance || !browserInstance.isConnected()) {
    console.log('🚀 Launching browser instance...');
    browserInstance = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security', // Faster rendering
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });

    // Cleanup on process exit
    process.on('exit', async () => {
      if (browserInstance) {
        await browserInstance.close();
      }
    });
  }
  return browserInstance;
}

/**
 * Get HTML template (cached)
 */
function getHTMLTemplate() {
  if (!htmlTemplate) {
    const htmlPath = join(__dirname, 'graph.html');
    htmlTemplate = readFileSync(htmlPath, 'utf-8');
  }
  return htmlTemplate;
}

/**
 * Generate animated WebP showing all 4 steps (OPTIMIZED - parallel rendering)
 * @param {string} username - Username (GitHub or Hatena)
 * @param {string} source - 'github' or 'hatena'
 * @param {string} style - Visualization style
 * @param {string} size - 'small', 'medium', 'large'
 * @returns {Promise<Buffer>} WebP buffer
 */
export async function generateAnimatedWebP(username, source, style, size) {
  console.log(`🎬 Generating animated WebP for ${username} (${source})...`);

  // Fetch activity data
  const activityData = await fetchActivityData(username, source);
  const processedData = DataProcessor.process(activityData);

  // OPTIMIZATION: Generate all 4 frames in parallel
  console.log('⚡ Rendering all 4 steps in parallel...');
  const startTime = Date.now();

  const framePromises = [1, 2, 3, 4].map(step =>
    renderStep(processedData, step, style, size)
  );

  const frames = await Promise.all(framePromises);
  const renderTime = Date.now() - startTime;
  console.log(`✅ Rendered 4 frames in ${renderTime}ms (parallel)`);

  // Create animated WebP
  const delays = [1500, 1500, 1500, 3000]; // ms per frame
  const webpBuffer = await createAnimatedWebP(frames, delays);

  console.log(`✅ Generated animated WebP (${webpBuffer.length} bytes)`);
  return webpBuffer;
}

/**
 * Generate single frame for specific step
 * @param {string} username - Username
 * @param {string} source - 'github' or 'hatena'
 * @param {number} step - Step number (1-4)
 * @param {string} style - Visualization style
 * @returns {Promise<Buffer>} WebP buffer
 */
export async function generateFrame(username, source, step, style) {
  console.log(`📸 Generating frame ${step} for ${username} (${source})...`);

  // Fetch activity data
  const activityData = await fetchActivityData(username, source);
  const processedData = DataProcessor.process(activityData);

  // Render the specific step
  const frame = await renderStep(processedData, step, style, 'medium');

  // Convert to WebP
  const webpBuffer = await sharp(frame)
    .webp({ quality: 90 })
    .toBuffer();

  console.log(`✅ Generated frame ${step} (${webpBuffer.length} bytes)`);
  return webpBuffer;
}

/**
 * Fetch activity data from source
 */
async function fetchActivityData(username, source) {
  console.log(`📡 Fetching ${source} data for ${username}...`);

  if (source === 'github') {
    return await githubClient.getComprehensiveActivity(username);
  } else if (source === 'hatena') {
    return await hatenaClient.getComprehensiveActivity(username);
  } else {
    throw new Error(`Unknown source: ${source}`);
  }
}

/**
 * Render a specific step using Puppeteer (OPTIMIZED - reuses browser)
 */
async function renderStep(processedData, step, style, size) {
  const browser = await getBrowser(); // Reuse browser instance
  const page = await browser.newPage();

  try {
    // Set viewport size based on size parameter
    const dimensions = getSizeDimensions(size);
    await page.setViewport(dimensions);

    // Load cached HTML template
    const htmlContent = getHTMLTemplate();

    // Inject data and configuration
    const injectedHTML = htmlContent.replace(
      '</head>',
      `<script>
        window.ACTIVITY_DATA = ${JSON.stringify(processedData)};
        window.RENDER_STEP = ${step};
        window.RENDER_STYLE = '${style}';
      </script></head>`
    );

    await page.setContent(injectedHTML, { waitUntil: 'networkidle0' });

    // Wait for rendering (optimized timing)
    const waitTime = step === 1 ? 2500 : (step === 2 ? 4000 : (step === 4 ? 4000 : 1500));
    await new Promise(resolve => setTimeout(resolve, waitTime));

    // Take screenshot
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: false,
      captureBeyondViewport: false // Optimization
    });

    return screenshot;
  } finally {
    await page.close(); // Close page, but keep browser alive
  }
}

/**
 * Create animated WebP from frames (OPTIMIZED - parallel conversion)
 */
async function createAnimatedWebP(frames, delays) {
  // OPTIMIZATION: Convert all frames to WebP in parallel
  const webpFrames = await Promise.all(
    frames.map((frame, index) =>
      sharp(frame)
        .webp({ quality: 80, effort: 4 }) // effort: 4 is balanced (0-6 range)
        .toBuffer()
    )
  );

  // sharp doesn't support animated WebP directly, so we'll use the first approach:
  // Return the last frame (Step 4) as a static image for now
  // TODO: Implement proper animated WebP using ffmpeg or libwebp
  console.log('⚠️  Note: Returning static WebP (last frame). Animated WebP requires ffmpeg.');

  return webpFrames[webpFrames.length - 1]; // Return step 4 for now
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
      return { width: 1200, height: 630 }; // GitHub social preview size
  }
}

/**
 * Graceful shutdown - close browser
 */
export async function shutdown() {
  if (browserInstance) {
    console.log('🛑 Shutting down browser...');
    await browserInstance.close();
    browserInstance = null;
  }
}
