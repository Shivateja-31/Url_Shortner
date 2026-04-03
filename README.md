# URL Shortener

A fast and simple URL shortening service built with Node.js, Express, and SQLite.

## Features

- ⚡ Fast URL shortening
- 📊 Click tracking
- 🎨 Modern UI with Tailwind CSS
- 📱 Responsive design
- 🔒 SQLite database for reliability

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start

# Or for development
npm run dev
```

Visit `http://localhost:3000` to use the URL shortener.

## API Endpoints

- `POST /api/shorten` - Create a shortened URL
- `GET /:shortCode` - Redirect to original URL
- `GET /api/stats/:shortCode` - Get URL statistics

## Deployment

This app is ready for deployment on platforms like:
- Heroku
- Vercel
- Railway
- Any Node.js hosting service
