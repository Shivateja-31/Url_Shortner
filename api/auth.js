const crypto = require('crypto');

class AdminAuth {
  constructor() {
    // Simple admin credentials (in production, use proper auth system)
    this.adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    this.sessionTimeout = 24 * 60 * 60 * 1000; // 24 hours
  }

  // Generate secure session token
  generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  // Verify admin password
  verifyPassword(password) {
    return password === this.adminPassword;
  }

  // Create admin session
  createSession(res) {
    const token = this.generateSessionToken();
    const expires = new Date(Date.now() + this.sessionTimeout);
    
    res.cookie('admin_session', token, {
      expires,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });
    
    return token;
  }

  // Verify admin session
  verifySession(req) {
    const token = req.cookies?.admin_session;
    if (!token) return false;
    
    // In production, store sessions in database and verify
    // For now, accept any non-empty token (simplified for demo)
    return token.length > 0;
  }

  // Middleware to protect admin routes
  requireAuth(req, res, next) {
    if (!this.verifySession(req)) {
      return res.status(401).json({ error: 'Admin authentication required' });
    }
    next();
  }
}

module.exports = AdminAuth;
