<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import {
  ACCENT_THEMES,
  accentSwatch,
  openAccountDialog,
  setAccent,
  setSkin,
  setTheme,
  state,
  type Skin,
} from "../store";
import { closeSettings, setFeature, settingsStore, type FeatureKey } from "../settings";
import Icon from "./Icon.vue";
import SyncMenu from "./SyncMenu.vue";

/**
 * 设置：功能开放 / 同步 / 账号。
 * 标题栏只留一个齿轮入口，同步与账号都收进这里，chrome 不再被两个 popover 占位。
 */
const FEATURES: { key: FeatureKey; label: string; desc: string }[] = [
  { key: "files", label: "文件 / SFTP", desc: "本地与远程文件管理，可拖拽下载" },
  { key: "terminal", label: "终端", desc: "内置 PowerShell 会话" },
  { key: "search", label: "搜索", desc: "跨工作区搜索（尚未接入）" },
];

const SKINS: { key: Skin; label: string }[] = [
  { key: "macos", label: "macOS" },
  { key: "default", label: "经典" },
];

function onKey(event: KeyboardEvent) {
  // 账号弹窗叠在设置之上，它开着时 Esc 只关它自己
  if (event.key !== "Escape" || !settingsStore.open || state.accountOpen) return;
  event.preventDefault();
  closeSettings();
}

/** 账号弹窗层级已抬到设置之上（4600 > 4500），可以叠着打开，关掉后回到设置 */
function manageAccount() {
  openAccountDialog();
}

onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <div v-if="settingsStore.open" class="settings-mask" @pointerdown.self="closeSettings">
    <div class="settings-card" role="dialog" aria-modal="true" aria-label="设置">
      <header class="settings-head">
        <span class="settings-title">设置</span>
        <button class="tool-btn" title="关闭" aria-label="关闭设置" @click="closeSettings">
          <Icon name="close" :size="14" />
        </button>
      </header>

      <section class="settings-sec">
        <h3>外观</h3>

        <div class="settings-row">
          <div class="settings-row-text">
            <span>颜色深浅</span>
            <small>浅色 / 深色，作用于整个界面</small>
          </div>
          <div class="settings-seg">
            <button :class="{ on: state.theme === 'light' }" @click="setTheme('light')">浅色</button>
            <button :class="{ on: state.theme === 'dark' }" @click="setTheme('dark')">深色</button>
          </div>
        </div>

        <div class="settings-row">
          <div class="settings-row-text">
            <span>主题色</span>
            <small>只换主色，中性层自动派生</small>
          </div>
          <div class="settings-dots">
            <button
              v-for="theme in ACCENT_THEMES"
              :key="theme.key"
              class="settings-dot"
              :class="{ on: state.accent === theme.key }"
              :style="{ background: accentSwatch(theme.key) }"
              :title="theme.label"
              :aria-label="`主题色：${theme.label}`"
              @click="setAccent(theme.key)"
            />
          </div>
        </div>

        <div class="settings-row">
          <div class="settings-row-text">
            <span>界面风格</span>
            <small>一体式窗口 / 经典卡片</small>
          </div>
          <div class="settings-seg">
            <button
              v-for="skin in SKINS"
              :key="skin.key"
              :class="{ on: state.skin === skin.key }"
              @click="setSkin(skin.key)"
            >
              {{ skin.label }}
            </button>
          </div>
        </div>
      </section>

      <section class="settings-sec">
        <h3>功能开放</h3>
        <p class="settings-hint">
          关闭的模块不会出现在左侧活动栏；只留笔记时，活动栏整条隐藏。
        </p>

        <div v-for="item in FEATURES" :key="item.key" class="settings-row">
          <div class="settings-row-text">
            <span>{{ item.label }}</span>
            <small>{{ item.desc }}</small>
          </div>
          <button
            class="set-switch"
            :class="{ on: settingsStore.features[item.key] }"
            role="switch"
            :aria-checked="settingsStore.features[item.key]"
            :aria-label="item.label"
            @click="setFeature(item.key, !settingsStore.features[item.key])"
          >
            <span />
          </button>
        </div>

        <div class="settings-row static">
          <div class="settings-row-text">
            <span>笔记</span>
            <small>始终开启</small>
          </div>
          <span class="settings-tag">默认</span>
        </div>
      </section>

      <section class="settings-sec">
        <h3>同步</h3>
        <SyncMenu inline />
      </section>

      <section class="settings-sec">
        <h3>账号</h3>
        <div class="settings-row static">
          <div class="settings-row-text">
            <span>{{ state.serverToken ? state.serverUsername || state.serverEmail : "未登录" }}</span>
            <small>{{ state.serverToken ? "已登录，服务器同步可用" : "登录后可用服务器同步" }}</small>
          </div>
          <button class="settings-btn" @click="manageAccount">管理账号…</button>
        </div>
      </section>
    </div>
  </div>
</template>
