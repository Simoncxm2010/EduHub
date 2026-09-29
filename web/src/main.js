import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Vant from 'vant';
import 'vant/lib/index.css';
import App from './App.vue';
import router from './router';
import { initTheme } from './composables/theme';
import './styles.css';

// 挂载前先应用主题，避免暗色用户看到白屏闪烁
initTheme();

createApp(App).use(createPinia()).use(router).use(Vant).mount('#app');
