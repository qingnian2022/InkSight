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
  pullFromServer,
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
/** inline = 嵌进设置页时用：不渲染 pill，面板常开且去掉浮层定位 */
const props = defineProps<{ inline?: boolean }>();
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
  {
    key: "git" as const,
    label: "Git",
    icon: "git-branch",
    hint: "Git：同步到代码仓库，多台机器共用一份",
  },
  {
    key: "server" as const,
    label: "服务器",
    icon: "server",
    hint: "服务器：登录账号后同步到自建服务",
  },
  {
    key: "both" as const,
    label: "同时",
    icon: "swap",
    hint: "同时：两条通道都执行",
  },
];

function relTime(ts: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

/** 状态行右侧的紧凑信息：时间 · 分支（「上次同步」「待推送」这类前缀词一律省掉） */
const lastLine = computed(() => {
  const parts: string[] = [];
  const t = relTime(state.syncAt);
  if (t) parts.push(t);
  const s = st.value;
  if (s?.branch) parts.push(s.branch);
  return parts.join(" · ");
});

/** 待推送提交数单独成项，配 ↑ 图标，不混进上一条文字里 */
const aheadCount = computed(() => st.value?.ahead ?? 0);

/** 身份行：优先显示 Git 远程，其次服务器账号 */
const accountLabel = computed(() =>
  state.serverToken ? state.serverUsername || state.serverEmail : "未登录",
);
const avatarInitial = computed(() => {
  const raw = accountLabel.value.trim();
  return raw && raw !== "未登录" ? raw.charAt(0).toUpperCase() : "?";
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
  // 内联在设置页里时没有「打开」这个动作，挂载即刷新一次状态
  if (props.inline) void refreshSyncStatus();
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div ref="wrapEl" class="sync-wrap" :class="{ inline: props.inline }">
    <button
      v-if="!props.inline"
      class="sync-pill"
      :title="isTauri ? '同步方式可切换：Git / 自建服务器 / 两者同时' : '同步功能仅桌面版可用'"
      @click="toggle"
    >
      <Icon name="sync" :size="13" :class="{ 'sync-spin': state.syncBusy }" />
      <span>同步</span>
      <span class="sync-dot" :class="tone" />
    </button>

    <div
      v-if="props.inline || open"
      class="sync-menu"
      :class="{ inline: props.inline }"
      :style="props.inline ? undefined : { top: `${menuPos.top}px`, right: `${menuPos.right}px` }"
    >
      <div class="sync-status">
        <span class="sync-dot" :class="tone" />
        <span class="sync-status-label">{{ label }}</span>
        <span v-if="lastLine || aheadCount" class="sync-status-meta">
          <span v-if="lastLine">{{ lastLine }}</span>
          <span v-if="lastLine && aheadCount" class="sync-sep">·</span>
          <span v-if="aheadCount" class="sync-ahead">↑ {{ aheadCount }}</span>
        </span>
      </div>

      <div class="sync-mode" role="group" aria-label="同步方式">
        <button
          v-for="m in modeOptions"
          :key="m.key"
          class="sync-mode-btn"
          :class="{ active: state.syncMode === m.key }"
          :aria-pressed="state.syncMode === m.key"
          :title="m.hint"
          @click="setSyncMode(m.key)"
        >
          <Icon :name="m.icon" :size="12" />
          <span>{{ m.label }}</span>
        </button>
      </div>

      <div class="sync-primary-row">
        <!-- 手动同步：唯一会拉取合并（pull --rebase）的入口 -->
        <button
          class="sync-primary"
          :disabled="state.syncBusy || !!st?.conflicted"
          title="同步：提交并推送本地改动，会先拉取合并云端"
          @click="syncAll({ manual: true })"
        >
          <Icon name="sync" :size="14" :class="{ 'sync-spin': state.syncBusy }" />
          <span>{{ state.syncBusy ? "同步中" : "同步" }}</span>
        </button>

        <button
          v-if="serverEnabled"
          class="sync-icon-btn"
          :disabled="state.syncBusy || !state.serverToken"
          title="从服务器拉取：只下载，不覆盖本地改动"
          aria-label="从服务器拉取"
          @click="pullFromServer()"
        >
          <Icon name="cloud-down" :size="14" />
        </button>

        <button
          v-if="gitEnabled"
          class="sync-icon-btn"
          :disabled="state.syncBusy || !!st?.conflicted || !st?.hasRemote"
          title="用云端覆盖本地：未同步的本地改动会丢失"
          aria-label="用云端覆盖本地"
          @click="syncFromRemote()"
        >
          <Icon name="download" :size="14" />
        </button>

        <button
          v-if="gitEnabled"
          class="sync-icon-btn danger"
          :disabled="state.syncBusy || !!st?.conflicted || !st?.hasRemote"
          title="用本地覆盖云端：云端内容会被整份覆盖"
          aria-label="用本地覆盖云端"
          @click="syncToRemote()"
        >
          <Icon name="upload" :size="14" />
        </button>

        <button
          v-if="gitEnabled"
          class="sync-auto"
          :class="{ on: state.syncAuto }"
          :disabled="!st?.hasRemote"
          :aria-pressed="state.syncAuto"
          aria-label="自动同步"
          title="自动同步：写盘约 5 秒后提交并推送（只推不拉，拉取请点「同步」）"
          @click="setSyncAuto(!state.syncAuto)"
        >
          <span class="sync-auto-knob" />
        </button>
      </div>

      <div v-if="st?.conflicted" class="sync-conflict">
        <Icon name="alert" :size="14" class="sync-conflict-icon" />
        <span class="sync-conflict-text">两台机器改了同一篇</span>
        <button class="sync-ghost" @click="syncAbort">放弃</button>
        <button class="sync-ghost danger" @click="resetRemote">用云端</button>
      </div>

      <div class="sync-foot">
        <template v-if="gitEnabled && (!st?.hasRemote || editingRemote)">
          <input
            v-model="remoteInput"
            class="sync-input"
            spellcheck="false"
            placeholder="仓库地址（gitee / github）"
            @keydown.enter="connect"
          />
          <button
            class="sync-ghost"
            :disabled="state.syncBusy || !remoteInput.trim()"
            @click="connect"
          >
            连接
          </button>
        </template>

        <template v-else-if="gitEnabled">
          <Icon name="link" :size="12" class="sync-foot-icon" />
          <button class="sync-host" :title="`更换远程仓库：${st?.remote || ''}`" @click="editingRemote = true">
            {{ remoteHost }}
          </button>
        </template>

        <span v-else class="sync-host" :title="state.serverEmail">{{ accountLabel }}</span>

        <span
          v-if="serverEnabled"
          class="sync-avatar"
          :title="state.serverToken ? state.serverEmail : '未登录'"
        >{{ avatarInitial }}</span>
      </div>
    </div>
  </div>
</template>
