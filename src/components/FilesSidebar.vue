<script setup lang="ts">
import {
  sftpStore,
  activate,
  connOf,
  connect,
  disconnect,
  removeProfile,
  type SftpProfile,
} from "../sftp";
import Icon from "./Icon.vue";

function isActive(profile: SftpProfile) {
  return connOf(profile.id)?.id === sftpStore.activeId && sftpStore.activeId !== 0;
}

function pick(profile: SftpProfile) {
  if (sftpStore.connectingId === profile.id) return;
  const conn = connOf(profile.id);
  if (conn) {
    activate(conn.id);
    return;
  }
  // 存过密码或用私钥的，点一下直接连，不必再走一遍表单
  if (profile.password || profile.keyPath) {
    void connect(profile);
    return;
  }
  // 没凭据：把配置丢给主区表单，补密码
  sftpStore.draft = profile;
  sftpStore.activeId = 0;
}

function newConnection() {
  sftpStore.draft = {
    id: `sftp-${Date.now()}`,
    name: "",
    host: "",
    port: 22,
    user: "",
    keyPath: "",
    password: "",
  };
  sftpStore.activeId = 0;
}

function drop(profile: SftpProfile, event: MouseEvent) {
  event.stopPropagation();
  const conn = connOf(profile.id);
  if (conn) void disconnect(conn.id);
  removeProfile(profile.id);
}
</script>

<template>
  <aside class="sidebar" aria-label="文件连接">
    <div class="rail-head">
      <span class="mp-title">文件</span>
      <span class="rail-head-spacer" />
      <button class="tool-btn" title="新建 SFTP 连接" aria-label="新建连接" @click="newConnection">
        <Icon name="plus" :size="15" />
      </button>
    </div>

    <div class="term-list">
      <div
        v-for="profile in sftpStore.profiles"
        :key="profile.id"
        class="term-row"
        :class="{ on: isActive(profile) }"
        role="button"
        tabindex="0"
        :data-profile-id="profile.id"
        :title="`${profile.user}@${profile.host}:${profile.port} · 点击连接`"
        @click="pick(profile)"
        @keydown.enter="pick(profile)"
      >
        <span class="term-dot" :class="{ dead: !connOf(profile.id) }" />
        <span class="term-row-name">{{ profile.name }}</span>
        <span class="sftp-host">
          {{ sftpStore.connectingId === profile.id ? "连接中…" : profile.host }}
        </span>
        <span class="term-x" role="button" aria-label="删除连接" @click="drop(profile, $event)">
          <Icon name="close" :size="11" />
        </span>
      </div>

      <div v-if="!sftpStore.profiles.length" class="mp-body">
        <Icon name="server" :size="20" />
        <p>还没有远程连接</p>
        <span>填一个主机地址，连上后可以浏览目录、下载文件。</span>
        <button class="term-cta" @click="newConnection">新建连接</button>
      </div>
    </div>

    <div class="rail-footer">{{ sftpStore.conns.length }} 个已连接</div>
  </aside>
</template>
