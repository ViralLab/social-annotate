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
            Download Extension
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

    <!-- ── Showcase sections ── -->
    <section class="showcase" v-for="(s, i) in showcases" :key="s.label" :class="{ 'showcase--flip': i % 2 === 1 }">
      <div class="showcase-row">
        <div class="showcase-text">
          <p class="showcase-label">{{ s.label }}</p>
          <h2 class="showcase-heading">{{ s.heading }}</h2>
          <p class="showcase-desc">{{ s.desc }}</p>
        </div>
        <div class="showcase-frame">
          <div class="frame-chrome">
            <span class="dot-r"></span><span class="dot-y"></span><span class="dot-g"></span>
          </div>
          <div class="frame-body">
            <video v-if="s.video" :src="s.video" class="frame-img" autoplay loop muted playsinline />
            <p v-else class="frame-placeholder">{{ s.placeholder }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Features ── -->
    <section class="features-section reveal">
      <div class="section-inner">
        <h2>Everything you need to annotate at scale</h2>
        <div class="feature-grid">
          <div class="feature" v-for="(f, i) in features" :key="f.title" :style="{ animationDelay: (520 + i * 60) + 'ms' }">
            <span class="feature-rule"></span>
            <h3>{{ f.title }}</h3>
            <p>{{ f.details }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Supported Platforms ── -->
    <section class="platforms-section reveal">
      <div class="section-inner">
        <h2>Supported Platforms</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th rowspan="2" class="th-platform">Platform</th>
                <th colspan="5" class="group-header">Data Collection</th>
                <th colspan="2" class="group-header border-left">Intervention</th>
              </tr>
              <tr>
                <th class="sub-th">Posts</th>
                <th class="sub-th">Accounts</th>
                <th class="sub-th">Comments</th>
                <th class="sub-th">Videos</th>
                <th class="sub-th">Reels</th>
                <th class="sub-th border-left">Account</th>
                <th class="sub-th">Post</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="(row, i) in platforms" :key="i">
                <tr v-if="row.sep" class="sep-row"><td colspan="8"></td></tr>
                <tr v-else>
                  <td>{{ row.name }}</td>
                  <td class="center"><span v-if="row.posts"    class="check">✓</span></td>
                  <td class="center"><span v-if="row.accounts" class="check">✓</span></td>
                  <td class="center"><span v-if="row.comments" class="check">✓</span></td>
                  <td class="center"><span v-if="row.videos"   class="check">✓</span></td>
                  <td class="center"><span v-if="row.reels"    class="check">✓</span></td>
                  <td class="center border-left"><span v-if="row.account" class="check">✓</span></td>
                  <td class="center"><span v-if="row.post"     class="check">✓</span></td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </section>


  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const showcases = [
  {
    label: 'In-Feed Annotation',
    heading: 'Survey forms appear directly above each post.',
    desc: 'No tab-switching, no copy-pasting. The annotation form injects directly into the feed on X, Instagram, Bluesky, and more — annotators stay in context the entire time.',
    video: '/social-annotate/demos/infeed.mp4',
    placeholder: '',
  },
  {
    label: 'Full Configuration',
    heading: 'Build any survey in minutes.',
    desc: 'Radio buttons, sliders, text inputs, dropdowns — configure the form schema visually or in JSON. Each platform and survey type gets its own independent settings.',
    video: '/social-annotate/demos/form_builder.mp4',
    placeholder: '',
  },
  {
    label: 'In-Feed Intervention',
    heading: 'Rewrite posts before participants see them.',
    desc: 'Replace text and images in-feed using a pre-built static map or a live server. Blind mode hides the original entirely; aware mode lets participants toggle between versions.',
    video: '/social-annotate/demos/intervention_scroll.mp4',
    placeholder: '',
  },
]

const features = [
  { title: 'In-Feed Surveys',         details: 'Annotation forms appear directly alongside posts on X, Instagram, Bluesky, LinkedIn, WhatsApp, Telegram, and Truth Social — no copy-pasting, no context switching.' },
  { title: 'Fully Configurable',       details: 'Build survey forms visually or in JSON. Supports radio buttons, sliders, text inputs, and checkboxes. Per-survey IRB consent overlays included.' },
  { title: 'In-Feed Intervention',     details: 'Replace post text and images in-feed before participants see them. Use a pre-built static map or stream rewrites from a live server. Blind and aware modes supported.' },
  { title: 'Guided Annotation Mode',   details: 'Upload a target list of post IDs or usernames; the extension navigates annotators through the list in order and tracks progress automatically.' },
  { title: 'Self-Healing Selectors',   details: 'An LLM-powered Python agent detects when platform DOM changes break injection and proposes updated CSS selectors — no manual hunting required.' },
  { title: 'JSONL Export',             details: 'Download all collected labels from the popup in one click, or stream them to your own API endpoint on every submission.' },
  { title: 'IRB-Ready Consent',        details: 'Write consent text in Markdown per survey. A timestamped JSON consent record is automatically saved to disk for legal compliance.' },
  { title: 'Multi-Platform Coverage',  details: 'Annotation and intervention across X, Instagram, TikTok, Facebook, Bluesky, Mastodon, LinkedIn, Reddit, YouTube, WhatsApp, Telegram, and Truth Social.' },
  { title: 'Media Download',           details: 'Automatically saves profile pictures, profile banners, post images, and reels to disk alongside annotations — organized by platform and survey type.' },
]

const platforms = [
  { name: 'X / Twitter',  posts: true,  accounts: true,  comments: false, videos: false, reels: false, account: true,  post: true  },
  { name: 'TikTok',       posts: false, accounts: true,  comments: true,  videos: true,  reels: true,  account: false, post: false },
  { name: 'Instagram',    posts: true,  accounts: true,  comments: true,  videos: false, reels: true,  account: true,  post: true  },
  { name: 'Facebook',     posts: true,  accounts: true,  comments: false, videos: false, reels: false, account: true,  post: true  },
  { name: 'Bluesky',      posts: true,  accounts: true,  comments: false, videos: false, reels: false, account: true,  post: true  },
  { name: 'Mastodon',     posts: true,  accounts: true,  comments: false, videos: false, reels: false, account: true,  post: true  },
  { name: 'Truth Social', posts: true,  accounts: true,  comments: false, videos: false, reels: false, account: true,  post: true  },
  { sep: true },
  { name: 'LinkedIn',     posts: true,  accounts: true,  comments: false, videos: false, reels: false, account: false, post: true  },
  { name: 'Reddit',       posts: true,  accounts: true,  comments: true,  videos: false, reels: false, account: false, post: true  },
  { name: 'YouTube',      posts: false, accounts: true,  comments: true,  videos: true,  reels: false, account: false, post: false },
  { sep: true },
  { name: 'WhatsApp',     posts: true,  accounts: false, comments: false, videos: false, reels: false, account: false, post: true  },
  { name: 'Telegram',     posts: true,  accounts: true,  comments: false, videos: false, reels: false, account: false, post: true  },
]

// Scroll-triggered reveal for sections below the fold
onMounted(() => {
  const observer = new IntersectionObserver(
    (entries) => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); } }),
    { threshold: 0.08 }
  )
  document.querySelectorAll('.reveal, .showcase').forEach(el => observer.observe(el))
})
</script>

