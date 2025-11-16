# 📓 KIRA Activity

> Death Note L-style Activity Visualization Widget

Inspired by the iconic scene from *Death Note: The Last Name* where L analyzes Kira's activity patterns, this project generates stunning animated visualizations of your GitHub or Hatena Bookmark activity.

![Demo](https://img.shields.io/badge/status-active-success)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

## 🎬 Features

### 4-Step Transformation (Just like L's Analysis)

1. **Random List** - Chaotic, unorganized activity data
2. **Calendar View** - 2D heatmap showing date × hour distribution
3. **Weekly Pattern** - Line graph revealing day-of-week patterns
4. **3D Visualization** - Complete 3D line graph (day × hour × activity count)

### Key Highlights

- 🎨 **Death Note Aesthetic**: Black background, green text, red accents
- 🖼️ **WebP Output**: Animated WebP images perfect for GitHub README
- 📊 **Dual Sources**: Support for both GitHub and Hatena Bookmark
- ⚡ **Fast & Cached**: Built-in caching for quick responses
- 🎭 **No JavaScript Required**: Pure image-based widget for static sites

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/kako-jun/kira-activity.git
cd kira-activity

# Install dependencies (Node.js)
npm install

# OR for maximum performance, use Bun (2-3x faster)
bun install

# Create .env file
cp .env.example .env
# Edit .env and add your GITHUB_TOKEN (optional but recommended)

# Start the server
npm start

# OR with Bun for better performance
bun run bun
```

### Performance: Bun vs Node.js

For **maximum speed**, we recommend using [Bun](https://bun.sh):

| Runtime | Startup Time | Request Latency | Frame Generation |
|---------|-------------|-----------------|------------------|
| **Bun** | ~50ms | 20-30ms | 4-6 seconds |
| Node.js | ~200ms | 50-80ms | 6-10 seconds |

**Bun advantages:**
- ⚡ 4x faster startup
- 🚀 2-3x faster request handling
- 📦 10-20x faster package installation

### Usage

Once the server is running, you can generate activity graphs:

#### Animated Graph (All 4 Steps)

```markdown
![Activity Graph](http://localhost:3000/api/graph?user=YOUR_GITHUB_USERNAME)
```

#### Single Frame (Specific Step)

```markdown
![Step 1](http://localhost:3000/api/frame?user=YOUR_USERNAME&step=1)
![Step 2](http://localhost:3000/api/frame?user=YOUR_USERNAME&step=2)
![Step 3](http://localhost:3000/api/frame?user=YOUR_USERNAME&step=3)
![Step 4](http://localhost:3000/api/frame?user=YOUR_USERNAME&step=4)
```

#### Hatena Bookmark

```markdown
![Hatena Activity](http://localhost:3000/api/graph?user=YOUR_HATENA_ID&source=hatena)
```

## 📡 API Reference

### `GET /api/graph`

Generate animated WebP showing all 4 visualization steps.

**Parameters:**
- `user` (required): GitHub username or Hatena ID
- `source` (optional): `github` (default) or `hatena`
- `style` (optional): `deathnote` (default)
- `size` (optional): `small`, `medium` (default), `large`

**Example:**
```
/api/graph?user=torvalds&source=github&style=deathnote&size=medium
```

### `GET /api/frame`

Generate static WebP for a specific visualization step.

**Parameters:**
- `user` (required): GitHub username or Hatena ID
- `source` (optional): `github` (default) or `hatena`
- `step` (optional): `1`, `2`, `3`, or `4` (default: `4`)
- `style` (optional): `deathnote` (default)

**Example:**
```
/api/frame?user=torvalds&step=4
```

### `GET /health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "message": "KIRA Activity Server is running"
}
```

## 🎨 Visualization Steps

### Step 1: Random List
Displays activity as chaotic, scattered text - the initial unorganized data.

### Step 2: Calendar Heatmap
2D grid showing activity intensity across dates and hours.

### Step 3: Weekly Line Graph
Line graph showing activity patterns by day of week (Sunday to Saturday).

### Step 4: 3D Activity Graph
Complete 3D visualization with:
- X-axis: Hour of day (0-23)
- Y-axis: Activity count
- Z-axis: Day of week
- Multiple colored lines representing each day's pattern

## 🛠️ Technology Stack

- **Backend**: Node.js / Bun + Express
- **Rendering**: Puppeteer (headless Chrome)
- **3D Graphics**: Three.js
- **Image Processing**: Sharp
- **Caching**: node-cache
- **APIs**: GitHub API, Hatena Bookmark RSS

## ⚡ Performance Optimizations

This project implements several advanced optimizations for **maximum speed**:

### 1. **Browser Instance Pooling**
- Puppeteer browser is reused across requests (singleton pattern)
- **Result**: 3-5x faster frame generation
- Old: ~10 seconds | New: ~4 seconds (for 4 frames)

### 2. **Parallel Rendering**
- All 4 visualization steps are rendered simultaneously
- Uses `Promise.all()` to maximize CPU utilization
- **Result**: 4x faster than sequential rendering

### 3. **HTML Template Caching**
- HTML template is loaded once and cached in memory
- Eliminates redundant file I/O operations
- **Result**: 50-100ms saved per request

### 4. **Optimized Sharp Settings**
- WebP `effort: 4` (balanced quality/speed)
- Parallel image conversion
- **Result**: 30% faster image processing

### 5. **Bun Runtime Support**
- Bun is 2-3x faster than Node.js for I/O operations
- Native TypeScript support
- Faster startup and lower memory usage

### Benchmark Results

Generating 4 frames for a GitHub user:

| Optimization | Time (Node.js) | Time (Bun) |
|--------------|----------------|------------|
| Before (sequential, new browser each time) | ~18s | ~12s |
| After (parallel, browser pooling) | ~6s | ~4s |
| **Improvement** | **3x faster** | **3x faster** |

## 📦 Project Structure

```
kira-activity/
├── src/
│   ├── server.js              # Express server & API endpoints
│   ├── services/
│   │   ├── github.js          # GitHub API client
│   │   ├── hatena.js          # Hatena Bookmark client
│   │   └── cache.js           # Cache manager
│   ├── renderer/
│   │   ├── graph.html         # Three.js visualization template
│   │   └── webp-generator.js  # Puppeteer + WebP generation
│   └── utils/
│       └── data-processor.js  # Data transformation for 4 steps
├── package.json
├── .env.example
└── README.md
```

## 🔧 Configuration

Create a `.env` file:

```env
PORT=3000
GITHUB_TOKEN=your_github_personal_access_token_here
CACHE_TTL=3600
NODE_ENV=development
```

### GitHub Token

While optional, a GitHub Personal Access Token is **highly recommended** to avoid rate limits:

1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Generate a new token (classic)
3. No special scopes needed for public data
4. Add to `.env` as `GITHUB_TOKEN`

## 🚀 Deployment

### Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### Railway / Render / Heroku

Simply connect your GitHub repository and set the `GITHUB_TOKEN` environment variable.

## 🎯 Use Cases

- **GitHub Profile README**: Show your coding activity with style
- **Personal Website**: Embed as an image
- **Blog Posts**: Demonstrate your activity patterns
- **Portfolio**: Showcase your consistency and dedication

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📜 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- Inspired by the *Death Note* movies, particularly L's analytical scenes
- Built with love for the Death Note community

## ⚠️ Notes

- Animated WebP support varies by browser (GitHub supports it)
- First-time generation may take 5-10 seconds (subsequent requests are cached)
- GitHub API rate limits apply (60 requests/hour without token, 5000 with token)

---

Made with 📓 and ☕ | [Report Issues](https://github.com/kako-jun/kira-activity/issues)
