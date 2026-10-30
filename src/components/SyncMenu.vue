<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { openConfirm } from "../ui/confirmPrompt";
import Icon from "./Icon.vue";
import {
  isTauri,
  lastSyncRemote,
  refreshSyncStatus,
  setSyncAuto,
  state,
  syncAbort,
  syncFromRemote,
  serverConfigured,
  setSyncMode,
  syncAll,
  syncResetRemote,
  syncSetup,
  syncToRemote,
} from "../store";

/**
 * 标题栏「同步」控件：pill 按钮 + 下拉面板。
 * - 状态点常亮指示当前同步状态（灰未配置 / 绿已同步 / 橙待同步 / 红冲突出错 / 蓝同步中）
 * - 面板里完成远程配置、立即同步、自动同步开关、冲突处理
 * - 面板用 position:fixed 定位在 pill 下方（视口坐标），避免被任何 overflow 裁剪
 */

const open = ref(false);
const editingRemote = ref(false);
const remoteInput = ref("");
const st = computed(() => state.syncStatus);
const wrapEl = ref<HTMLElement | null>(null);
const menuPos = ref({ top: 0, right: 0 });

type Tone = "gray" | "green" | "amber" | "red" | "blue";

const gitEnabled = computed(() => state.syncMode !== "server");
const serverEnabled = computed(() => state.syncMode !== "git");

const tone = computed<Tone>(() => {
  if (state.syncBusy) return "blue";
  if (serverEnabled.value && !serverConfigured()) return "gray";
  const s = st.value;
  if (!gitEnabled.value) return state.syncError ? "red" : "green";
  if (!s || !s.installed) return "gray";
  if (s.conflicted || state.syncError) return "red";
  if (!s.initialized || !s.hasRemote) return "gray";
  if (s.dirty || s.ahead > 0) return "amber";
  return "green";
});

const label = computed(() => {
  if (state.syncBusy) return "同步中";
  if (state.syncError) return "同步出错";
  if (serverEnabled.value && !serverConfigured()) return state.serverUrl ? "未登录" : "未配置服务器";
  const s = st.value;
  if (!gitEnabled.value) return "服务器同步";
  if (!s) return "同步";
  if (!s.installed) return "未检测到 git";
  if (s.conflicted) return "同步冲突";
  if (!s.initialized) return "未配置同步";
  if (!s.hasRemote) return "未连接远程";
  if (s.dirty || s.ahead > 0) return "待同步";
  return "已同步";
});

const remoteHost = computed(() => {
  const raw = st.value?.remote || "";
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return `${url.host}${url.pathname.replace(/\.git$/, "").replace(/\/$/, "")}`;
  } catch {
    const ssh = raw.match(/^git@([^:]+):(.+)$/);
    return ssh ? `${ssh[1]}/${ssh[2].replace(/\.git$/, "")}` : raw;
  }
});

const modeOptions = [
  { key: "git" as const, label: "Git" },
  { key: "server" as const, label: "服务器" },
  { key: "both" as const, label: "同时" },
];

