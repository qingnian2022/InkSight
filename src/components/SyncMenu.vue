<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { confirm } from "@tauri-apps/plugin-dialog";
import Icon from "./Icon.vue";
import {
  isTauri,
  lastSyncRemote,
  refreshSyncStatus,
  setSyncAuto,
  state,
  syncAbort,
  syncNow,
  syncResetRemote,
  syncSetup,
} from "../store";

/**
 * 标题栏「同步」控件：pill 按钮 + 下拉面板。
 * - 状态点常亮指示当前同步状态（灰未配置 / 绿已同步 / 橙待同步 / 红冲突出错 / 蓝同步中）
 * - 面板里完成远程配置、立即同步、自动同步开关、冲突处理
 * - 面板用 position:fixed 定位在 pill 下方（视口坐标），避免被任何 overflow 裁剪
 */

const open = ref(false);
const remoteInput = ref("");
const wrapEl = ref<HTMLElement | null>(null);
const menuPos = ref({ top: 0, right: 0 });

const st = computed(() => state.syncStatus);

type Tone = "gray" | "green" | "amber" | "red" | "blue";
const tone = computed<Tone>(() => {
  if (state.syncBusy) return "blue";
  const s = st.value;
  if (!s || !s.installed) return "gray";
  if (s.conflicted || state.syncError) return "red";
  if (!s.initialized || !s.hasRemote) return "gray";
  if (s.dirty || s.ahead > 0) return "amber";
  return "green";
});

const label = computed(() => {
  if (state.syncBusy) return "同步中";
  const s = st.value;
  if (!s) return "同步";
  if (!s.installed) return "未检测到 git";
  if (s.conflicted) return "同步冲突";
  if (state.syncError) return "同步出错";
  if (!s.initialized) return "未配置同步";
  if (!s.hasRemote) return "未连接远程";
  if (s.dirty || s.ahead > 0) return "待同步";
  return "已同步";
});

const sub = computed(() => {
  const s = st.value;
  if (s?.conflicted) return "两台机器改动了同一篇文档，请在下方选择处理方式";
  if (state.syncMessage) return state.syncMessage;
  if (s?.behind) return `云端有 ${s.behind} 个新提交待拉取`;
  return "";
});

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
  const ok = await confirm("用云端版本覆盖本地？未同步的本地修改会丢失。", {
    title: "用云端覆盖本地",
    kind: "warning",
    okLabel: "覆盖",
    cancelLabel: "取消",
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
      :title="isTauri ? 'git 同步：多台机器共用一个仓库互相同步' : '同步功能仅桌面版可用'"
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
      <div v-if="sub" class="sync-sub" :class="{ 'sync-sub-err': state.syncError || st?.conflicted }">
        {{ sub }}
      </div>

      <div class="sync-actions">
        <button
          class="sync-btn"
          :disabled="state.syncBusy || !st?.hasRemote"
          @click="syncNow()"
        >
          立即同步
        </button>
        <span class="sync-auto-label">自动同步</span>
        <button
          class="sync-auto"
          :class="{ on: state.syncAuto }"
          :disabled="!st?.hasRemote"
          :aria-pressed="state.syncAuto"
          title="开启后：写盘约 5 秒后自动提交并推送"
          @click="setSyncAuto(!state.syncAuto)"
        >
          <span class="sync-auto-knob" />
        </button>
      </div>

      <div class="sync-remote">
        <input
          v-model="remoteInput"
          class="sync-input"
          spellcheck="false"
          placeholder="远程仓库地址，如 https://gitee.com/用户名/notes.git"
          @keydown.enter="connect"
        />
        <button class="sync-btn ghost" :disabled="state.syncBusy || !remoteInput.trim()" @click="connect">
          {{ st?.hasRemote ? "更换" : "连接" }}
        </button>
      </div>
      <div class="sync-hint">
        首次连接会自动初始化仓库并推送当前全部笔记；新设备填同一地址即可拉取云端内容。.trash
        回收站不参与同步。
      </div>

      <div v-if="st?.conflicted" class="sync-conflict">
        <button class="sync-btn ghost" @click="syncAbort">放弃本次同步</button>
        <button class="sync-btn danger" @click="resetRemote">用云端覆盖本地…</button>
      </div>
    </div>
  </div>
</template>
