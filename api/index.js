const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { nanoid } = require('nanoid');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database setup (use /tmp for Vercel)
const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/urls.db' : './urls.db';
const db = new sqlite3.Database(dbPath);

// Create table if not exists
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS urls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    short_code TEXT UNIQUE NOT NULL,
    original_url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    clicks INTEGER DEFAULT 0
  )`);
});

// Generate short code
function generateShortCode() {
  return nanoid(6);
}

// Routes
app.post('/api/shorten', (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const shortCode = generateShortCode();
  const shortUrl = `${req.protocol}://${req.get('host')}/${shortCode}`;

  db.run(
    'INSERT INTO urls (short_code, original_url) VALUES (?, ?)',
    [shortCode, url],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(500).json({ error: 'Please try again' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      
      res.json({
        shortUrl,
        shortCode,
        originalUrl: url
      });
    }
  );
});

app.get('/:shortCode', (req, res) => {
  const { shortCode } = req.params;

  db.get(
    'SELECT original_url FROM urls WHERE short_code = ?',
    [shortCode],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!row) {
        return res.status(404).json({ error: 'URL not found' });
      }

      // Increment click count
      db.run(
        'UPDATE urls SET clicks = clicks + 1 WHERE short_code = ?',
        [shortCode]
      );

      res.redirect(row.original_url);
    }
  );
});

app.get('/api/stats/:shortCode', (req, res) => {
  const { shortCode } = req.params;

  db.get(
    'SELECT * FROM urls WHERE short_code = ?',
    [shortCode],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!row) {
        return res.status(404).json({ error: 'URL not found' });
      }

      res.json(row);
    }
  );
});

// Admin endpoint to get all URLs
app.get('/api/admin/all-urls', (req, res) => {
  db.all(
    'SELECT * FROM urls ORDER BY created_at DESC',
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      res.json(rows);
    }
  );
});

// Export for Vercel
module.exports = app;
