<template>
  <div class="home-page">

    <!-- ── Hero ── -->
    <section class="hero">
      <div class="hero-inner">
        <p class="badge">Research Tool &nbsp;·&nbsp; Open Source</p>

        <h1>
          Annotate Social Media<br>
          <em class="gold">In-Feed.</em>
        </h1>

        <p class="tagline">Zero context switching. IRB-ready. Self-healing.</p>

        <div class="actions">
          <a href="https://github.com/ViralLab/social-annotate/releases/latest" class="btn-cta">
            <span class="btn-icon">⬇</span> Download Extension
          </a>
        </div>

        <div class="secondary-links">
          <a href="/social-annotate/installation/">Get Started</a>
          <span class="dot">·</span>
          <a href="https://github.com/ViralLab/social-annotate">GitHub</a>
          <span class="dot">·</span>
          <a href="/social-annotate/about/#citation">Read the Paper</a>
        </div>
      </div>
    </section>

    <!-- ── Demo placeholder (GIFs go here) ── -->
    <section class="demo-section">
      <div class="demo-inner">
        <div class="demo-frame">
          <div class="demo-chrome">
            <span class="dot-r"></span><span class="dot-y"></span><span class="dot-g"></span>
          </div>
          <div class="demo-body">
            <p class="demo-placeholder">Demo GIF coming soon</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Features ── -->
    <section class="features-section">
      <div class="section-inner">
        <h2>Everything you need to annotate at scale</h2>
        <div class="feature-grid">
          <div class="feature" v-for="f in features" :key="f.title">
            <span class="feature-icon">{{ f.icon }}</span>
            <h3>{{ f.title }}</h3>
            <p>{{ f.details }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Supported Platforms ── -->
    <section class="platforms-section">
      <div class="section-inner">
        <h2>Supported Platforms</h2>
        <table>
          <thead>
            <tr>
              <th>Platform</th>
              <th>Post Annotation</th>
              <th>User / Profile</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in platforms" :key="p.name">
              <td>{{ p.name }}</td>
              <td class="center">{{ p.post }}</td>
              <td class="center">{{ p.profile }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── How It Works ── -->
    <section class="how-section">
      <div class="section-inner">
        <h2>How It Works</h2>
        <p class="how-desc">
          Social Annotate uses a <code>MutationObserver</code> to detect new posts as they load.
          For each post it creates a <strong>shadow DOM</strong> container so survey styles never
          collide with the platform's CSS. The survey form runs inside a sandboxed
          <code>&lt;iframe&gt;</code> and communicates via <code>postMessage</code>.
          All state lives in <code>chrome.storage.local</code> — nothing leaves the browser
          unless you export or configure an API endpoint.
        </p>
        <pre class="arch"><code>Browser Tab (x.com)
  └─ inject.js — detects posts via MutationObserver
       └─ Shadow DOM host per post
            └─ sandboxed &lt;iframe&gt; with survey form
                 └─ postMessage → inject.js → background.js
                      └─ chrome.storage.local / downloads / API</code></pre>
      </div>
    </section>

  </div>
</template>

<script setup>
const features = [
  { icon: '🗂️', title: 'In-Feed Surveys',         details: 'Annotation forms appear directly alongside posts on X, Instagram, Bluesky, LinkedIn, WhatsApp, Telegram, and Truth Social — no copy-pasting, no context switching.' },
  { icon: '⚙️', title: 'Fully Configurable',       details: 'Build survey forms visually or in JSON. Supports radio buttons, sliders, text inputs, and checkboxes. Per-survey IRB consent overlays included.' },
  { icon: '🎯', title: 'Guided Annotation Mode',   details: 'Upload a target list of post IDs or usernames; the extension navigates annotators through the list in order and tracks progress automatically.' },
  { icon: '🛠️', title: 'Self-Healing Selectors',   details: 'An LLM-powered Python agent detects when platform DOM changes break injection and proposes updated CSS selectors — no manual hunting required.' },
  { icon: '📦', title: 'JSONL Export',             details: 'Download all collected labels from the popup in one click, or stream them to your own API endpoint on every submission.' },
  { icon: '🔒', title: 'IRB-Ready Consent',        details: 'Write consent text in Markdown per survey. A timestamped JSON consent record is automatically saved to disk for legal compliance.' },
]

const platforms = [
  { name: 'X / Twitter',  post: '✅', profile: '✅' },
  { name: 'Instagram',    post: '✅', profile: '✅' },
  { name: 'Bluesky',      post: '✅', profile: '✅' },
  { name: 'WhatsApp Web', post: '✅', profile: '—'  },
  { name: 'Telegram Web', post: '✅', profile: '—'  },
  { name: 'LinkedIn',     post: '✅', profile: '✅' },
  { name: 'Truth Social', post: '✅', profile: '✅' },
]
</script>

<style scoped>
/* ── Tokens ── */
:root {
  --gold: #c9a860;
  --gold-dim: rgba(201, 168, 96, 0.35);
}

/* ── Page ── */
.home-page {
  background: #0f0f0f;
  color: #e8e0d0;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  min-height: 100vh;
}

/* ── Hero ── */
.hero {
  padding: 110px 24px 80px;
  text-align: center;
}

.hero-inner {
  max-width: 820px;
  margin: 0 auto;
}

.badge {
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  color: #555;
  letter-spacing: 0.06em;
  margin: 0 0 32px;
}

.hero h1 {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: clamp(3.4rem, 8vw, 6.5rem);
  font-weight: 800;
  line-height: 1.08;
  letter-spacing: -0.01em;
  color: #f0ebe0;
  margin: 0 0 28px;
  border: none;
  padding: 0;
}

.gold {
  color: #c9a860;
  font-style: italic;
}

.tagline {
  font-family: 'Courier New', Courier, monospace;
  font-size: 1rem;
  color: #666;
  letter-spacing: 0.03em;
  margin: 0 0 40px;
}

/* ── CTA button ── */
.actions {
  margin-bottom: 20px;
}

.btn-cta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 28px;
  border: 1px solid #c9a860;
  border-radius: 6px;
  color: #c9a860;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  letter-spacing: 0.02em;
  transition: background 0.15s, color 0.15s;
}
.btn-cta:hover {
  background: rgba(201, 168, 96, 0.08);
  color: #d4b870;
}

.btn-icon {
  font-size: 13px;
}

/* ── Secondary links ── */
.secondary-links {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 13px;
  color: #444;
}
.secondary-links a {
  color: #555;
  text-decoration: none;
  transition: color 0.15s;
}
.secondary-links a:hover {
  color: #c9a860;
}
.dot {
  color: #2e2e2e;
}

/* ── Demo frame ── */
.demo-section {
  padding: 0 24px 80px;
}
.demo-inner {
  max-width: 880px;
  margin: 0 auto;
}
.demo-frame {
  border: 1px solid #1e1e1e;
  border-radius: 10px;
  overflow: hidden;
  background: #0a0a0a;
}
.demo-chrome {
  background: #141414;
  border-bottom: 1px solid #1e1e1e;
  padding: 10px 14px;
  display: flex;
  gap: 6px;
  align-items: center;
}
.dot-r, .dot-y, .dot-g {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.dot-r { background: #3a1a1a; }
.dot-y { background: #3a3018; }
.dot-g { background: #183a1e; }
.demo-body {
  height: 340px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.demo-placeholder {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: #2a2a2a;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* ── Section shared ── */
.section-inner {
  max-width: 960px;
  margin: 0 auto;
  padding: 0 24px;
}

/* ── Features ── */
.features-section {
  padding: 80px 0;
  border-top: 1px solid #1a1a1a;
}
.features-section h2 {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 2rem;
  font-weight: 700;
  color: #e8e0d0;
  margin: 0 0 40px;
  border: none;
  padding: 0;
}
.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 1px;
  background: #1a1a1a;
  border: 1px solid #1a1a1a;
  border-radius: 8px;
  overflow: hidden;
}
.feature {
  background: #0f0f0f;
  padding: 28px 24px;
  transition: background 0.15s;
}
.feature:hover {
  background: #131313;
}
.feature-icon {
  font-size: 18px;
  display: block;
  margin-bottom: 14px;
}
.feature h3 {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 16px;
  font-weight: 700;
  color: #d8d0c0;
  margin: 0 0 8px;
  border: none;
  padding: 0;
}
.feature p {
  font-size: 13px;
  color: #555;
  line-height: 1.65;
  margin: 0;
}

/* ── Platforms ── */
.platforms-section {
  padding: 80px 0;
  border-top: 1px solid #1a1a1a;
}
.platforms-section h2,
.how-section h2 {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 2rem;
  font-weight: 700;
  color: #e8e0d0;
  margin: 0 0 32px;
  border: none;
  padding: 0;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
}
thead th {
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #3a3a3a;
  padding: 10px 14px;
  border-bottom: 1px solid #1a1a1a;
}
tbody td {
  padding: 12px 14px;
  color: #666;
  border-bottom: 1px solid #141414;
}
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover td { background: #111; }
td.center { text-align: center; }

/* ── How it works ── */
.how-section {
  padding: 80px 0 100px;
  border-top: 1px solid #1a1a1a;
}
.how-desc {
  font-size: 14px;
  color: #555;
  line-height: 1.8;
  margin: 0 0 28px;
  max-width: 640px;
}
.how-desc code {
  font-family: 'Courier New', monospace;
  font-size: 12.5px;
  color: #888;
  background: #141414;
  border: 1px solid #1e1e1e;
  border-radius: 3px;
  padding: 1px 5px;
}
.how-desc strong { color: #888; font-weight: 600; }
.arch {
  background: #0a0a0a;
  border: 1px solid #1a1a1a;
  border-radius: 8px;
  padding: 20px 24px;
  overflow-x: auto;
}
.arch code {
  font-family: 'Courier New', Courier, monospace;
  font-size: 12.5px;
  color: #444;
  line-height: 1.75;
  white-space: pre;
}
</style>
