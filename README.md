# 🚀 Cold Email & Placement Assistant — Chrome Extension (Manifest V3)

A powerful, privacy-first Google Chrome extension designed to streamline personalized cold email outreach directly from your browser. Ideal for internships, job placements, and recruiter engagement.

---

## ✨ Features

- **Profile Scraping**: Extracts key recruiter details (Name, Company, Role, Email) from LinkedIn and professional directories in one click.
- **Smart Template Generation**: Automatically populates personalized email templates with dynamic tokens (`{{name}}`, `{{company}}`, `{{role}}`).
- **One-Click Gmail Integration**: Opens pre-filled Gmail compose windows ready for review or immediate dispatch.
- **Local Storage**: All data, drafted templates, and recipient logs are kept strictly in your local browser storage.
- **Manifest V3 Compliant**: Built following modern security, performance, and permission guidelines.

---

## 🛠️ Project Structure

```text
cold-email-extension/
├── manifest.json       # Manifest V3 extension configuration
├── background.js       # Service worker handling background tasks and alarms
├── content.js          # Injected content script for profile parsing
├── popup.html          # Extension popup UI
├── popup.css           # Styling for popup interface
├── popup.js            # Popup interactive logic and template controls
├── icons/              # Extension icons (16px, 48px, 128px)
├── logo.png            # High-res branding asset
└── project-report.md   # Architectural overview and technical documentation
```

---

## 📥 Installation & Setup

1. Open Google Chrome or any Chromium-based browser (Brave, Edge, Opera).
2. Navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** in the top-left.
5. Select this folder: `c:\Users\Raghav\Desktop\raga\cold-email-extension`.
6. Pin the extension to your toolbar for instant access!

---

## 💡 How to Use

1. **Configure Templates**: Click the extension icon and set up your default reach-out templates.
2. **Browse Profiles**: Open any recruiter or hiring manager's profile on LinkedIn.
3. **Generate & Send**: Click the extension popup to auto-fill the contact's details into your chosen template and click **Open in Gmail**.
