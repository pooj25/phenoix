const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 8000;

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure database exists
const dbPath = path.join(__dirname, 'phenoix.db');
const db = new DatabaseSync(dbPath);

// Initialize Database Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS enquiries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    project_type TEXT NOT NULL,
    budget TEXT DEFAULT '',
    message TEXT DEFAULT '',
    status TEXT DEFAULT 'New',
    source TEXT DEFAULT 'Contact Form',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    badge TEXT DEFAULT 'Featured',
    gradient TEXT DEFAULT 'p-a',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Helpers: Crypto Hash and Token Generation
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function verifyPassword(inputPassword, storedHash, storedSalt) {
  if (!inputPassword || !storedHash || !storedSalt) return false;
  const inputHash = hashPassword(inputPassword, storedSalt);
  try {
    return crypto.timingSafeEqual(Buffer.from(inputHash, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch (err) {
    return false;
  }
}

// Seed or Migrate Admin Credentials Safely
const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

if (!getSetting.get('company_name')) {
  setSetting.run('company_name', 'Phenoix Design');
  setSetting.run('contact_email', 'phenoixdesign54@gmail.com');
  setSetting.run('tagline', 'Designing spaces for a brighter tomorrow.');
}

// Ensure Secure Password Hash Exists
const existingHash = getSetting.get('admin_pwd_hash')?.value;
const existingSalt = getSetting.get('admin_pwd_salt')?.value;

if (!existingHash || !existingSalt) {
  const legacyPin = getSetting.get('admin_pin')?.value || 'admin123';
  const newSalt = crypto.randomBytes(16).toString('hex');
  const newHash = hashPassword(legacyPin, newSalt);
  setSetting.run('admin_pwd_salt', newSalt);
  setSetting.run('admin_pwd_hash', newHash);
  // Remove legacy plain text pin for security
  db.prepare("DELETE FROM settings WHERE key = 'admin_pin'").run();
}

// Seed default projects if empty
const countProjects = db.prepare('SELECT count(*) as count FROM projects').get();
if (countProjects.count === 0) {
  const insertProject = db.prepare('INSERT INTO projects (title, category, description, badge, gradient) VALUES (?, ?, ?, ?, ?)');
  insertProject.run('Sunrise Residence', 'Solar Panel Design', 'Home + 5kW rooftop solar concept with net-metering integration', 'Residential', 'p-a');
  insertProject.run('Green Office Complex', 'Building Design', 'Commercial sustainable building architecture with natural daylighting', 'Commercial', 'p-b');
  insertProject.run('Terrace Solar Grid', 'Solar Panel Design', 'Efficient modular terrace solar layout with high-durability mounting', 'Rooftop', 'p-c');
  insertProject.run('Eco Villa 3D Elevation', '3D & Planning', 'Modern 3D architectural renders with integrated aesthetic solar panels', '3D Design', 'p-a');
}

// Brute Force Protection: In-memory Rate Limiting for Admin Login
const failedAttempts = new Map(); // ip -> { count: number, resetAt: number }

function checkRateLimit(ip) {
  const now = Date.now();
  const record = failedAttempts.get(ip);
  if (record) {
    if (now < record.resetAt) {
      if (record.count >= 5) {
        const remainingMinutes = Math.ceil((record.resetAt - now) / 60000);
        return { blocked: true, minutes: remainingMinutes };
      }
    } else {
      failedAttempts.delete(ip);
    }
  }
  return { blocked: false };
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const record = failedAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  record.count += 1;
  failedAttempts.set(ip, record);
}

function clearRateLimit(ip) {
  failedAttempts.delete(ip);
}

// Secure Admin Authentication Middleware
function authAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || typeof token !== 'string' || token.length !== 64) {
    return res.status(401).json({ success: false, message: 'Authentication required. Please login.' });
  }

  // Purge expired sessions
  const now = Date.now();
  db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(now);

  const session = db.prepare('SELECT * FROM admin_sessions WHERE token = ? AND expires_at > ?').get(token, now);
  if (!session) {
    return res.status(401).json({ success: false, message: 'Session expired or invalid. Please login again.' });
  }

  next();
}

// --- PUBLIC API ROUTES ---

// 1. Get Company Settings (Excludes credentials)
app.get('/api/settings', (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key NOT LIKE 'admin%'").all();
  const settingsObj = {};
  rows.forEach(r => { settingsObj[r.key] = r.value; });
  res.json({ success: true, settings: settingsObj });
});

// 2. Get All Active Projects
app.get('/api/projects', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY id DESC').all();
  res.json({ success: true, projects });
});

