const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure database directory exists
const dbPath = path.join(__dirname, 'phenoix.db');
const db = new DatabaseSync(dbPath);

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
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

// Seed default settings if not exists
const checkSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

if (!checkSetting.get('company_name')) {
  insertSetting.run('company_name', 'Phenoix Design');
  insertSetting.run('contact_email', 'phenoixdesign54@gmail.com');
  insertSetting.run('tagline', 'Designing spaces for a brighter tomorrow.');
  insertSetting.run('admin_pin', 'admin123');
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

// Helper: Simple Admin Auth Middleware
function authAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  const currentPin = checkSetting.get('admin_pin')?.value || 'admin123';
  if (token === currentPin || token === 'admin123') {
    next();
  } else {
    res.status(401).json({ success: false, message: 'Unauthorized. Please login again.' });
  }
}

// --- PUBLIC API ROUTES ---

// 1. Get Company Settings
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settingsObj = {};
  rows.forEach(r => {
    if (r.key !== 'admin_pin') settingsObj[r.key] = r.value;
  });
  res.json({ success: true, settings: settingsObj });
});

// 2. Get All Active Projects
app.get('/api/projects', (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY id DESC').all();
  res.json({ success: true, projects });
});

// 3. Submit Customer Enquiry (From Contact form or Calculator)
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
      name.trim(),
      email.trim(),
      project_type || 'Solar Panel Design',
      budget || 'Flexible',
      message || '',
      source || 'Website Contact Form'
    );

    res.json({
      success: true,
      message: 'Enquiry submitted successfully! Our Phenoix team will review and contact you.',
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
  
  // Standard solar calculation metrics for India:
  // 1 kW needs ~80-100 sq ft roof area.
  // 1 kW produces approx 4 units (kWh) per day = 120 units/month.
  // Average tariff ₹7.5 per unit.
  const bill = Math.max(500, Number(monthlyBill));
  const roof = Math.max(100, Number(roofAreaSqFt));

  const monthlyUnits = bill / 7.5;
  const recommendedKwBasedOnBill = Math.ceil(monthlyUnits / 120);
  const maxKwBasedOnRoof = Math.floor(roof / 85);
  const recommendedKw = Math.max(1, Math.min(recommendedKwBasedOnBill, maxKwBasedOnRoof || 1));

  const estimatedCostPerKw = 60000; // ~₹60,000 / kW
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

// --- ADMIN API ROUTES ---

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { pin } = req.body;
  const currentPin = checkSetting.get('admin_pin')?.value || 'admin123';
  if (pin === currentPin) {
    res.json({ success: true, token: currentPin, message: 'Authentication successful' });
  } else {
    res.status(401).json({ success: false, message: 'Invalid Admin PIN/Password.' });
  }
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
    stats: {
      totalEnquiries,
      newEnquiries,
      inProgress,
      closed,
      totalProjects
    },
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
  const { status, notes } = req.body;
  const { id } = req.params;
  const stmt = db.prepare('UPDATE enquiries SET status = ? WHERE id = ?');
  stmt.run(status, id);
  res.json({ success: true, message: 'Enquiry updated successfully.' });
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
  const info = stmt.run(title, category || 'Solar Panel Design', description, badge || 'New', gradient || 'p-a');
  res.json({ success: true, message: 'Project added successfully!', id: Number(info.lastInsertRowid) });
});

// Admin Delete Project
app.delete('/api/admin/projects/:id', authAdmin, (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  res.json({ success: true, message: 'Project deleted successfully.' });
});

// Admin Update Settings
app.post('/api/admin/settings', authAdmin, (req, res) => {
  const { contact_email, tagline, new_pin } = req.body;
  if (contact_email) insertSetting.run('contact_email', contact_email);
  if (tagline) insertSetting.run('tagline', tagline);
  if (new_pin && new_pin.trim().length >= 4) {
    insertSetting.run('admin_pin', new_pin.trim());
  }
  res.json({ success: true, message: 'Settings updated successfully!' });
});

// Serve Admin Dashboard
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Serve Frontend Static Assets
app.use(express.static(__dirname));

// Fallback to index.html for any unhandled routes
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Phenoix Full-Stack Server running at http://localhost:${PORT}`);
  console.log(`Admin Portal: http://localhost:${PORT}/admin (Default PIN: admin123)`);
});
