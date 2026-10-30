# inksight-sync

InkSight 的同步服务器（Rust + axum + SQLite）。邮箱密码注册/登录，按用户隔离笔记；带版本号写入避免覆盖。

## 运行

```bash
cd server
cargo run
# 或
docker compose -f ../docker-compose.sync.yml up -d --build
```

默认监听 `0.0.0.0:8787`，数据库 `data/sync.db`。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `SYNC_ADDR` | `0.0.0.0:8787` | 监听地址 |
| `SYNC_DB` | `data/sync.db` | SQLite 路径 |

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查，无需鉴权 |
| POST | `/auth/register` | body: `{email, password, username, avatar}`，返回 `{token, email, username, avatar}` |
| POST | `/auth/login` | 同上，校验密码 |
| POST | `/auth/logout` | 作废当前会话 |
| GET | `/auth/me` | 返回当前账号资料 |
| PATCH | `/auth/profile` | body: `{username, avatar}`，更新昵称与头像 |
| GET | `/sync?since=<ms>` | 返回该时间之后更新的笔记 + 新游标 |
| PUT | `/notes` | body: `{path, content, baseVersion}`；版本不符返回 409 + 服务端内容；命中墓碑则复活 |
| DELETE | `/notes?path=...` | 写墓碑（`deleted=1`、内容清空、版本 +1），其他设备拉取后把本地文件移到回收站 |

鉴权：`Authorization: Bearer <SYNC_TOKEN>`。

## 客户端配置

1. 打开「同步」面板 → 方式选 **服务器**（或 **同时**）
2. 填地址（如 `http://1.2.3.4:8787`）→ 保存
3. 点右上角头像 → 注册（可设用户名与头像）或登录
4. 点「立即同步」

首次同步会把本地全部 Markdown 推上去；之后只传 baseline 指纹变过的文件。

同步顺序与 git 一致：**先推送本地改动（含删除、改名）→ 再拉取远端增量**。

- 删除：本地删掉的文件会在服务端写墓碑，其他设备拉取后移到回收站
- 改名：识别为「新路径上传 + 旧路径墓碑」，其他设备表现为移动
- 冲突：两端同时改同一篇时，远端内容另存 `原名.server-时间.md`

## 已部署实例（2026-10-29）

| 项 | 值 |
|---|---|
| 实例 | `lhins-qkfjoate`（北京，2C2G，Ubuntu 24.04） |
| 公网地址 | `http://152.136.101.135:8787` |
| 进程 | systemd 服务 `inksight-sync`，开机自启 |
| 代码 | `/opt/inksight-sync`（Cargo.toml / src / Dockerfile） |
| 数据 | `/opt/inksight-sync/data/sync.db`（SQLite WAL） |
| 构建 | rustup stable 1.99 + rsproxy 稀疏索引，`cargo build --release` |
| 防火墙 | TCP 8787 对 `0.0.0.0/0` 放行 |

常用命令：

```bash
systemctl status inksight-sync
journalctl -u inksight-sync -n 50
systemctl restart inksight-sync
```

> 注意：Docker Hub 在本机网络不可达，镜像拉取失败，因此改用 systemd 直接跑二进制；后续如需容器化，需要先配 registry 镜像源。

## 已知限制

- 附件（图片）暂不同步，仅 Markdown
- SQLite 单文件，适合单人/小团队；多人高并发请换 Postgres
- 会话 30 天过期；登录失败 5 次后锁 10 分钟；暂无邮箱验证与找回密码
- 密码使用 Argon2 哈希，最低 6 位（生产环境建议提高要求）
- 头像支持 `#RRGGBB` 或 `data:image/...`（客户端压到 128×128 JPEG，服务端上限 200KB）