// 3. Submit Customer Enquiry (From Contact form or Page 2 Modal)
app.post('/api/enquiries', (req, res) => {
  try {
    const { name, email, project_type, budget, message, source } = req.body;
    if (!name || !email) {
      return res.status(400).json({ success: false, message: 'Name and Email are required.' });
    }

    const stmt = db.prepare(`
      INSERT INTO enquiries (name, email, project_type, budget, message, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      String(name).trim().slice(0, 150),
      String(email).trim().slice(0, 150),
      String(project_type || 'Solar Panel Design').slice(0, 100),
      String(budget || 'Flexible').slice(0, 100),
      String(message || '').slice(0, 2000),
      String(source || 'Website Form').slice(0, 100)
    );

    res.json({
      success: true,
      message: 'Application received and securely saved. We will contact you soon.',
      id: Number(info.lastInsertRowid)
    });
  } catch (err) {
    console.error('Error saving enquiry:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// 4. Solar Cost & Savings Estimator API
app.post('/api/calculator/estimate', (req, res) => {
  const { monthlyBill = 2500, roofAreaSqFt = 400, propertyType = 'residential' } = req.body;
  const bill = Math.max(500, Number(monthlyBill));
  const roof = Math.max(100, Number(roofAreaSqFt));

  const monthlyUnits = bill / 7.5;
  const recommendedKwBasedOnBill = Math.ceil(monthlyUnits / 120);
  const maxKwBasedOnRoof = Math.floor(roof / 85);
  const recommendedKw = Math.max(1, Math.min(recommendedKwBasedOnBill, maxKwBasedOnRoof || 1));

  const estimatedCostPerKw = 60000;
  const totalEstimatedCost = recommendedKw * estimatedCostPerKw;
  const estimatedSubsidy = recommendedKw <= 2 ? 30000 * recommendedKw : (recommendedKw === 3 ? 78000 : 78000);
  const netEstimatedCost = Math.max(0, totalEstimatedCost - (propertyType === 'residential' ? estimatedSubsidy : 0));
  const monthlySavings = recommendedKw * 120 * 7.5;
  const annualSavings = monthlySavings * 12;
  const paybackYears = (netEstimatedCost / (annualSavings || 1)).toFixed(1);

  res.json({
    success: true,
    data: {
      recommendedKw,
      totalEstimatedCost,
      estimatedSubsidy: propertyType === 'residential' ? estimatedSubsidy : 0,
      netEstimatedCost,
      monthlySavings: Math.round(monthlySavings),
      annualSavings: Math.round(annualSavings),
      paybackYears
    }
  });
});

// --- SECURE ADMIN AUTH ROUTES ---

// Admin Login with Brute-Force Rate Limiting & Crypto Tokens
app.post('/api/admin/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown-ip';
  
  // Rate Limit Check
  const rateLimit = checkRateLimit(ip);
  if (rateLimit.blocked) {
    return res.status(429).json({
      success: false,
      message: `Too many failed login attempts. Locked out for security. Try again in ${rateLimit.minutes} minutes.`
    });
  }

  const { pin } = req.body;
  if (!pin || typeof pin !== 'string') {
    return res.status(400).json({ success: false, message: 'Password/PIN is required.' });
  }

  const storedHash = getSetting.get('admin_pwd_hash')?.value;
  const storedSalt = getSetting.get('admin_pwd_salt')?.value;

  const isValid = verifyPassword(pin.trim(), storedHash, storedSalt);

  if (!isValid) {
    recordFailedAttempt(ip);
    return res.status(401).json({ success: false, message: 'Invalid Admin Password / PIN.' });
  }

  // Clear rate limits upon successful login
  clearRateLimit(ip);

  // Generate cryptographically random 64-char hex session token
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const sessionDurationMs = 24 * 60 * 60 * 1000; // 24 Hours
  const expiresAt = Date.now() + sessionDurationMs;

  db.prepare('INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)').run(sessionToken, expiresAt);

  res.json({
    success: true,
    token: sessionToken,
    expiresAt,
    message: 'Authentication successful. Secure session initialized.'
  });
});

// Admin Logout: Revokes Session Token
app.post('/api/admin/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) {
    db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
  }
  res.json({ success: true, message: 'Logged out successfully.' });
});

// Admin Dashboard Summary & Stats
app.get('/api/admin/stats', authAdmin, (req, res) => {
  const totalEnquiries = db.prepare('SELECT count(*) as count FROM enquiries').get().count;
  const newEnquiries = db.prepare("SELECT count(*) as count FROM enquiries WHERE status = 'New'").get().count;
  const inProgress = db.prepare("SELECT count(*) as count FROM enquiries WHERE status = 'In Progress'").get().count;
  const closed = db.prepare("SELECT count(*) as count FROM enquiries WHERE status = 'Closed'").get().count;
  const totalProjects = db.prepare('SELECT count(*) as count FROM projects').get().count;
  const recentEnquiries = db.prepare('SELECT * FROM enquiries ORDER BY id DESC LIMIT 5').all();

  res.json({
    success: true,
    stats: { totalEnquiries, newEnquiries, inProgress, closed, totalProjects },
    recentEnquiries
  });
});

// Admin Get All Enquiries
app.get('/api/admin/enquiries', authAdmin, (req, res) => {
  const { status } = req.query;
  let query = 'SELECT * FROM enquiries ORDER BY id DESC';
  let enquiries;
  if (status && status !== 'All') {
    enquiries = db.prepare('SELECT * FROM enquiries WHERE status = ? ORDER BY id DESC').all(status);
  } else {
    enquiries = db.prepare(query).all();
  }
  res.json({ success: true, enquiries });
});

// Admin Update Enquiry Status
app.patch('/api/admin/enquiries/:id', authAdmin, (req, res) => {
  const { status } = req.body;
  const { id } = req.params;
  const validStatuses = ['New', 'Contacted', 'In Progress', 'Closed'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status' });
  }
  db.prepare('UPDATE enquiries SET status = ? WHERE id = ?').run(status, id);
  res.json({ success: true, message: 'Status updated successfully.' });
});

// Admin Delete Enquiry
app.delete('/api/admin/enquiries/:id', authAdmin, (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM enquiries WHERE id = ?').run(id);
  res.json({ success: true, message: 'Enquiry deleted successfully.' });
});

// Admin Add Project
app.post('/api/admin/projects', authAdmin, (req, res) => {
  const { title, category, description, badge, gradient } = req.body;
  if (!title || !description) {
    return res.status(400).json({ success: false, message: 'Title and description required' });
  }
  const stmt = db.prepare('INSERT INTO projects (title, category, description, badge, gradient) VALUES (?, ?, ?, ?, ?)');
  const info = stmt.run(
    String(title).slice(0, 150),
    String(category || 'Solar Panel Design').slice(0, 100),
    String(description).slice(0, 500),
    String(badge || 'New').slice(0, 50),
    String(gradient || 'p-a').slice(0, 20)
  );
  res.json({ success: true, message: 'Project added successfully!', id: Number(info.lastInsertRowid) });
});

// Admin Delete Project
app.delete('/api/admin/projects/:id', authAdmin, (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  res.json({ success: true, message: 'Project deleted successfully.' });
});

// Secure Settings Update (Requires Current Password to change Password)
app.post('/api/admin/settings', authAdmin, (req, res) => {
  const { contact_email, tagline, current_pin, new_pin } = req.body;

  if (contact_email) setSetting.run('contact_email', String(contact_email).trim());
  if (tagline) setSetting.run('tagline', String(tagline).trim());

  // Password Change
  if (new_pin && new_pin.trim().length > 0) {
    if (new_pin.trim().length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters long for security.' });
    }

    const storedHash = getSetting.get('admin_pwd_hash')?.value;
    const storedSalt = getSetting.get('admin_pwd_salt')?.value;

    if (!verifyPassword(current_pin, storedHash, storedSalt)) {
      return res.status(403).json({ success: false, message: 'Current password verification failed. Password was NOT changed.' });
    }

    const newSalt = crypto.randomBytes(16).toString('hex');
    const newHash = hashPassword(new_pin.trim(), newSalt);
    setSetting.run('admin_pwd_salt', newSalt);
    setSetting.run('admin_pwd_hash', newHash);

    // Invalidate all existing sessions for security
    db.prepare('DELETE FROM admin_sessions').run();

    return res.json({
      success: true,
      message: 'Password changed successfully! All previous sessions terminated for security. Please login with your new password.',
      requiresRelogin: true
    });
  }

  res.json({ success: true, message: 'Settings updated successfully!' });
});

// Serve Admin Dashboard
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Serve Frontend Static Assets
app.use(express.static(__dirname));

// Fallback to index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Phenoix Full-Stack Server running at http://localhost:${PORT}`);
  console.log(`Admin Portal: http://localhost:${PORT}/admin`);
});
