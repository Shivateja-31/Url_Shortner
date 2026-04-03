const sqlite3 = require('sqlite3').verbose();

class AnalyticsManager {
  constructor(dbPath) {
    this.db = new sqlite3.Database(dbPath);
    this.initTables();
  }

  initTables() {
    // Enhanced analytics tables
    this.db.serialize(() => {
      // Daily analytics table
      this.db.run(`CREATE TABLE IF NOT EXISTS daily_analytics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATE UNIQUE NOT NULL,
        total_urls INTEGER DEFAULT 0,
        total_clicks INTEGER DEFAULT 0,
        new_urls INTEGER DEFAULT 0,
        unique_visitors INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // URL analytics table (detailed tracking)
      this.db.run(`CREATE TABLE IF NOT EXISTS url_analytics (
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
      this.db.run(`CREATE TABLE IF NOT EXISTS user_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT UNIQUE NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        first_visit DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_visit DATETIME DEFAULT CURRENT_TIMESTAMP,
        total_visits INTEGER DEFAULT 1
      )`);
    });
  }

  // Track URL click with detailed analytics
  trackUrlClick(shortCode, req) {
    const today = new Date().toISOString().split('T')[0];
    const sessionId = this.getOrCreateSession(req);
    const userAgent = req.get('User-Agent') || '';
    const referrer = req.get('Referrer') || 'direct';
    
    // Update daily analytics
    this.db.run(`
      INSERT OR REPLACE INTO daily_analytics (date, total_clicks, unique_visitors)
      VALUES (
        ?,
        COALESCE((SELECT total_clicks FROM daily_analytics WHERE date = ?), 0) + 1,
        (SELECT COUNT(DISTINCT session_id) FROM user_sessions WHERE DATE(last_visit) = ?)
      )
    `, [today, today, today]);

    // Update URL analytics
    this.db.run(`
      INSERT INTO url_analytics (short_code, click_date, clicks, unique_visitors, referrer, user_agent)
      VALUES (?, ?, 1, 1, ?, ?)
      ON CONFLICT(short_code, click_date) DO UPDATE SET
        clicks = clicks + 1,
        unique_visitors = (
          SELECT COUNT(DISTINCT session_id) FROM url_analytics 
          WHERE short_code = ? AND click_date = ?
        )
    `, [shortCode, today, referrer, userAgent, shortCode, today]);

    // Update session
    this.db.run(`
      UPDATE user_sessions SET last_visit = CURRENT_TIMESTAMP, total_visits = total_visits + 1
      WHERE session_id = ?
    `, [sessionId]);
  }

  // Track new URL creation
  trackUrlCreation() {
    const today = new Date().toISOString().split('T')[0];
    
    this.db.run(`
      INSERT OR REPLACE INTO daily_analytics (date, total_urls, new_urls)
      VALUES (
        ?,
        (SELECT COUNT(*) FROM urls),
        COALESCE((SELECT new_urls FROM daily_analytics WHERE date = ?), 0) + 1
      )
    `, [today, today]);
  }

  // Get or create session
  getOrCreateSession(req) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || '';
    const sessionId = require('crypto').createHash('md5').update(ip + userAgent).digest('hex');
    
    this.db.run(`
      INSERT OR IGNORE INTO user_sessions (session_id, ip_address, user_agent)
      VALUES (?, ?, ?)
    `, [sessionId, ip, userAgent]);
    
    return sessionId;
  }

  // Get comprehensive analytics
  getAnalytics(callback) {
    const analytics = {
      overview: {},
      dailyStats: [],
      topUrls: [],
      recentActivity: [],
      visitorStats: {}
    };

    // Get overview stats
    this.db.all(`
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
      this.db.all(`
        SELECT date, total_urls, total_clicks, new_urls, unique_visitors
        FROM daily_analytics
        WHERE date >= date('now', '-30 days')
        ORDER BY date DESC
      `, [], (err, dailyStats) => {
        if (err) return callback(err);
        analytics.dailyStats = dailyStats;

        // Get top URLs by clicks
        this.db.all(`
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
          this.db.all(`
            SELECT short_code, original_url, created_at, clicks
            FROM urls
            ORDER BY created_at DESC
            LIMIT 10
          `, [], (err, recentActivity) => {
            if (err) return callback(err);
            analytics.recentActivity = recentActivity;

            // Get visitor stats
            this.db.all(`
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

  // Get detailed URL analytics
  getUrlAnalytics(shortCode, callback) {
    this.db.all(`
      SELECT 
        ua.click_date,
        ua.clicks,
        ua.unique_visitors,
        ua.referrer,
        ua.user_agent
      FROM url_analytics ua
      WHERE ua.short_code = ?
      ORDER BY ua.click_date DESC
      LIMIT 30
    `, [shortCode], callback);
  }
}

module.exports = AnalyticsManager;
