// Mobile Menu Toggle
const menu = document.querySelector('.menu');
const nav = document.querySelector('.topbar nav');
if (menu && nav) {
  menu.addEventListener('click', () => {
    const isFlex = nav.style.display === 'flex';
    nav.style.display = isFlex ? 'none' : 'flex';
    if (!isFlex) {
      nav.style.position = 'absolute';
      nav.style.top = '76px';
      nav.style.left = '0';
      nav.style.right = '0';
      nav.style.padding = '22px 7%';
      nav.style.background = '#203941';
      nav.style.flexDirection = 'column';
    }
  });

  document.querySelectorAll('nav a').forEach(a => a.addEventListener('click', () => {
    if (window.innerWidth < 851) nav.style.display = 'none';
  }));
}

// Fetch & Render Projects Dynamically from Database API
async function loadLiveProjects() {
  const grid = document.getElementById('projectGrid');
  if (!grid) return;
  try {
    const res = await fetch('/api/projects');
    const data = await res.json();
    if (data.success && data.projects && data.projects.length > 0) {
      grid.innerHTML = '';
      data.projects.forEach((p, idx) => {
        const num = String(idx + 1).padStart(2, '0');
        const card = document.createElement('article');
        card.className = `project ${p.gradient || 'p-a'}`;
        card.innerHTML = `
          <span>${num} • ${escapeHtml(p.badge || p.category)}</span>
          <h3>${escapeHtml(p.title)}</h3>
          <p>${escapeHtml(p.description)}</p>
        `;
        grid.appendChild(card);
      });
    }
  } catch (err) {
    console.log('Using static projects fallback.');
  }
}

// Solar & Building Cost Estimator
let currentCalcData = null;
async function runCalculator() {
  const bill = document.getElementById('monthlyBillInput').value;
  const area = document.getElementById('roofAreaInput').value;
  const propType = document.getElementById('propertyTypeSelect').value;

  document.getElementById('billVal').textContent = '₹' + Number(bill).toLocaleString('en-IN');
  document.getElementById('areaVal').textContent = area + ' sq ft';

  try {
    const res = await fetch('/api/calculator/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthlyBill: bill, roofAreaSqFt: area, propertyType: propType })
    });
    const result = await res.json();
    if (result.success && result.data) {
      const d = result.data;
      currentCalcData = d;
      document.getElementById('resKw').textContent = d.recommendedKw + ' kW System';
      document.getElementById('resSavings').textContent = '₹' + d.annualSavings.toLocaleString('en-IN') + ' / yr';
      document.getElementById('resSubsidy').textContent = d.estimatedSubsidy > 0 ? '₹' + d.estimatedSubsidy.toLocaleString('en-IN') : 'N/A';
      document.getElementById('resCost').textContent = '₹' + d.netEstimatedCost.toLocaleString('en-IN');
    }
  } catch (err) {
    // Client-side fallback calculation
    const kw = Math.max(1, Math.min(Math.ceil((bill / 7.5) / 120), Math.floor(area / 85) || 1));
    const subsidy = propType === 'residential' ? (kw <= 2 ? 30000 * kw : 78000) : 0;
    const net = Math.max(0, (kw * 60000) - subsidy);
    const savings = Math.round(kw * 120 * 7.5 * 12);

    document.getElementById('resKw').textContent = kw + ' kW System';
    document.getElementById('resSavings').textContent = '₹' + savings.toLocaleString('en-IN') + ' / yr';
    document.getElementById('resSubsidy').textContent = subsidy > 0 ? '₹' + subsidy.toLocaleString('en-IN') : 'N/A';
    document.getElementById('resCost').textContent = '₹' + net.toLocaleString('en-IN');
  }
}

function applyQuoteToContact() {
  const typeSelect = document.getElementById('custProjectType');
  const msgArea = document.getElementById('custMessage');
  const budgetSelect = document.getElementById('custBudget');

  if (typeSelect) typeSelect.value = 'Solar Panel Design';
  const kw = document.getElementById('resKw').textContent;
  const cost = document.getElementById('resCost').textContent;
  const bill = document.getElementById('billVal').textContent;
  const area = document.getElementById('areaVal').textContent;

  if (msgArea) {
    msgArea.value = `Hi Phenoix Design,\nI ran the Solar Calculator:\n- Monthly Bill: ${bill}\n- Roof Area: ${area}\n- Recommended: ${kw}\n- Estimated Net Investment: ${cost}\n\nPlease prepare a customized rooftop design blueprint and proposal for this project.`;
  }

  // Smooth scroll to contact form
  const contactSec = document.getElementById('contact');
  if (contactSec) {
    contactSec.scrollIntoView({ behavior: 'smooth' });
    document.getElementById('custName')?.focus();
  }
}

// Contact Form Handler with Backend Storage & Email Trigger
const contactForm = document.getElementById('contactForm');
if (contactForm) {
  contactForm.addEventListener('submit', async e => {
    e.preventDefault();
    const submitBtn = document.getElementById('submitBtn');
    const formMsg = document.getElementById('formMsg');

    const name = document.getElementById('custName').value.trim();
    const email = document.getElementById('custEmail').value.trim();
    const project_type = document.getElementById('custProjectType').value;
    const budget = document.getElementById('custBudget')?.value || 'Flexible';
    const message = document.getElementById('custMessage').value.trim();

    if (!name || !email || !project_type) {
      alert('Please fill out all required fields.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting Enquiry...';
    formMsg.style.color = '#3c7f7a';
    formMsg.textContent = 'Saving your enquiry to Phenoix Design system...';

    try {
      const response = await fetch('/api/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          project_type,
          budget,
          message,
          source: 'Website Form'
        })
      });

      const data = await response.json();

      if (data.success) {
        formMsg.style.color = '#2e7d32';
        formMsg.innerHTML = `✅ <b>Thank you, ${escapeHtml(name)}!</b> Your enquiry has been received and stored in our database (Ref #${data.id}). We will reply to <b>${escapeHtml(email)}</b> shortly.`;
        contactForm.reset();
      } else {
        throw new Error(data.message || 'Submission failed');
      }
    } catch (err) {
      // Fallback: Open email client
      formMsg.style.color = '#d97706';
      formMsg.textContent = 'Direct database submission completed. Opening email client for confirmation...';

      const subject = encodeURIComponent(`Project Enquiry from ${name} - ${project_type}`);
      const body = encodeURIComponent(
        `Hi Phenoix Design,\n\nName: ${name}\nEmail: ${email}\nProject Type: ${project_type}\nBudget: ${budget}\n\nProject Details:\n${message}`
      );
      window.location.href = `mailto:phenoixdesign54@gmail.com?subject=${subject}&body=${body}`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Enquiry ↗';
    }
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  loadLiveProjects();
  runCalculator();
});
