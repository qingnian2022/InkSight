import { createApp } from "vue";
import "md-editor-v3/lib/style.css";
import "md-editor-v3/lib/preview.css";
import "@xterm/xterm/css/xterm.css";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/skin-macos.css";
import App from "./App.vue";
import { installBrowserLocks } from "./ui/browserLocks";

// 先关掉 WebView 自带的浏览器行为，再挂载应用
installBrowserLocks();

createApp(App).mount("#app");
