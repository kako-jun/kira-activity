import express from 'express';
import dotenv from 'dotenv';
import { generateAnimatedWebP, generateFrame } from './renderer/webp-generator.js';
import { CacheManager } from './services/cache.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const cache = new CacheManager();

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'KIRA Activity Server is running' });
});

// API: Generate animated WebP (all steps)
app.get('/api/graph', async (req, res) => {
  try {
    const { user, source = 'github', style = 'deathnote', size = 'medium' } = req.query;

    if (!user) {
      return res.status(400).json({ error: 'User parameter is required' });
    }

    // Check cache
    const cacheKey = `graph_${source}_${user}_${style}_${size}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      res.set('Content-Type', 'image/webp');
      res.set('Cache-Control', 'public, max-age=3600');
      return res.send(cached);
    }

    // Generate WebP
    const webpBuffer = await generateAnimatedWebP(user, source, style, size);

    // Cache the result
    cache.set(cacheKey, webpBuffer);

    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(webpBuffer);
  } catch (error) {
    console.error('Error generating graph:', error);
    res.status(500).json({ error: 'Failed to generate graph', details: error.message });
  }
});

// API: Generate single frame (specific step)
app.get('/api/frame', async (req, res) => {
  try {
    const { user, source = 'github', step = '4', style = 'deathnote' } = req.query;

    if (!user) {
      return res.status(400).json({ error: 'User parameter is required' });
    }

    const stepNum = parseInt(step, 10);
    if (stepNum < 1 || stepNum > 4) {
      return res.status(400).json({ error: 'Step must be between 1 and 4' });
    }

    // Check cache
    const cacheKey = `frame_${source}_${user}_${step}_${style}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      res.set('Content-Type', 'image/webp');
      res.set('Cache-Control', 'public, max-age=3600');
      return res.send(cached);
    }

    // Generate frame
    const webpBuffer = await generateFrame(user, source, stepNum, style);

    // Cache the result
    cache.set(cacheKey, webpBuffer);

    res.set('Content-Type', 'image/webp');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(webpBuffer);
  } catch (error) {
    console.error('Error generating frame:', error);
    res.status(500).json({ error: 'Failed to generate frame', details: error.message });
  }
});

// Demo page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
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
        input {
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
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📓 KIRA ACTIVITY</h1>
        <p>Death Note L-Style GitHub Activity Visualization</p>

        <div>
          <input type="text" id="username" placeholder="GitHub Username" />
          <button onclick="generateGraph()">Generate Graph</button>
        </div>

        <div class="result" id="result"></div>

        <div class="example">
          <h3>Usage Examples:</h3>
          <p><code>/api/graph?user=torvalds</code> - Animated WebP</p>
          <p><code>/api/frame?user=torvalds&step=1</code> - Step 1: Random list</p>
          <p><code>/api/frame?user=torvalds&step=2</code> - Step 2: Calendar view</p>
          <p><code>/api/frame?user=torvalds&step=3</code> - Step 3: Weekly bar chart</p>
          <p><code>/api/frame?user=torvalds&step=4</code> - Step 4: 3D graph</p>
        </div>
      </div>

      <script>
        function generateGraph() {
          const username = document.getElementById('username').value;
          if (!username) {
            alert('Please enter a GitHub username');
            return;
          }

          const resultDiv = document.getElementById('result');
          resultDiv.innerHTML = '<p>Generating graph... (this may take a few seconds)</p>';

          const img = new Image();
          img.src = '/api/graph?user=' + encodeURIComponent(username);
          img.onload = () => {
            resultDiv.innerHTML = '';
            resultDiv.appendChild(img);

            const markdown = \`![Activity Graph](${window.location.origin}/api/graph?user=${encodeURIComponent(username)})\`;
            resultDiv.innerHTML += '<p>Markdown for README:</p><code>' + markdown + '</code>';
          };
          img.onerror = () => {
            resultDiv.innerHTML = '<p style="color: #f00;">Failed to generate graph. Check console for errors.</p>';
          };
        }
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🎬 KIRA Activity Server running on http://localhost:${PORT}`);
  console.log(`📓 L's analysis mode: ACTIVE`);
});
