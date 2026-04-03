const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { nanoid } = require('nanoid');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const AnalyticsManager = require('./analytics');
const AdminAuth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize analytics and auth
const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/urls.db' : './urls.db';
const db = new sqlite3.Database(dbPath);
const analytics = new AnalyticsManager(dbPath);
const auth = new AdminAuth();

// Middleware
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// Create main URLs table if not exists
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
// Serve index.html for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Admin login page
app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin-login.html'));
});

// Serve admin.html for admin route (protected)
app.get('/admin', auth.requireAuth.bind(auth), (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// Serve admin.html for admin.html route (protected)
app.get('/admin.html', auth.requireAuth.bind(auth), (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// Admin login API
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  
  if (!auth.verifyPassword(password)) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  
  auth.createSession(res);
  res.json({ success: true, message: 'Logged in successfully' });
});

// Admin logout API
app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('admin_session');
  res.json({ success: true, message: 'Logged out successfully' });
});

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
      
      // Track URL creation in analytics
      analytics.trackUrlCreation();
      
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

      // Track click analytics
      analytics.trackUrlClick(shortCode, req);

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

// Admin endpoint to get all URLs (protected)
app.get('/api/admin/all-urls', auth.requireAuth.bind(auth), (req, res) => {
  console.log('Fetching all URLs...');
  db.all(
    'SELECT * FROM urls ORDER BY created_at DESC',
    [],
    (err, rows) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      console.log('Found URLs:', rows.length);
      res.json(rows);
    }
  );
});

// Advanced analytics endpoint (protected)
app.get('/api/admin/analytics', auth.requireAuth.bind(auth), (req, res) => {
  analytics.getAnalytics((err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Analytics error' });
    }
    res.json(data);
  });
});

// URL-specific analytics (protected)
app.get('/api/admin/url-analytics/:shortCode', auth.requireAuth.bind(auth), (req, res) => {
  const { shortCode } = req.params;
  
  analytics.getUrlAnalytics(shortCode, (err, data) => {
    if (err) {
      return res.status(500).json({ error: 'Analytics error' });
    }
    res.json(data);
  });
});

// Debug endpoint
app.get('/api/debug', (req, res) => {
  res.json({
    message: 'API is working',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Export for Vercel
module.exports = app;