<style scoped>
/* ── Hero load animation ── */
@keyframes fadeSlideUp {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes typing {
  from { clip-path: inset(0 100% 0 0); }
  to   { clip-path: inset(0 0% 0 0); }
}
@keyframes blink-cursor {
  0%, 100% { border-color: transparent; }
  50%       { border-color: #777; }
}

.badge,
.hero h1,
.actions,
.secondary-links {
  animation: fadeSlideUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.badge            { animation-delay: 0ms; }
.hero h1          { animation-delay: 80ms; }
.actions          { animation-delay: 2400ms; }
.secondary-links  { animation-delay: 2500ms; }

/* ── Scroll reveal ── */
.showcase,
.reveal {
  opacity: 0;
  transform: translateY(24px);
  transition: opacity 0.7s cubic-bezier(0.22, 1, 0.36, 1),
              transform 0.7s cubic-bezier(0.22, 1, 0.36, 1);
}
.showcase.visible,
.reveal.visible {
  opacity: 1;
  transform: translateY(0);
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
  color: #c9a860;
  letter-spacing: 0.08em;
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
  font-weight: 700;
  color: #bbb;
  letter-spacing: 0.03em;
  margin: 0 0 40px;
  white-space: nowrap;
  animation: typing 1.8s steps(49, end) 0.5s both;
}

/* ── CTA ── */
.actions { margin-bottom: 20px; }
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
.btn-icon { font-size: 13px; }

/* ── Secondary links ── */
.secondary-links {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 13px;
}
.secondary-links a {
  color: #888;
  font-weight: 500;
  text-decoration: none;
  transition: color 0.15s;
}
.secondary-links a:hover { color: #c9a860; }
.dot { color: #555; }

/* ── Showcase sections ── */
.showcase {
  padding: 100px 24px;
  border-top: 1px solid #1a1a1a;
}
.showcase-row {
  max-width: 1100px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 64px;
}
.showcase--flip .showcase-row {
  flex-direction: row-reverse;
}

/* Text side */
.showcase-text {
  flex: 0 0 300px;
  min-width: 0;
}
.showcase-label {
  font-family: 'Courier New', monospace;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #c9a860;
  margin: 0 0 16px;
}
.showcase-heading {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: clamp(1.4rem, 2.5vw, 2rem);
  font-weight: 700;
  color: #f0ebe0;
  line-height: 1.25;
  margin: 0 0 16px;
  border: none;
  padding: 0;
}
.showcase-desc {
  font-size: 14px;
  font-weight: 500;
  color: #aaa;
  line-height: 1.75;
  margin: 0;
}

/* Frame side */
.showcase-frame {
  flex: 1;
  min-width: 0;
  border: 1px solid #1e1e1e;
  border-radius: 10px;
  overflow: hidden;
  background: #0a0a0a;
}
.frame-chrome {
  background: #141414;
  border-bottom: 1px solid #1e1e1e;
  padding: 10px 14px;
  display: flex;
  gap: 6px;
  align-items: center;
}
.dot-r, .dot-y, .dot-g {
  width: 10px; height: 10px; border-radius: 50%;
}
.dot-r { background: #3a1a1a; }
.dot-y { background: #3a3018; }
.dot-g { background: #183a1e; }
.frame-body {
  min-height: 300px;
  max-height: 560px;
  overflow: hidden;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}
.frame-img {
  width: 100%;
  height: auto;
  display: block;
}
.frame-placeholder {
  font-family: 'Courier New', monospace;
  font-size: 11px;
  color: #3a3a3a;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  text-align: center;
  padding: 0 24px;
  margin: 0;
}

/* Stack on mobile */
@media (max-width: 768px) {
  .showcase-row,
  .showcase--flip .showcase-row {
    flex-direction: column;
    gap: 36px;
  }
  .showcase-text {
    flex: none;
    text-align: center;
  }
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
.feature:hover { background: #131313; }
.feature-rule {
  display: block;
  width: 20px;
  height: 1px;
  background: #c9a860;
  margin-bottom: 16px;
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
  font-weight: 500;
  color: #999;
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
.table-wrap {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
}
thead th {
  text-align: center;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #777;
  padding: 12px 16px;
  border-bottom: 1px solid #2a2a2a;
}
.th-platform {
  text-align: left;
  vertical-align: bottom;
}
.group-header {
  border-bottom: none;
  padding-bottom: 4px;
  font-size: 10px;
  color: #888;
}
.sub-th {
  padding-top: 4px;
  font-size: 10.5px;
  color: #777;
}
.border-left {
  border-left: 1px solid #2a2a2a;
}
tbody td {
  padding: 12px 16px;
  color: #aaa;
  font-weight: 500;
  font-size: 14px;
  border-bottom: 1px solid #1e1e1e;
}
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover td { background: #141414; color: #ccc; }
.sep-row td {
  padding: 2px 0;
  background: transparent !important;
  border-bottom: 1px solid #252525;
}
td.center { text-align: center; }
.check {
  font-size: 15px;
  font-weight: 700;
  color: #c9a860;
}

/* ── How it works ── */
.how-section {
  padding: 80px 0 100px;
  border-top: 1px solid #1a1a1a;
}
.how-desc {
  font-size: 14px;
  font-weight: 500;
  color: #aaa;
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
