// Smooth scroll / navigate from Page 1 to Page 2
function goToPage2() {
  const page2 = document.getElementById('page2');
  if (page2) {
    page2.scrollIntoView({ behavior: 'smooth' });
    history.pushState(null, null, '#page2');
  }
}

// Open Drawing Application Modal
function openApplyModal(drawingType) {
  const modal = document.getElementById('applyModal');
  const title = document.getElementById('modalDrawingTitle');
  const inputType = document.getElementById('formProjectType');
  const statusMsg = document.getElementById('modalStatusMsg');

  if (title) title.textContent = `Apply for ${drawingType}`;
  if (inputType) inputType.value = drawingType;
  if (statusMsg) {
    statusMsg.textContent = '';
    statusMsg.className = 'modal-status';
  }

  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      document.getElementById('clientName')?.focus();
    }, 100);
  }
}

// Close Drawing Application Modal
function closeApplyModal() {
  const modal = document.getElementById('applyModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

// Close modal on clicking outside or Esc key
window.addEventListener('click', e => {
  const modal = document.getElementById('applyModal');
  if (e.target === modal) {
    closeApplyModal();
  }
});

window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeApplyModal();
  }
});

// Handle Drawing Application Submission
async function submitDrawingApplication(e) {
  e.preventDefault();
  const submitBtn = document.getElementById('btnModalSubmit');
  const statusMsg = document.getElementById('modalStatusMsg');

  const name = document.getElementById('clientName').value.trim();
  const email = document.getElementById('clientEmail').value.trim();
  const project_type = document.getElementById('formProjectType').value;
  const dimensions = document.getElementById('clientDimensions').value.trim();
  const notes = document.getElementById('clientNotes').value.trim();

  if (!name || !email) {
    alert('Please enter your name and email address.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting Application...';
  statusMsg.style.color = '#3c7f7a';
  statusMsg.textContent = 'Connecting to Phenoix Design server...';

  const fullMessage = `Site Dimensions/Area: ${dimensions || 'Not specified'}\n\nClient Requirements:\n${notes || 'Standard drawing requirements'}`;

  try {
    const res = await fetch('/api/enquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email,
        project_type,
        budget: dimensions,
        message: fullMessage,
        source: 'Page 2 Drawing Application'
      })
    });

    const data = await res.json();
    if (data.success) {
      statusMsg.style.color = '#15803d';
      statusMsg.innerHTML = `✅ <b>Success!</b> Application #${data.id} submitted. Our engineering team will review and reply to <b>${escapeHtml(email)}</b>.`;
      document.getElementById('drawingApplyForm').reset();
      
      setTimeout(() => {
        closeApplyModal();
      }, 2500);
    } else {
      throw new Error(data.message || 'Submission error');
    }
  } catch (err) {
    // Graceful fallback to email client
    statusMsg.style.color = '#b45309';
    statusMsg.textContent = 'Application prepared! Opening email client to send to phenoixdesign54@gmail.com...';

    const subject = encodeURIComponent(`Drawing Application: ${project_type} - ${name}`);
    const body = encodeURIComponent(
      `Hi Phenoix Design,\n\nI am applying for:\nService: ${project_type}\nName: ${name}\nEmail: ${email}\nDimensions: ${dimensions}\n\nNotes:\n${notes}`
    );
    window.location.href = `mailto:phenoixdesign54@gmail.com?subject=${subject}&body=${body}`;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Application ↗';
  }
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
