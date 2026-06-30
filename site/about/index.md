<script setup>
const team = [
  {
    name: 'Ali Najafi',
    title: 'PhD Student',
    affiliation: 'Sabanci University',
    avatar: 'https://unavatar.io/twitter/najafialiai',
    links: [
      { label: 'Website',        href: 'https://najafi-ali.com/' },
      { label: 'X',              href: 'https://x.com/najafialiai' },
      { label: 'Google Scholar', href: 'https://scholar.google.com/citations?user=c9QdS-sAAAAJ&hl=en&authuser=1' },
      { label: 'GitHub',         href: 'https://github.com/AliNajafi1998' },
    ],
  },
  {
    name: 'Ismail Uluturk',
    title: 'PhD',
    affiliation: 'University of South Florida',
    avatar: 'https://uluturki.github.io//images/bio_photo_3.jpg',
    links: [
      { label: 'Website', href: 'https://uluturki.github.io/' },
      { label: 'X',       href: 'https://x.com/strictlynofun' },
      { label: 'GitHub',  href: 'https://github.com/uluturki' },
    ],
  },
  {
    name: 'Onur Varol',
    title: 'Assistant Professor',
    affiliation: 'Sabanci University',
    avatar: 'https://unavatar.io/twitter/onurvarol',
    links: [
      { label: 'Website',        href: 'http://www.onurvarol.com/' },
      { label: 'X',              href: 'https://x.com/onurvarol' },
      { label: 'GitHub', href: 'https://github.com/onurvarol'},
      { label: 'Google Scholar', href: 'https://scholar.google.com/citations?user=t8YAefAAAAAJ' },
    ],
  },
]
</script>

# About

## Team

Social Annotate is developed by researchers at Sabanci University and the University of South Florida.

<div class="team-grid">
  <div class="person-card" v-for="p in team" :key="p.name">
    <img :src="p.avatar" :alt="p.name" class="person-avatar" />
    <div class="person-name">{{ p.name }}</div>
    <div class="person-title">{{ p.title }}</div>
    <div class="person-affil">{{ p.affiliation }}</div>
    <div class="person-links">
      <a v-for="l in p.links" :key="l.label" :href="l.href" target="_blank" class="person-link">{{ l.label }}</a>
    </div>
  </div>
</div>

Issues and pull requests are welcome. For questions, open a [GitHub issue](https://github.com/ViralLab/social-annotate/issues).

---

## Citation

If you use Social Annotate in your research, please cite:

```bibtex
@article{najafi2026socialannotate,
  title   = {Social-Annotate: Self-Healing Browser Extension to Annotate and Collect Social Media Data},
  author  = {Najafi, Ali and Varol, Onur and Uluturk, Ismail},
  journal = {Journal of Open Source Software},
  volume  = {X},
  number  = {XX},
  pages   = {XXXX},
  year    = {2026}
}
```

---

## License

Social Annotate is released under the [GPL-3.0 License](https://github.com/ViralLab/social-annotate/blob/master/LICENSE).

<style scoped>
:deep(.vp-doc p),
:deep(.vp-doc li) {
  color: #ccc;
  font-weight: 400;
}
.team-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 24px;
  margin: 32px 0 40px;
}
.person-card {
  background: #111;
  border: 1px solid #1e1e1e;
  border-radius: 10px;
  padding: 28px 20px 22px;
  text-align: center;
  transition: border-color 0.15s;
}
.person-card:hover {
  border-color: #2e2e2e;
}
.person-avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  object-fit: cover;
  margin: 0 auto 16px;
  display: block;
  border: 2px solid #1e1e1e;
}
.person-name {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 17px;
  font-weight: 700;
  color: #e8e0d0;
  margin-bottom: 6px;
}
.person-title {
  font-size: 12.5px;
  font-weight: 500;
  color: #c9a860;
  margin-bottom: 3px;
}
.person-affil {
  font-size: 12px;
  color: #aaa;
  margin-bottom: 16px;
}
.person-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}
.person-link {
  font-size: 11.5px;
  font-weight: 500;
  color: #bbb;
  text-decoration: none;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 3px 9px;
  transition: color 0.15s, border-color 0.15s;
}
.person-link:hover {
  color: #c9a860;
  border-color: #c9a860;
}
</style>
