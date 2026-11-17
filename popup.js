// ============================================================
// popup.js — Popup Controller for Placement Email Bot
// ============================================================
// Handles: CSV parsing, template editing, preview, chrome.storage,
// communication with content.js, progress tracking, and UI state.
// All vanilla JS — no external dependencies.
// ============================================================

(function () {
  'use strict';

  // ── DOM References ──────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const csvFileInput     = $('#csvFileInput');
  const fileUploadLabel  = $('#fileUploadLabel');
  const contactCount     = $('#contactCount');
  const uploadInfo       = $('#uploadInfo');
  const fileNameEl       = $('#fileName');
  const clearContactsBtn = $('#clearContacts');
  const xlsxWarning      = $('#xlsxWarning');

  const subjectInput  = $('#subjectInput');
  const bodyInput     = $('#bodyInput');
  const ccInput       = $('#ccInput');
  const bccInput      = $('#bccInput');

  const previewToggle  = $('#previewToggle');
  const previewBox     = $('#previewBox');
  const previewSubject = $('#previewSubject');
  const previewBody    = $('#previewBody');

  const delaySlider = $('#delaySlider');
  const delayValue  = $('#delayValue');
  const sendLimitEl = $('#sendLimit');

  const startBtn     = $('#startBtn');
  const stopBtn      = $('#stopBtn');
  const progressWrap = $('#progressWrap');
  const progressFill = $('#progressFill');
  const progressText = $('#progressText');
  const logArea      = $('#logArea');
  const logEntries   = $('#logEntries');
  const clearLogBtn  = $('#clearLog');

  const statusDot  = $('#statusDot');
  const statusText = $('#statusText');

  // ── App State ───────────────────────────────────────────────
  let contacts = [];
  let isPreviewOpen = false;

  // ══════════════════════════════════════════════════════════════
  // CSV PARSER (vanilla JS — handles quoted fields, newlines)
  // ══════════════════════════════════════════════════════════════

  /**
   * Parse a CSV string into an array of objects.
   * First row is treated as headers.
   * Handles: quoted fields, commas inside quotes, escaped quotes ("").
   */
  function parseCSV(text) {
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (ch === '"' && next === '"') {
          // Escaped quote
          currentField += '"';
          i++; // skip next quote
        } else if (ch === '"') {
          // End of quoted field
          inQuotes = false;
        } else {
          currentField += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          currentRow.push(currentField.trim());
          currentField = '';
        } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
          currentRow.push(currentField.trim());
          if (currentRow.some(f => f !== '')) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentField = '';
          if (ch === '\r') i++; // skip \n in \r\n
        } else {
          currentField += ch;
        }
      }
    }

    // Push last field/row
    currentRow.push(currentField.trim());
    if (currentRow.some(f => f !== '')) {
      rows.push(currentRow);
    }

    if (rows.length < 2) return []; // Need at least header + 1 row

    // First row = headers, normalise to lowercase
    const headers = rows[0].map(h => h.toLowerCase().replace(/\s+/g, '_'));

    // Convert remaining rows to objects
    const data = [];
    for (let r = 1; r < rows.length; r++) {
      const obj = {};
      for (let c = 0; c < headers.length; c++) {
        obj[headers[c]] = rows[r][c] || '';
      }
      // Only include rows that have at least an email
      if (obj.email || obj.Email) {
        data.push(obj);
      }
    }

    return data;
  }

  // ══════════════════════════════════════════════════════════════
  // FILE UPLOAD HANDLING
  // ══════════════════════════════════════════════════════════════

  csvFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'xlsx' || ext === 'xls') {
      // Show XLSX warning
      xlsxWarning.style.display = 'flex';
      fileUploadLabel.style.display = 'block';
      uploadInfo.style.display = 'none';
      contactCount.style.display = 'none';
      return;
    }

    xlsxWarning.style.display = 'none';

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      contacts = parseCSV(text);

      if (contacts.length === 0) {
        showNotification('No valid contacts found. Ensure the CSV has an "email" column.', 'error');
        return;
      }

      // Update UI
      fileUploadLabel.style.display = 'none';
      uploadInfo.style.display = 'flex';
      fileNameEl.textContent = `${file.name} — ${contacts.length} contact${contacts.length !== 1 ? 's' : ''} loaded`;
      contactCount.textContent = contacts.length;
      contactCount.style.display = 'inline-block';

      // Save to storage
      saveState();

      // Update preview
      updatePreview();
    };
    reader.readAsText(file);
  });

  clearContactsBtn.addEventListener('click', () => {
    contacts = [];
    csvFileInput.value = '';
    fileUploadLabel.style.display = 'block';
    uploadInfo.style.display = 'none';
    contactCount.style.display = 'none';
    xlsxWarning.style.display = 'none';
    saveState();
    updatePreview();
  });

  // ══════════════════════════════════════════════════════════════
  // PLACEHOLDER PILL BUTTONS
  // ══════════════════════════════════════════════════════════════

  $$('.placeholder-btns').forEach((container) => {
    const targetId = container.dataset.target;
    const targetEl = document.getElementById(targetId);

    container.querySelectorAll('.pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        const placeholder = pill.dataset.placeholder;

        if (targetEl.tagName === 'TEXTAREA' || targetEl.tagName === 'INPUT') {
          // Insert at cursor position
          const start = targetEl.selectionStart;
          const end = targetEl.selectionEnd;
          const val = targetEl.value;
          targetEl.value = val.substring(0, start) + placeholder + val.substring(end);
          // Move cursor after the inserted placeholder
          targetEl.selectionStart = targetEl.selectionEnd = start + placeholder.length;
          targetEl.focus();
        }

        // Trigger change events
        targetEl.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  });

  // ══════════════════════════════════════════════════════════════
  // LIVE PREVIEW
  // ══════════════════════════════════════════════════════════════

  previewToggle.addEventListener('click', () => {
    isPreviewOpen = !isPreviewOpen;
    previewBox.style.display = isPreviewOpen ? 'block' : 'none';
    previewToggle.classList.toggle('open', isPreviewOpen);
    if (isPreviewOpen) updatePreview();
  });

  function updatePreview() {
    if (!isPreviewOpen) return;

    const contact = contacts.length > 0 ? contacts[0] : {
      name: 'John Doe',
      company: 'Acme Corp',
      position: 'Software Engineer',
      email: 'john@example.com'
    };

    const subject = replacePlaceholders(subjectInput.value, contact);
    const body = replacePlaceholders(bodyInput.value, contact);

    previewSubject.textContent = subject || '(no subject)';
    previewBody.textContent = body || '(empty body)';
  }

  function replacePlaceholders(template, contact) {
    if (!template) return '';
    let result = template;
    for (const [key, value] of Object.entries(contact)) {
      const regex = new RegExp(`\\{${key}\\}`, 'gi');
      result = result.replace(regex, value || '');
    }
    return result;
  }

  // Update preview on template changes
  subjectInput.addEventListener('input', () => { updatePreview(); saveStateDebounced(); });
  bodyInput.addEventListener('input', () => { updatePreview(); saveStateDebounced(); });

  // ══════════════════════════════════════════════════════════════
  // SETTINGS
  // ══════════════════════════════════════════════════════════════

  delaySlider.addEventListener('input', () => {
    delayValue.textContent = `${delaySlider.value}s`;
    saveStateDebounced();
  });

  sendLimitEl.addEventListener('change', () => {
    saveStateDebounced();
  });

  ccInput.addEventListener('change', saveStateDebounced);
  bccInput.addEventListener('change', saveStateDebounced);

  // ══════════════════════════════════════════════════════════════
  // STATE PERSISTENCE (chrome.storage.local)
  // ══════════════════════════════════════════════════════════════

  let saveTimeout = null;
  function saveStateDebounced() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveState, 400);
  }

  function saveState() {
    chrome.storage.local.set({
      contacts: contacts,
      emailTemplate: {
        subject: subjectInput.value,
        body: bodyInput.value
      },
      cc: ccInput.value,
      bcc: bccInput.value,
      settings: {
        delaySeconds: parseInt(delaySlider.value, 10),
        sendLimit: parseInt(sendLimitEl.value, 10) || 50
      }
    });
  }

  function loadState() {
    chrome.storage.local.get(
      ['contacts', 'emailTemplate', 'cc', 'bcc', 'settings', 'sendingState'],
      (data) => {
        // Restore contacts
        if (data.contacts && data.contacts.length > 0) {
          contacts = data.contacts;
          fileUploadLabel.style.display = 'none';
          uploadInfo.style.display = 'flex';
          fileNameEl.textContent = `${contacts.length} contact${contacts.length !== 1 ? 's' : ''} loaded`;
          contactCount.textContent = contacts.length;
          contactCount.style.display = 'inline-block';
        }

        // Restore template
        if (data.emailTemplate) {
          subjectInput.value = data.emailTemplate.subject || '';
          bodyInput.value = data.emailTemplate.body || '';
        }

        // Restore CC/BCC
        if (data.cc) ccInput.value = data.cc;
        if (data.bcc) bccInput.value = data.bcc;

        // Restore settings
        if (data.settings) {
          delaySlider.value = data.settings.delaySeconds || 15;
          delayValue.textContent = `${delaySlider.value}s`;
          sendLimitEl.value = data.settings.sendLimit || 50;
        }

        // Restore sending state (if popup was closed mid-send)
        if (data.sendingState && data.sendingState.isSending) {
          showSendingUI(data.sendingState.currentIndex, data.sendingState.totalContacts);
          if (data.sendingState.log) {
            data.sendingState.log.forEach((entry) => addLogEntry(entry.type, entry.message, entry.time));
          }
        } else if (data.sendingState && data.sendingState.log && data.sendingState.log.length > 0) {
          // Show previous log
          logArea.style.display = 'block';
          data.sendingState.log.forEach((entry) => addLogEntry(entry.type, entry.message, entry.time));
        }
      }
    );
  }

  // ══════════════════════════════════════════════════════════════
  // GMAIL TAB CHECK
  // ══════════════════════════════════════════════════════════════

  function checkGmailTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab && tab.url && tab.url.includes('mail.google.com')) {
        statusDot.className = 'status-dot active';
        statusText.textContent = 'Connected to Gmail';
        startBtn.disabled = false;
      } else {
        statusDot.className = 'status-dot inactive';
        statusText.textContent = 'Not on a Gmail tab';
        startBtn.disabled = true;
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  // SENDING LOGIC
  // ══════════════════════════════════════════════════════════════

  startBtn.addEventListener('click', () => {
    // Validate
    if (contacts.length === 0) {
      showNotification('Please upload contacts first.', 'error');
      return;
    }
    if (!subjectInput.value.trim() && !bodyInput.value.trim()) {
      showNotification('Please enter a subject or body.', 'error');
      return;
    }

    // Get the active Gmail tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.url || !tab.url.includes('mail.google.com')) {
        showNotification('Please navigate to Gmail first.', 'error');
        return;
      }

      const payload = {
        type: 'start_sending',
        contacts: contacts,
        template: {
          subject: subjectInput.value,
          body: bodyInput.value
        },
        cc: ccInput.value.trim(),
        bcc: bccInput.value.trim(),
        delaySeconds: parseInt(delaySlider.value, 10),
        sendLimit: parseInt(sendLimitEl.value, 10) || 500
      };

      // Send to content script on the Gmail tab
      chrome.tabs.sendMessage(tab.id, payload, (response) => {
        if (chrome.runtime.lastError) {
          showNotification('Could not connect to Gmail tab. Try refreshing Gmail.', 'error');
          return;
        }
        if (response && response.ok) {
          showSendingUI(0, Math.min(contacts.length, payload.sendLimit));
        } else {
          showNotification(response?.error || 'Failed to start sending.', 'error');
        }
      });
    });
  });

  stopBtn.addEventListener('click', () => {
    // Send stop to background (which relays to all Gmail tabs)
    chrome.runtime.sendMessage({ type: 'stop_sending' });
    stopBtn.disabled = true;
    stopBtn.textContent = 'Stopping...';
  });

  // ── UI Updates ──────────────────────────────────────────────

  function showSendingUI(current, total) {
    startBtn.style.display = 'none';
    stopBtn.style.display = 'flex';
    stopBtn.disabled = false;
    stopBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Stop';
    progressWrap.style.display = 'block';
    logArea.style.display = 'block';
    updateProgress(current, total);
  }

  function hideSendingUI() {
    startBtn.style.display = 'flex';
    stopBtn.style.display = 'none';
    progressWrap.style.display = 'block'; // keep visible to show final state
  }

  function updateProgress(current, total) {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressFill.style.width = `${pct}%`;
    progressText.textContent = current >= total
      ? `Done! ${current}/${total} emails processed`
      : `Sending ${current}/${total}...`;
  }

  // ── Log Entries ─────────────────────────────────────────────

  function addLogEntry(type, message, time) {
    logArea.style.display = 'block';
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-time">${time || now()}</span><span class="log-msg">${escapeHTML(message)}</span>`;
    logEntries.appendChild(entry);
    // Auto-scroll to bottom
    logEntries.scrollTop = logEntries.scrollHeight;
  }

  clearLogBtn.addEventListener('click', () => {
    logEntries.innerHTML = '';
    logArea.style.display = 'none';
    progressWrap.style.display = 'none';
    progressFill.style.width = '0%';
    // Clear stored log
    chrome.storage.local.set({
      sendingState: { isSending: false, currentIndex: 0, totalContacts: 0, log: [] }
    });
  });

  // ── Listen for progress updates from content.js / background ─
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'progress_update') {
      updateProgress(message.current, message.total);

      // Add new log entries
      if (message.log && message.log.length > 0) {
        // Only add entries we haven't added yet
        const existingCount = logEntries.children.length;
        for (let i = existingCount; i < message.log.length; i++) {
          const entry = message.log[i];
          addLogEntry(entry.type, entry.message, entry.time);
        }
      }

      if (!message.isSending) {
        hideSendingUI();
      }

      sendResponse({ ok: true });
    }

    if (message.type === 'sending_complete') {
      updateProgress(message.current || 0, message.total || 0);
      hideSendingUI();

      if (message.log) {
        const existingCount = logEntries.children.length;
        for (let i = existingCount; i < message.log.length; i++) {
          const entry = message.log[i];
          addLogEntry(entry.type, entry.message, entry.time);
        }
      }

      sendResponse({ ok: true });
    }

    return true;
  });

  // ══════════════════════════════════════════════════════════════
  // NOTIFICATION TOAST
  // ══════════════════════════════════════════════════════════════

  function showNotification(msg, type = 'info') {
    // Remove existing notification
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.style.cssText = `
      position: fixed;
      top: 8px;
      left: 50%;
      transform: translateX(-50%) translateY(-100%);
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 500;
      z-index: 10000;
      animation: toastSlideIn 0.3s ease-out forwards;
      backdrop-filter: blur(12px);
      max-width: 380px;
      text-align: center;
      ${type === 'error'
        ? 'background: rgba(248,81,73,0.15); border: 1px solid rgba(248,81,73,0.3); color: #f85149;'
        : type === 'success'
          ? 'background: rgba(63,185,80,0.15); border: 1px solid rgba(63,185,80,0.3); color: #3fb950;'
          : 'background: rgba(139,92,246,0.15); border: 1px solid rgba(139,92,246,0.3); color: #a78bfa;'}
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);

    // Add animation keyframes if not present
    if (!document.querySelector('#toast-styles')) {
      const style = document.createElement('style');
      style.id = 'toast-styles';
      style.textContent = `
        @keyframes toastSlideIn {
          to { transform: translateX(-50%) translateY(0); }
        }
        @keyframes toastSlideOut {
          to { transform: translateX(-50%) translateY(-100%); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    // Auto-dismiss
    setTimeout(() => {
      toast.style.animation = 'toastSlideOut 0.3s ease-in forwards';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ══════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════

  function now() {
    return new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ══════════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════════

  loadState();
  checkGmailTab();

  // Re-check Gmail tab periodically (in case user switches tabs
  // while popup is open — though popups close on blur in Chrome)
  setInterval(checkGmailTab, 3000);

})();
