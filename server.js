const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { nanoid } = require('nanoid');
const cors = require('cors');
const path = require('path');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Admin password (in production, use environment variable)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Middleware
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

// Database setup (use /tmp for Vercel)
const dbPath = process.env.NODE_ENV === 'production' ? '/tmp/urls.db' : './urls.db';
const db = new sqlite3.Database(dbPath);

// Create tables if not exist
db.serialize(() => {
  // Main URLs table
  db.run(`CREATE TABLE IF NOT EXISTS urls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    short_code TEXT UNIQUE NOT NULL,
    original_url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    clicks INTEGER DEFAULT 0
  )`);

  // Daily analytics table
  db.run(`CREATE TABLE IF NOT EXISTS daily_analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE UNIQUE NOT NULL,
    total_urls INTEGER DEFAULT 0,
    total_clicks INTEGER DEFAULT 0,
    new_urls INTEGER DEFAULT 0,
    unique_visitors INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // URL analytics table
  db.run(`CREATE TABLE IF NOT EXISTS url_analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    short_code TEXT NOT NULL,
    click_date DATE NOT NULL,
    clicks INTEGER DEFAULT 0,
    unique_visitors INTEGER DEFAULT 0,
    referrer TEXT,
    user_agent TEXT,
    country TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (short_code) REFERENCES urls (short_code)
  )`);

  // User sessions table
  db.run(`CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    first_visit DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_visit DATETIME DEFAULT CURRENT_TIMESTAMP,
    total_visits INTEGER DEFAULT 1
  )`);
});

// Authentication functions
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function verifyPassword(password) {
  return password === ADMIN_PASSWORD;
}

function createSession(res) {
  const token = generateSessionToken();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  
  res.cookie('admin_session', token, {
    expires,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  });
  
  return token;
}

function verifySession(req) {
  const token = req.cookies?.admin_session;
  return token && token.length > 0;
}

function requireAuth(req, res, next) {
  if (!verifySession(req)) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  next();
}

// Analytics functions
function getOrCreateSession(req) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const userAgent = req.get('User-Agent') || '';
  const sessionId = crypto.createHash('md5').update(ip + userAgent).digest('hex');
  
  db.run(`
    INSERT OR IGNORE INTO user_sessions (session_id, ip_address, user_agent)
    VALUES (?, ?, ?)
  `, [sessionId, ip, userAgent]);
  
  return sessionId;
}

function trackUrlClick(shortCode, req) {
  const today = new Date().toISOString().split('T')[0];
  const sessionId = getOrCreateSession(req);
  const userAgent = req.get('User-Agent') || '';
  const referrer = req.get('Referrer') || 'direct';
  
  // Update daily analytics
  db.run(`
    INSERT OR REPLACE INTO daily_analytics (date, total_clicks, unique_visitors)
    VALUES (
      ?,
      COALESCE((SELECT total_clicks FROM daily_analytics WHERE date = ?), 0) + 1,
      (SELECT COUNT(DISTINCT session_id) FROM user_sessions WHERE DATE(last_visit) = ?)
    )
  `, [today, today, today]);

  // Update URL analytics
  db.run(`
    INSERT INTO url_analytics (short_code, click_date, clicks, unique_visitors, referrer, user_agent)
    VALUES (?, ?, 1, 1, ?, ?)
    ON CONFLICT(short_code, click_date) DO UPDATE SET
      clicks = clicks + 1
  `, [shortCode, today, referrer, userAgent]);

  // Update session
  db.run(`
    UPDATE user_sessions SET last_visit = CURRENT_TIMESTAMP, total_visits = total_visits + 1
    WHERE session_id = ?
  `, [sessionId]);
}

function trackUrlCreation() {
  const today = new Date().toISOString().split('T')[0];
  
  db.run(`
    INSERT OR REPLACE INTO daily_analytics (date, total_urls, new_urls)
    VALUES (
      ?,
      (SELECT COUNT(*) FROM urls),
      COALESCE((SELECT new_urls FROM daily_analytics WHERE date = ?), 0) + 1
    )
  `, [today, today]);
}

function getAnalytics(callback) {
  const analytics = {
    overview: {},
    dailyStats: [],
    topUrls: [],
    recentActivity: [],
    visitorStats: {}
  };

  // Get overview stats
  db.all(`
    SELECT 
      COUNT(*) as total_urls,
      SUM(clicks) as total_clicks,
      AVG(clicks) as avg_clicks,
      COUNT(DISTINCT DATE(created_at)) as days_active
    FROM urls
  `, [], (err, overview) => {
    if (err) return callback(err);
    analytics.overview = overview[0] || {};

    // Get daily stats for last 30 days
    db.all(`
      SELECT date, total_urls, total_clicks, new_urls, unique_visitors
      FROM daily_analytics
      WHERE date >= date('now', '-30 days')
      ORDER BY date DESC
    `, [], (err, dailyStats) => {
      if (err) return callback(err);
      analytics.dailyStats = dailyStats;

      // Get top URLs by clicks
      db.all(`
        SELECT u.short_code, u.original_url, u.clicks, u.created_at,
               COUNT(ua.click_date) as days_active
        FROM urls u
        LEFT JOIN url_analytics ua ON u.short_code = ua.short_code
        GROUP BY u.id
        ORDER BY u.clicks DESC
        LIMIT 10
      `, [], (err, topUrls) => {
        if (err) return callback(err);
        analytics.topUrls = topUrls;

        // Get recent activity
        db.all(`
          SELECT short_code, original_url, created_at, clicks
          FROM urls
          ORDER BY created_at DESC
          LIMIT 10
        `, [], (err, recentActivity) => {
          if (err) return callback(err);
          analytics.recentActivity = recentActivity;

          // Get visitor stats
          db.all(`
            SELECT 
              COUNT(DISTINCT session_id) as total_visitors,
              COUNT(*) as total_sessions,
              AVG(total_visits) as avg_visits_per_session,
              DATE(first_visit) as visit_date
            FROM user_sessions
            GROUP BY DATE(first_visit)
            ORDER BY visit_date DESC
            LIMIT 30
          `, [], (err, visitorStats) => {
            if (err) return callback(err);
            analytics.visitorStats = visitorStats;

            callback(null, analytics);
          });
        });
      });
    });
  });
}

// Generate short code
function generateShortCode() {
  return nanoid(6);
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin login page (no auth required)
app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

// Also handle direct login route
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
});

// Serve admin.html for admin route (protected)
app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve admin.html for admin.html route (protected)
app.get('/admin.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin login API
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  
  if (!verifyPassword(password)) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  
  createSession(res);
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
          // Retry with different code
          return res.status(500).json({ error: 'Please try again' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      
      // Track URL creation in analytics
      trackUrlCreation();
      
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
      trackUrlClick(shortCode, req);

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
app.get('/api/admin/all-urls', requireAuth, (req, res) => {
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
app.get('/api/admin/analytics', requireAuth, (req, res) => {
  getAnalytics((err, data) => {
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

app.listen(PORT, () => {
  console.log(`URL Shortener running on port ${PORT}`);
});

// Export for Vercel
module.exports = app;
