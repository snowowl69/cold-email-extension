// ============================================================
// background.js — Service Worker for Placement Email Bot
// ============================================================
// This is a Manifest V3 service worker. It:
//   1. Sets default storage values on first install
//   2. Relays messages between popup ↔ content scripts
//   3. Handles runtime lifecycle events
// ============================================================

// ── Installation & Default Settings ─────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Set sensible defaults on first install
    chrome.storage.local.set({
      contacts: [],
      emailTemplate: {
        subject: '',
        body: ''
      },
      cc: '',
      bcc: '',
      settings: {
        delaySeconds: 15,   // seconds between each email
        sendLimit: 50       // max emails per session
      },
      sendingState: {
        isSending: false,
        currentIndex: 0,
        totalContacts: 0,
        log: []
      }
    }, () => {
      console.log('[Placement Email Bot] Installed — default settings saved.');
    });
  }
});

// ── Message Relay (popup ↔ content script) ──────────────────
// The popup can talk to the content script directly via
// chrome.tabs.sendMessage, but this relay handles edge cases
// where the popup is closed and the content script needs to
// persist state.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Relay progress updates from content.js to storage so
  // the popup can pick them up even after being re-opened
  if (message.type === 'progress_update') {
    chrome.storage.local.set({
      sendingState: {
        isSending: message.isSending,
        currentIndex: message.current,
        totalContacts: message.total,
        log: message.log || []
      }
    });
    sendResponse({ ok: true });
    return true;
  }

  // Relay "sending_complete" so storage is cleaned up
  if (message.type === 'sending_complete') {
    chrome.storage.local.set({
      sendingState: {
        isSending: false,
        currentIndex: message.current || 0,
        totalContacts: message.total || 0,
        log: message.log || []
      }
    });
    sendResponse({ ok: true });
    return true;
  }

  // Relay stop command from popup to content script
  if (message.type === 'stop_sending') {
    // Forward to all Gmail tabs
    chrome.tabs.query({ url: 'https://mail.google.com/*' }, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, { type: 'stop_sending' });
      });
    });
    sendResponse({ ok: true });
    return true;
  }
});

// ── Keep-alive ping (prevents SW from being killed mid-send) ─
// Content script can ping this to keep the service worker alive
// during long sending sessions.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'keepalive') {
    // Port stays open, keeping the service worker alive
    port.onDisconnect.addListener(() => {
      console.log('[Placement Email Bot] Keep-alive port disconnected.');
    });
  }
});
