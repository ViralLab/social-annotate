<template>
  <div class="home-page">

    <!-- ── Hero ── -->
    <section class="hero">
      <canvas ref="netCanvas" class="net-canvas"></canvas>
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

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const netCanvas = ref(null)
let netRaf = 0

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

  // ── Network background animation ──
  const canvas = netCanvas.value as HTMLCanvasElement | null
  if (!canvas) return
  const ctx = canvas.getContext('2d')!
  const MAX_SPEED = 0.9

  // Cluster anchors as fractions [fx, fy] — corners + sides, away from center
  const ANCHORS = [
    [0.18, 0.28], [0.82, 0.28],  // flanking text — upper left/right
    [0.18, 0.68], [0.82, 0.68],  // flanking text — lower left/right
    [0.50, 0.08], [0.50, 0.90],  // top and bottom center
  ]

  type NodeType = 'hub' | 'account' | 'post'
  type Node = { x: number; y: number; vx: number; vy: number; type: NodeType; cluster: number }
  let W = 0, H = 0, nodes: Node[] = []

  function resize() {
    W = canvas.width = canvas.offsetWidth
    H = canvas.height = canvas.offsetHeight
  }

  function spawnCluster(ai: number): Node[] {
    const [fx, fy] = ANCHORS[ai]
    const mobile = W < 640
    const accounts = 1 + Math.floor(Math.random() * (mobile ? 2 : 5))  // mobile: 1–2, desktop: 1–5
    const posts    = 1 + Math.floor(Math.random() * (mobile ? 2 : 5))  // mobile: 1–2, desktop: 1–5
    const spread   = mobile ? 30 + Math.random() * 30 : 50 + Math.random() * 70
    const types: NodeType[] = ['hub',
      ...Array(accounts).fill('account') as NodeType[],
      ...Array(posts).fill('post') as NodeType[],
    ]
    return types.map(t => ({
      x: fx * W + (Math.random() - 0.5) * spread,
      y: fy * H + (Math.random() - 0.5) * spread,
      vx: (Math.random() - 0.5) * 0.7,
      vy: (Math.random() - 0.5) * 0.7,
      type: t,
      cluster: ai,
    }))
  }

  // Bridge nodes that drift between clusters
  function mkBridge(): Node {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      type: Math.random() > 0.5 ? 'account' : 'post',
      cluster: -1,
    }
  }

  // ── Annotation events ──
  const ANNOT_COLORS = ['210,50,50', '60,190,80']
  type AnnotEvent = { ni: number; age: number; col: string }
  const ANNOT_LIFE = 200
  let annotEvents: AnnotEvent[] = []
  let annotCooldown = 80

  function drawAnnotation(node: Node, t: number, alpha: number, col: string) {
    const baseR = node.type === 'hub' ? 13 : node.type === 'account' ? 7 : 0
    const ringR = baseR + 7 + Math.max(0, (0.12 - t) / 0.12) * 14
    ctx.beginPath(); ctx.arc(node.x, node.y, ringR, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(${col},${alpha * 0.85})`; ctx.lineWidth = 1.3; ctx.stroke()

    if (t > 0.14) {
      const cardAlpha = alpha * Math.min((t - 0.14) / 0.08, 1)
      const offX = node.x > W * 0.72 ? -60 : 18
      const cw = 54, ch = 30
      const bx = node.x + offX, by = node.y - ch / 2
      ctx.beginPath(); ctx.roundRect(bx, by, cw, ch, 3)
      ctx.fillStyle = `rgba(14,12,8,${cardAlpha * 0.93})`; ctx.fill()
      ctx.strokeStyle = `rgba(${col},${cardAlpha * 0.45})`; ctx.lineWidth = 0.8; ctx.stroke()

      // 3 lines fill left-to-right, one at a time
      const fillT = Math.max(0, t - 0.2) / 0.52
      const pad = 5
      const maxWs = [cw - pad * 2, cw - pad * 2 - 10, cw - pad * 2 - 18]
      for (let l = 0; l < 3; l++) {
        const lt = Math.max(0, Math.min(1, fillT * 3 - l))
        ctx.fillStyle = `rgba(${col},${cardAlpha * (0.55 - l * 0.07)})`
        ctx.fillRect(bx + pad, by + pad + l * 7, lt * maxWs[l], 1.6)
      }

      // Tiny checkmark after fill
      if (fillT > 0.92) {
        const ck = Math.min((fillT - 0.92) / 0.08, 1)
        ctx.strokeStyle = `rgba(${col},${cardAlpha * ck})`; ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(bx + cw - 13, by + ch / 2 - 1)
        ctx.lineTo(bx + cw - 9,  by + ch / 2 + 3)
        ctx.lineTo(bx + cw - 4,  by + ch / 2 - 5)
        ctx.stroke()
      }
    }
  }

  function drawAvatarIcon(x: number, y: number, r: number, col: string, alpha: number) {
    // circle frame clipped, head dot + shoulder arc inside
    ctx.save()
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.clip()
    const headR = r * 0.33, headY = y - r * 0.22
    const shoulderR = r * 0.58, shoulderY = y + r * 0.72
    ctx.fillStyle = `rgba(${col},${alpha})`
    ctx.beginPath(); ctx.arc(x, headY, headR, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(x, shoulderY, shoulderR, Math.PI, 0, true); ctx.closePath(); ctx.fill()
    ctx.restore()
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(${col},${alpha * 0.85})`; ctx.lineWidth = 1.2; ctx.stroke()
  }

  function drawHub(x: number, y: number, litCol: string | null) {
    const col = litCol ?? '201,168,96'
    const g = ctx.createRadialGradient(x, y, 0, x, y, 24)
    g.addColorStop(0, `rgba(${col},0.18)`)
    g.addColorStop(1, `rgba(${col},0)`)
    ctx.beginPath(); ctx.arc(x, y, 24, 0, Math.PI * 2)
    ctx.fillStyle = g; ctx.fill()
    drawAvatarIcon(x, y, 13, col, litCol ? 0.95 : 0.8)
  }

  function drawAccount(x: number, y: number, litCol: string | null) {
    const col = litCol ?? '201,168,96'
    drawAvatarIcon(x, y, 7, col, litCol ? 0.92 : 0.6)
  }

  function drawPost(x: number, y: number, litCol: string | null) {
    const col = litCol ?? '201,168,96'
    const w = 30, h = 18
    const lx = x - w / 2, ty = y - h / 2
    ctx.beginPath(); ctx.roundRect(lx, ty, w, h, 3)
    ctx.fillStyle = litCol ? 'rgba(14,10,10,0.92)' : 'rgba(18,18,18,0.8)'; ctx.fill()
    ctx.strokeStyle = `rgba(${col},${litCol ? 0.7 : 0.3})`
    ctx.lineWidth = litCol ? 1.1 : 0.8; ctx.stroke()
    ctx.fillStyle = `rgba(${col},${litCol ? 0.5 : 0.32})`
    ctx.fillRect(lx + 4, ty + 5, w - 10, 1.8)
    ctx.fillRect(lx + 4, ty + 10, w - 16, 1.8)
  }

  function draw() {
    ctx.clearRect(0, 0, W, H)
    const cx = W / 2, cy = H * 0.44
    // Elliptical avoid zone — just the text character area, not a large buffer
    const avoidRx = W * 0.17, avoidRy = H * 0.22

    // Edges: same-cluster connects farther, cross-cluster needs to be close
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const sameCluster = nodes[i].cluster >= 0 && nodes[i].cluster === nodes[j].cluster
        const limit = sameCluster ? 160 : 90
        const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d < limit) {
          const alpha = (1 - d / limit) * (sameCluster ? 0.28 : 0.18)
          ctx.beginPath()
          ctx.moveTo(nodes[i].x, nodes[i].y)
          ctx.lineTo(nodes[j].x, nodes[j].y)
          ctx.strokeStyle = `rgba(201,168,96,${alpha})`
          ctx.lineWidth = sameCluster ? 0.8 : 0.5
          ctx.stroke()
        }
      }
    }

    // Node-to-node repulsion — prevent overlap
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x
        const dy = nodes[i].y - nodes[j].y
        const d = Math.sqrt(dx * dx + dy * dy)
        const minDist = 40
        if (d < minDist && d > 0) {
          const force = (minDist - d) / minDist * 0.25
          nodes[i].vx += (dx / d) * force
          nodes[i].vy += (dy / d) * force
          nodes[j].vx -= (dx / d) * force
          nodes[j].vy -= (dy / d) * force
        }
      }
    }

    // Nodes + physics
    const litMap = new Map(annotEvents.map(e => [e.ni, e.col]))
    nodes.forEach((n, ni) => {
      const litCol = litMap.get(ni) ?? null
      if (n.type === 'hub') drawHub(n.x, n.y, litCol)
      else if (n.type === 'account') drawAccount(n.x, n.y, litCol)
      else drawPost(n.x, n.y, litCol)

      // Cluster gravity
      if (n.cluster >= 0) {
        const [fx, fy] = ANCHORS[n.cluster]
        n.vx += (fx * W - n.x) * 0.00012
        n.vy += (fy * H - n.y) * 0.00012
      }

      // Repel from center (elliptical)
      const dx = n.x - cx, dy = n.y - cy
      const d = Math.sqrt(dx * dx + dy * dy)
      const ellD = Math.sqrt((dx / avoidRx) ** 2 + (dy / avoidRy) ** 2)
      if (ellD < 1 && d > 0) { n.vx += (dx / d) * 0.05; n.vy += (dy / d) * 0.05 }

      // Speed clamp
      const spd = Math.sqrt(n.vx * n.vx + n.vy * n.vy)
      if (spd > MAX_SPEED) { n.vx = n.vx / spd * MAX_SPEED; n.vy = n.vy / spd * MAX_SPEED }

      n.x += n.vx; n.y += n.vy
      if (n.x < 0 || n.x > W) n.vx *= -1
      if (n.y < 0 || n.y > H) n.vy *= -1
    })

    // Draw annotation overlays on top
    annotEvents.forEach(ev => {
      const t = ev.age / ANNOT_LIFE
      const alpha = t < 0.12 ? t / 0.12 : t > 0.82 ? (1 - t) / 0.18 : 1
      drawAnnotation(nodes[ev.ni], t, alpha, ev.col)
      ev.age++
    })
    annotEvents = annotEvents.filter(ev => ev.age < ANNOT_LIFE)

    // Spawn next annotation
    if (--annotCooldown <= 0) {
      const candidates = nodes.map((_, i) => i).filter(i => !litMap.has(i))
      if (candidates.length) {
        const col = ANNOT_COLORS[Math.floor(Math.random() * ANNOT_COLORS.length)]
        annotEvents.push({ ni: candidates[Math.floor(Math.random() * candidates.length)], age: 0, col })
      }
      annotCooldown = 90 + Math.floor(Math.random() * 60)
    }

    netRaf = requestAnimationFrame(draw)
  }

  resize()
  // On mobile use fewer clusters and no bridges to avoid crowding
  const mobile = W < 640
  const clusterIndices = mobile ? [0, 3, 4] : ANCHORS.map((_, i) => i)
  const bridgeCount = mobile ? 0 : 5
  nodes = clusterIndices.flatMap(i => spawnCluster(i)).concat(Array.from({ length: bridgeCount }, mkBridge))
  draw()
  window.addEventListener('resize', resize)
})

