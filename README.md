# Phenoix Design - Full Stack Website

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/pooj25/phenoix)

A modern, responsive full-stack web application for **Phenoix Design** (Solar Panel & Building Architecture Design).

## Features
- **Client Website:**
  - Modern, responsive landing page with custom branding
  - Interactive Solar & Building Cost / Savings Calculator
  - Dynamic Projects showcase
  - Interactive Contact & Enquiry Form
  - Direct email integration (`phenoixdesign54@gmail.com`)
- **Admin Dashboard (`/admin`):**
  - Customer Leads & Inquiries Management (Status tracking: New, Contacted, In Progress, Closed)
  - 1-click Email Reply & Export to CSV
  - Portfolio CMS (Add/Edit/Delete projects dynamically)
  - Company settings configuration
  - Secure PIN-based login (Default: `admin123`)
- **Backend & Database:**
  - Node.js & Express REST API
  - Built-in SQLite database persistence (`phenoix.db`)

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```

### 3. Open in Browser
- Main Website: [http://localhost:8000](http://localhost:8000)
- Admin Portal: [http://localhost:8000/admin](http://localhost:8000/admin) (Default PIN: `admin123`)