function relTime(ts: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

const lastLine = computed(() => {
  const parts: string[] = [];
  const t = relTime(state.syncAt);
  if (t) parts.push(`上次同步 ${t}`);
  const s = st.value;
  if (s?.branch) parts.push(s.branch);
  if (s?.ahead) parts.push(`待推送 ${s.ahead}`);
  return parts.join(" · ");
});

async function toggle() {
  open.value = !open.value;
  if (open.value) {
    editingRemote.value = false;
    remoteInput.value = lastSyncRemote();
    void refreshSyncStatus();
    await nextTick();
    const rect = wrapEl.value?.getBoundingClientRect();
    if (rect) {
      menuPos.value = {
        top: Math.round(rect.bottom + 8),
        right: Math.round(window.innerWidth - rect.right),
      };
    }
  }
}

function onDocPointerDown(e: PointerEvent) {
  if (!open.value) return;
  const target = e.target as Node;
  if (wrapEl.value?.contains(target)) return;
  open.value = false;
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") open.value = false;
}

async function connect() {
  const url = remoteInput.value.trim();
  if (!url) return;
  await syncSetup(url);
}

async function resetRemote() {
  const ok = await openConfirm({
    title: "用云端覆盖本地",
    message: "用云端版本覆盖本地？",
    detail: "未同步的本地修改会丢失。",
    okText: "覆盖",
    danger: true,
  });
  if (ok) await syncResetRemote();
}

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div ref="wrapEl" class="sync-wrap">
    <button
      class="sync-pill"
      :title="isTauri ? '同步方式可切换：Git / 自建服务器 / 两者同时' : '同步功能仅桌面版可用'"
      @click="toggle"
    >
      <Icon name="refresh" :size="12" :class="{ 'sync-spin': state.syncBusy }" />
      <span>同步</span>
      <span class="sync-dot" :class="tone" />
    </button>

    <div
      v-if="open"
      class="sync-menu"
      :style="{ top: `${menuPos.top}px`, right: `${menuPos.right}px` }"
    >
      <div class="sync-status">
        <span class="sync-dot" :class="tone" />
        <span class="sync-status-label">{{ label }}</span>
        <span v-if="lastLine" class="sync-status-meta">{{ lastLine }}</span>
      </div>

      <div class="sync-mode" role="group" aria-label="同步方式">
        <button
          v-for="m in modeOptions"
          :key="m.key"
          class="sync-mode-btn"
          :class="{ active: state.syncMode === m.key }"
          :aria-pressed="state.syncMode === m.key"
          @click="setSyncMode(m.key)"
        >
          {{ m.label }}
        </button>
      </div>

      <div class="sync-primary-row">
        <button class="sync-primary" :disabled="state.syncBusy" @click="syncAll()">
          {{ state.syncBusy ? "同步中…" : "立即同步" }}
        </button>
        <button
          v-if="gitEnabled"
          class="sync-auto"
          :class="{ on: state.syncAuto }"
          :disabled="!st?.hasRemote"
          :aria-pressed="state.syncAuto"
          aria-label="自动同步"
          title="自动同步：写盘约 5 秒后提交并推送"
          @click="setSyncAuto(!state.syncAuto)"
        >
          <span class="sync-auto-knob" />
        </button>
      </div>

      <template v-if="gitEnabled">
        <div v-if="st?.hasRemote && !editingRemote" class="sync-remote-line">
          <span class="sync-remote-host" :title="st.remote">{{ remoteHost }}</span>
          <button class="sync-link" @click="editingRemote = true">更换</button>
        </div>
        <div v-if="!st?.hasRemote || editingRemote" class="sync-remote">
          <input
            v-model="remoteInput"
            class="sync-input"
            spellcheck="false"
            placeholder="仓库地址（gitee / github）"
            @keydown.enter="connect"
          />
          <button class="sync-btn ghost" :disabled="state.syncBusy || !remoteInput.trim()" @click="connect">
            连接
          </button>
        </div>

        <div class="sync-pair">
          <button
            class="sync-btn ghost"
            :disabled="state.syncBusy || !st?.hasRemote"
            title="拉取云端内容覆盖本地"
            @click="syncFromRemote()"
          >
            ⬇ 用云端
          </button>
          <button
            class="sync-btn ghost"
            :disabled="state.syncBusy || !st?.hasRemote"
            title="推送本地内容覆盖云端"
            @click="syncToRemote()"
          >
            ⬆ 用本地
          </button>
        </div>

        <div v-if="st?.conflicted" class="sync-conflict">
          <span class="sync-warn">有冲突</span>
          <button class="sync-link" @click="syncAbort">放弃</button>
          <button class="sync-link danger" @click="resetRemote">用云端覆盖</button>
        </div>
      </template>

      <div v-if="serverEnabled" class="sync-line">
        <span class="sync-line-dot" :class="{ ok: !!state.serverToken }" />
        <span>{{ state.serverToken ? state.serverUsername || state.serverEmail : "未登录 · 点击头像登录" }}</span>
      </div>
    </div>
  </div>
</template>
