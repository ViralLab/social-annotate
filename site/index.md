---
layout: home

hero:
  name: "Social Annotate"
  text: "Annotate Social Media In-Feed"
  tagline: A self-healing Chrome extension that injects configurable annotation surveys directly into social media feeds — so researchers can label content in context, without leaving the platform.
  actions:
    - theme: brand
      text: Get Started
      link: /installation/
    - theme: alt
      text: GitHub
      link: https://github.com/ViralLab/social-annotate
    - theme: alt
      text: Read the Paper
      link: /about/#citation

features:
  - icon: 🗂️
    title: In-Feed Surveys
    details: Annotation forms appear directly alongside posts on X, Instagram, Bluesky, LinkedIn, WhatsApp, Telegram, and Truth Social — no copy-pasting, no context switching.
  - icon: ⚙️
    title: Fully Configurable
    details: Build survey forms visually or in JSON. Supports radio buttons, sliders, text inputs, and checkboxes. Per-survey IRB consent overlays included.
  - icon: 🎯
    title: Guided Annotation Mode
    details: Upload a target list of post IDs or usernames; the extension navigates annotators through the list in order and tracks progress automatically.
  - icon: 🛠️
    title: Self-Healing Selectors
    details: An LLM-powered Python agent detects when platform DOM changes break injection and proposes updated CSS selectors — no manual hunting required.
  - icon: 📦
    title: JSONL Export
    details: Download all collected labels from the popup in one click, or stream them to your own API endpoint on every submission.
  - icon: 🔒
    title: IRB-Ready Consent
    details: Write consent text in Markdown per survey. A timestamped JSON consent record is automatically saved to disk for legal compliance.
---

## Supported Platforms

| Platform | Post Annotation | User / Profile Annotation |
|---|:---:|:---:|
| X / Twitter | ✅ | ✅ |
| Instagram | ✅ | ✅ |
| Bluesky | ✅ | ✅ |
| WhatsApp Web | ✅ | — |
| Telegram Web | ✅ | — |
| LinkedIn | ✅ | ✅ |
| Truth Social | ✅ | ✅ |

## How It Works

Social Annotate uses a `MutationObserver` to detect new posts as they load. For each post it creates a **shadow DOM** container so survey styles never collide with the platform's CSS. The survey form itself runs inside a sandboxed `<iframe>` and communicates with the content script exclusively via `postMessage`.

All persistent state lives in `chrome.storage.local`. Nothing leaves the browser unless you export a JSONL file or configure an API endpoint.

```
Browser Tab (x.com)
  └─ inject.js — detects posts via MutationObserver
       └─ Shadow DOM host per post
            └─ sandboxed <iframe> with survey form
                 └─ postMessage → inject.js → background.js
                      └─ chrome.storage.local / downloads / API
```