onUnmounted(() => {
  cancelAnimationFrame(netRaf)
  window.removeEventListener('resize', () => {})
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
  position: relative;
  padding: 110px 24px 80px;
  text-align: center;
  overflow: hidden;
}
.net-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}
.hero-inner {
  position: relative;
  z-index: 1;
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

/* ── Mobile ── */
@media (max-width: 768px) {
  /* Hero */
  .hero {
    padding: 72px 20px 56px;
  }
  .tagline {
    white-space: normal;
    animation: none;
    clip-path: none;
    font-size: 0.9rem;
  }
  .secondary-links {
    flex-wrap: wrap;
    gap: 8px;
  }

  /* Showcase */
  .showcase {
    padding: 64px 20px;
  }
  .showcase-row,
  .showcase--flip .showcase-row {
    flex-direction: column;
    gap: 32px;
  }
  .showcase-text {
    flex: none;
    text-align: center;
  }
  .showcase-label {
    text-align: center;
  }

  /* Features */
  .features-section {
    padding: 56px 0;
  }
  .feature-grid {
    grid-template-columns: 1fr 1fr;
  }

  /* Platforms */
  .platforms-section {
    padding: 56px 0;
  }
  .platforms-section h2,
  .features-section h2 {
    font-size: 1.5rem;
  }
}

@media (max-width: 480px) {
  .hero h1 {
    font-size: 2.6rem;
  }
  .feature-grid {
    grid-template-columns: 1fr;
  }
  .showcase-heading {
    font-size: 1.3rem;
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
