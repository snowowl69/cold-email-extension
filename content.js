// ============================================================
// content.js — Gmail Page Automation (Content Script)
// ============================================================
// This script runs on mail.google.com and automates composing
// and sending personalized emails through Gmail's web UI.
//
// ⚠️  Gmail DOM selectors are fragile and may break when Google
//     updates their UI. Selectors marked with [GMAIL-SELECTOR]
//     are the ones most likely to need updating.
// ============================================================

(function () {
  'use strict';

  // ── State ───────────────────────────────────────────────────
  let isSending = false;
  let shouldStop = false;
  let sendLog = [];
  let keepalivePort = null;

  // ── Utility: Promise-based delay ────────────────────────────
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── Utility: Wait for a DOM element to appear ───────────────
  // Polls the DOM every 300ms until `selector` is found or timeout.
  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);

      const interval = 300;
      let elapsed = 0;

      const timer = setInterval(() => {
        const el = document.querySelector(selector);
        if (el) {
          clearInterval(timer);
          resolve(el);
        }
        elapsed += interval;
        if (elapsed >= timeout) {
          clearInterval(timer);
          reject(new Error(`Timeout waiting for element: ${selector}`));
        }
      }, interval);
    });
  }

  // ── Utility: Simulate typing into an input/textarea/contenteditable ──
  // Gmail uses contenteditable divs for the body and custom
  // input widgets for To/CC/BCC fields. We dispatch appropriate
  // events to make Gmail recognise the input.
  function simulateInput(element, text) {
    // Focus the element first
    element.focus();

    if (element.isContentEditable) {
      // For Gmail's rich-text body editor (contenteditable div)
      // We set innerHTML to support line breaks in the email body
      element.innerHTML = text.replace(/\n/g, '<br>');

      // Dispatch input event so Gmail picks up the change
      element.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // For standard input fields (To, CC, BCC, Subject)
      element.value = text;

      // Dispatch events to trigger Gmail's internal handlers
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // ── Utility: Replace placeholders in a template string ──────
  // Replaces {name}, {company}, {position}, {email}, and any
  // other keys present in the contact object.
  function replacePlaceholders(template, contact) {
    if (!template) return '';
    let result = template;

    // Replace known placeholders + any extra columns from CSV
    for (const [key, value] of Object.entries(contact)) {
      const regex = new RegExp(`\\{${key}\\}`, 'gi');
      result = result.replace(regex, value || '');
    }

    return result;
  }

  // ── Utility: Get current timestamp string ───────────────────
  function timestamp() {
    return new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g,
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
  }

  // ── In-Page Notification & Completion Popups on Gmail ───────
  function showGmailToast(msg, type = 'success') {
    let container = document.getElementById('placement-bot-toast-wrap');
    if (!container) {
      container = document.createElement('div');
      container.id = 'placement-bot-toast-wrap';
      container.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      `;
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.style.cssText = `
      background: #18181b;
      color: #f4f4f5;
      border: 1px solid ${type === 'success' ? '#22c55e' : '#ef4444'};
      border-radius: 8px;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 10px 25px rgba(0,0,0,0.4);
      display: flex;
      align-items: center;
      gap: 8px;
      pointer-events: auto;
      transition: all 0.3s ease;
      opacity: 0;
      transform: translateY(12px);
    `;
    toast.innerHTML = `<span style="color:${type === 'success' ? '#22c55e' : '#ef4444'}; font-weight:bold;">${type === 'success' ? '✓' : '✗'}</span> <span>${escapeHTML(msg)}</span>`;
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function showGmailDonePopup(sentCount, totalCount) {
    const existing = document.getElementById('placement-bot-done-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'placement-bot-done-modal';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;

    overlay.innerHTML = `
      <div style="
        background: #1e1e24;
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 16px;
        padding: 28px 24px;
        max-width: 340px;
        width: 90%;
        text-align: center;
        box-shadow: 0 20px 40px rgba(0,0,0,0.6), 0 0 30px rgba(34, 197, 94, 0.2);
        color: #f4f4f5;
      ">
        <div style="
          width: 58px;
          height: 58px;
          border-radius: 50%;
          background: rgba(34, 197, 94, 0.15);
          border: 2px solid #22c55e;
          color: #22c55e;
          font-size: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 16px;
          font-weight: bold;
          box-shadow: 0 0 20px rgba(34, 197, 94, 0.3);
        ">✓</div>
        <h3 style="font-size: 19px; font-weight: 700; margin-bottom: 8px; color: #fff;">Emails Sent! 🎉</h3>
        <p style="font-size: 13px; color: #a1a1aa; line-height: 1.5; margin-bottom: 20px;">
          Placement Email Bot has completed. <strong>${sentCount} of ${totalCount}</strong> emails dispatched successfully.
        </p>
        <button id="pb-modal-close" style="
          width: 100%;
          padding: 12px;
          border-radius: 10px;
          border: none;
          background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(34,197,94,0.3);
        ">Done</button>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#pb-modal-close').addEventListener('click', () => {
      overlay.remove();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  function openKeepalivePort() {
    if (keepalivePort) return;

    try {
      keepalivePort = chrome.runtime.connect({ name: 'keepalive' });
      keepalivePort.onDisconnect.addListener(() => {
        keepalivePort = null;
      });
    } catch (_) {
      keepalivePort = null;
    }
  }

  function closeKeepalivePort() {
    if (!keepalivePort) return;

    try {
      keepalivePort.disconnect();
    } catch (_) {
      // Ignore disconnect errors during shutdown.
    } finally {
      keepalivePort = null;
    }
  }

  // ── Core: Click the Gmail "Compose" button ──────────────────
  async function clickCompose() {
    // [GMAIL-SELECTOR] The compose button's selector.
    // Gmail uses div[gh='cm'] or a button with specific classes.
    // Try multiple selectors for resilience.
    const selectors = [
      'div[gh="cm"]',                              // Classic Gmail compose trigger
      '.T-I.T-I-KE.L3',                            // Compose button class pattern
      'div.aic div[role="button"]',                 // Alternative compose area
      'button[aria-label="Compose"]',               // Accessible label (if present)
      '[data-tooltip="Compose"]'                    // Tooltip-based selector
    ];

    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        btn.click();
        // Wait a bit for the compose window to open
        await delay(1500);
        return true;
      }
    }

    throw new Error('Could not find the Gmail Compose button. Please make sure Gmail is fully loaded.');
  }

  // ── Core: Fill the compose window fields ────────────────────
  async function fillComposeWindow(to, subject, body, cc, bcc) {
    // --- TO field ---
    // [GMAIL-SELECTOR] Gmail "To" field is usually a textarea or input
    // inside the compose window.
    const toSelectors = [
      'textarea[name="to"]',
      'input[name="to"]',
      'div[name="to"] input',
      'input[aria-label="To recipients"]',          // Accessible label
      'input[aria-label="To"]',
      'div.aoD.hl input',                           // Class-based fallback
      'span[name="to"] input'
    ];

    let toField = null;
    for (const sel of toSelectors) {
      try {
        toField = await waitForElement(sel, 5000);
        break;
      } catch (_) { /* try next selector */ }
    }

    if (!toField) {
      throw new Error('Could not find the "To" field in compose window.');
    }

    simulateInput(toField, to);
    // Press Tab/Enter to confirm the recipient in Gmail's chip UI
    toField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true }));
    await delay(500);

    // --- CC/BCC fields ---
    if (cc || bcc) {
      // [GMAIL-SELECTOR] Click CC/BCC toggle links to reveal those fields
      const ccToggle = document.querySelector('span.aB.gQ.pE') ||       // "Cc" link
                       document.querySelector('[aria-label="Add Cc recipients"]') ||
                       document.querySelector('span[data-tooltip="Add Cc"]');
      const bccToggle = document.querySelector('span.aB.gQ.pB') ||      // "Bcc" link
                        document.querySelector('[aria-label="Add Bcc recipients"]') ||
                        document.querySelector('span[data-tooltip="Add Bcc"]');

      if (cc && ccToggle) {
        ccToggle.click();
        await delay(500);
        const ccField = document.querySelector('textarea[name="cc"]') ||
                        document.querySelector('input[name="cc"]') ||
                        document.querySelector('input[aria-label="Cc"]');
        if (ccField) {
          simulateInput(ccField, cc);
          ccField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true }));
          await delay(300);
        }
      }

      if (bcc && bccToggle) {
        bccToggle.click();
        await delay(500);
        const bccField = document.querySelector('textarea[name="bcc"]') ||
                         document.querySelector('input[name="bcc"]') ||
                         document.querySelector('input[aria-label="Bcc"]');
        if (bccField) {
          simulateInput(bccField, bcc);
          bccField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true }));
          await delay(300);
        }
      }
    }

    // --- Subject field ---
    // [GMAIL-SELECTOR] Subject input
    const subjectField = document.querySelector('input[name="subjectbox"]') ||
                         document.querySelector('input[aria-label="Subject"]');
    if (subjectField) {
      simulateInput(subjectField, subject);
      await delay(300);
    }

    // --- Body field ---
    // [GMAIL-SELECTOR] Gmail body is a contenteditable div
    const bodySelectors = [
      'div[aria-label="Message Body"]',
      'div[role="textbox"][aria-label="Message Body"]',
      'div.Am.Al.editable',
      'div[contenteditable="true"][aria-label="Message Body"]',
      'div[g_editable="true"]'
    ];

    let bodyField = null;
    for (const sel of bodySelectors) {
      bodyField = document.querySelector(sel);
      if (bodyField) break;
    }

    if (bodyField) {
      simulateInput(bodyField, body);
      await delay(300);
    }
  }

  // ── Core: Click the Send button ─────────────────────────────
  async function clickSend() {
    // [GMAIL-SELECTOR] Gmail's Send button
    const sendSelectors = [
      'div[aria-label="Send"][role="button"]',       // Send button with ARIA
      'div.T-I.J-J5-Ji.aoO.v7.T-I-atl.L3',        // Send button class pattern
      'div[data-tooltip="Send"]',                    // Tooltip-based
      'div[data-tooltip^="Send"]'                    // Partial tooltip match
    ];

    for (const sel of sendSelectors) {
      const sendBtn = document.querySelector(sel);
      if (sendBtn) {
        sendBtn.click();
        await delay(1000);
        return true;
      }
    }

    throw new Error('Could not find the Send button.');
  }

  // ── Core: Close compose window (discard) ────────────────────
  async function closeCompose() {
    // [GMAIL-SELECTOR] Discard / close compose window
    const closeSelectors = [
      'div[aria-label="Discard draft"]',
      'div[data-tooltip="Discard draft"]',
      'img[aria-label="Discard draft"]',
      'div.og.T-I-J3.J-J5-Ji'                      // Close button class
    ];

    for (const sel of closeSelectors) {
      const closeBtn = document.querySelector(sel);
      if (closeBtn) {
        closeBtn.click();
        await delay(500);
        return;
      }
    }
  }

  // ── Core: Send a single email ───────────────────────────────
  async function sendOneEmail(contact, template, cc, bcc) {
    const to = contact.email || contact.Email || '';
    if (!to) {
      throw new Error('No email address found for contact.');
    }

    const subject = replacePlaceholders(template.subject, contact);
    const body = replacePlaceholders(template.body, contact);

    // Step 1: Open compose window
    await clickCompose();

    // Step 2: Wait for compose window to be ready
    // [GMAIL-SELECTOR] Wait for the compose dialog container
    try {
      await waitForElement('div.nH.Hd[role="dialog"], div.AD', 8000);
    } catch (_) {
      // Compose window might use a different structure, proceed anyway
    }
    await delay(500);

    // Step 3: Fill in all fields
    await fillComposeWindow(to, subject, body, cc, bcc);

    // Step 4: Click send
    await clickSend();

    // Step 5: Wait for send confirmation (Gmail shows a brief "Message sent" banner)
    await delay(1000);
  }

  // ── Core: Send all emails sequentially ──────────────────────
  async function sendAllEmails(contacts, template, cc, bcc, delayMs, sendLimit) {
    isSending = true;
    shouldStop = false;
    sendLog = [];
    openKeepalivePort();

    const total = Math.min(contacts.length, sendLimit || contacts.length);

    for (let i = 0; i < total; i++) {
      // Check for stop command
      if (shouldStop) {
        addLog('info', `Stopped by user at ${i}/${total}`);
        break;
      }

      const contact = contacts[i];
      const contactName = contact.name || contact.Name || contact.email || `Contact ${i + 1}`;

      let lastSentContact = null;
      try {
        addLog('info', `Sending to ${contactName}...`);
        await sendOneEmail(contact, template, cc, bcc);
        addLog('success', `✓ Sent to ${contactName}`);
        lastSentContact = contactName;
        showGmailToast(`Sent email to ${contactName} (${i + 1}/${total})`, 'success');
      } catch (err) {
        addLog('error', `✗ Failed for ${contactName}: ${err.message}`);
        showGmailToast(`Failed for ${contactName}: ${err.message}`, 'error');
        // Try to close any open compose window before continuing
        await closeCompose();
      }

      // Report progress to popup / background
      reportProgress(i + 1, total, lastSentContact);

      // Delay before next email (skip delay after last email)
      if (i < total - 1 && !shouldStop) {
        addLog('info', `Waiting ${delayMs / 1000}s before next email...`);
        await delay(delayMs);
      }
    }

    isSending = false;
    closeKeepalivePort();

    const sentSuccess = shouldStop
      ? sendLog.filter(l => l.type === 'success').length
      : total;

    // Report completion
    chrome.runtime.sendMessage({
      type: 'sending_complete',
      current: sentSuccess,
      total: total,
      log: sendLog
    });

    addLog('info', shouldStop ? 'Sending stopped.' : 'All emails sent! ✓');

    // Show celebratory on-page popup on Gmail tab
    showGmailDonePopup(sentSuccess, total);
  }

  // ── Helpers: Logging & Progress ─────────────────────────────
  function addLog(type, message) {
    sendLog.push({
      type: type,
      message: message,
      time: timestamp()
    });
  }

  function reportProgress(current, total, lastSent = null) {
    chrome.runtime.sendMessage({
      type: 'progress_update',
      current: current,
      total: total,
      isSending: isSending,
      lastSent: lastSent,
      log: sendLog
    });
  }

  // ── Message Listener (from popup / background) ──────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // ── Start Sending ──
    if (message.type === 'start_sending') {
      if (isSending) {
        sendResponse({ ok: false, error: 'Already sending.' });
        return true;
      }

      const { contacts, template, cc, bcc, delaySeconds, sendLimit } = message;
      const delayMs = (delaySeconds || 15) * 1000;

      // Kick off the sending process (async, don't await)
      sendAllEmails(contacts, template, cc, bcc, delayMs, sendLimit)
        .catch((err) => {
          addLog('error', `Fatal error: ${err.message}`);
          isSending = false;
          closeKeepalivePort();
          reportProgress(0, contacts.length);
        });

      sendResponse({ ok: true });
      return true;
    }

    // ── Stop Sending ──
    if (message.type === 'stop_sending') {
      shouldStop = true;
      sendResponse({ ok: true });
      return true;
    }

    // ── Ping (check if content script is alive) ──
    if (message.type === 'ping') {
      sendResponse({ ok: true, isSending: isSending });
      return true;
    }
  });

  // ── Announce that the content script is ready ───────────────
  console.log('[Placement Email Bot] Content script loaded on Gmail.');
})();
