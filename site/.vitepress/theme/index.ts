import DefaultTheme from 'vitepress/theme'
import Home from './Home.vue'
import './custom.css'
import { h } from 'vue'

export default {
  ...DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {})
  },
  enhanceApp({ app }) {
    app.component('Home', Home)
  },
}
