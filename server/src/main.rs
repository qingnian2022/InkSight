//! InkSight 同步服务器
//!
//! - 邮箱 + 密码注册 / 登录，签发会话令牌
//! - 增量拉取 / 带版本号写入（按用户隔离）
//! - SQLite 单文件存储；附件暂不支持

use std::{
    collections::HashMap,
    env,
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post, put},
    Json, Router,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_http::cors::CorsLayer;
use uuid::Uuid;

#[derive(Clone)]
struct App {
    db: Arc<Mutex<Connection>>,
    /// 登录失败计数：email -> (失败次数, 窗口起点)
    attempts: Arc<Mutex<HashMap<String, (u32, i64)>>>,
}

const SESSION_TTL_MS: i64 = 30 * 24 * 3600 * 1000;
const LOGIN_WINDOW_MS: i64 = 10 * 60 * 1000;
const LOGIN_MAX_FAILS: u32 = 5;

type ApiError = (StatusCode, Json<Value>);

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn err(code: StatusCode, message: &str) -> ApiError {
    (code, Json(json!({ "message": message })))
}

fn internal(e: impl std::fmt::Display) -> ApiError {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "message": e.to_string() })))
}

fn new_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

/// 从 Authorization 头解析会话，返回 user_id
fn auth_user(conn: &Connection, headers: &HeaderMap) -> Result<i64, ApiError> {
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|raw| raw.trim_start_matches("Bearer ").trim().to_string())
        .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "未登录"))?;

    let hit: Option<(i64, i64)> = conn
        .query_row(
            "SELECT user_id, expires_at FROM sessions WHERE token = ?1",
            params![token],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(internal)?;

    let Some((user_id, expires_at)) = hit else {
        return Err(err(StatusCode::UNAUTHORIZED, "会话已失效，请重新登录"));
    };
    if expires_at < now_ms() {
        let _ = conn.execute("DELETE FROM sessions WHERE token = ?1", params![token]);
        return Err(err(StatusCode::UNAUTHORIZED, "登录已过期，请重新登录"));
    }
    Ok(user_id)
}

#[derive(Deserialize)]
struct Credentials {
    email: String,
    password: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    avatar: String,
}

fn clean_username(raw: &str, email: &str) -> String {
    let name = raw.trim();
    if name.chars().count() >= 2 && name.chars().count() <= 20 {
        return name.to_string();
    }
    email.split('@').next().unwrap_or("用户").to_string()
}

fn clean_avatar(raw: &str) -> String {
    let value = raw.trim();
    if valid_avatar(value) {
        value.to_string()
    } else {
        "#7F77DD".to_string()
    }
}

fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

fn create_session(conn: &Connection, user_id: i64) -> Result<String, ApiError> {
    let token = new_token();
    let now = now_ms();
    conn.execute(
        "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
        params![token, user_id, now, now + SESSION_TTL_MS],
    )
    .map_err(internal)?;
    Ok(token)
}

fn valid_avatar(value: &str) -> bool {
    let v = value.trim();
    if v.is_empty() || v.len() > 200_000 {
        return false;
    }
    if let Some(hex) = v.strip_prefix('#') {
        return hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit());
    }
    v.starts_with("data:image/")
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "service": "inksight-sync" }))
}

async fn register(
    State(state): State<App>,
    Json(body): Json<Credentials>,
) -> Result<Json<Value>, ApiError> {
    let email = normalize_email(&body.email);
    if !email.contains('@') || email.len() < 5 {
        return Err(err(StatusCode::BAD_REQUEST, "邮箱格式不正确"));
    }
    if body.password.chars().count() < 6 {
        return Err(err(StatusCode::BAD_REQUEST, "密码至少 6 位"));
    }

    let username = clean_username(&body.username, &email);
    let avatar = clean_avatar(&body.avatar);

    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(body.password.as_bytes(), &salt)
        .map_err(internal)?
        .to_string();

    let conn = state.db.lock().map_err(internal)?;
    let inserted = conn.execute(
        "INSERT INTO users (email, password_hash, username, avatar, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![email, hash, username, avatar, now_ms()],
    );
    if let Err(rusqlite::Error::SqliteFailure(e, _)) = inserted {
        if e.code == rusqlite::ErrorCode::ConstraintViolation {
            return Err(err(StatusCode::CONFLICT, "该邮箱已注册"));
        }
        return Err(internal(e));
    }

    let user_id = conn.last_insert_rowid();
    let token = create_session(&conn, user_id)?;
    Ok(Json(json!({ "token": token, "email": email, "username": username, "avatar": avatar })))
}

async fn login(
    State(state): State<App>,
    Json(body): Json<Credentials>,
) -> Result<Json<Value>, ApiError> {
    let email = normalize_email(&body.email);

    {
        let mut attempts = state.attempts.lock().map_err(internal)?;
        let now = now_ms();
        let entry = attempts.entry(email.clone()).or_insert((0, now));
        if now - entry.1 > LOGIN_WINDOW_MS {
            *entry = (0, now);
        }
        if entry.0 >= LOGIN_MAX_FAILS {
            return Err(err(StatusCode::TOO_MANY_REQUESTS, "尝试过于频繁，请 10 分钟后再试"));
        }
    }

    let conn = state.db.lock().map_err(internal)?;
    let row: Option<(i64, String, String, String)> = conn
        .query_row(
            "SELECT id, password_hash, username, avatar FROM users WHERE email = ?1",
            params![email],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(internal)?;

    let Some((user_id, stored, username, avatar)) = row else {
        return Err(err(StatusCode::UNAUTHORIZED, "邮箱或密码不正确"));
    };

    let parsed = PasswordHash::new(&stored).map_err(internal)?;
    if Argon2::default()
        .verify_password(body.password.as_bytes(), &parsed)
        .is_err()
    {
        if let Ok(mut attempts) = state.attempts.lock() {
            let entry = attempts.entry(email.clone()).or_insert((0, now_ms()));
            entry.0 += 1;
        }
        return Err(err(StatusCode::UNAUTHORIZED, "邮箱或密码不正确"));
    }
    if let Ok(mut attempts) = state.attempts.lock() {
        attempts.remove(&email);
    }

    let token = create_session(&conn, user_id)?;
    Ok(Json(json!({ "token": token, "email": email, "username": username, "avatar": avatar })))
}

async fn me(State(state): State<App>, headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    let conn = state.db.lock().map_err(internal)?;
    let user_id = auth_user(&conn, &headers)?;
    let row: (String, String, String) = conn
        .query_row(
            "SELECT email, username, avatar FROM users WHERE id = ?1",
            params![user_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(internal)?;
    Ok(Json(json!({ "email": row.0, "username": row.1, "avatar": row.2 })))
}

#[derive(Deserialize)]
struct ProfileUpdate {
    username: String,
    avatar: String,
}

async fn update_profile(
    State(state): State<App>,
    headers: HeaderMap,
    Json(body): Json<ProfileUpdate>,
) -> Result<Json<Value>, ApiError> {
    let conn = state.db.lock().map_err(internal)?;
    let user_id = auth_user(&conn, &headers)?;

    let email: String = conn
        .query_row("SELECT email FROM users WHERE id = ?1", params![user_id], |row| row.get(0))
        .map_err(internal)?;
    let username = clean_username(&body.username, &email);
    if !valid_avatar(body.avatar.trim()) {
        return Err(err(StatusCode::BAD_REQUEST, "头像格式不支持"));
    }

    conn.execute(
        "UPDATE users SET username = ?2, avatar = ?3 WHERE id = ?1",
        params![user_id, username, body.avatar.trim()],
    )
    .map_err(internal)?;

    Ok(Json(json!({ "email": email, "username": username, "avatar": body.avatar.trim() })))
}

async fn logout(State(state): State<App>, headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    let conn = state.db.lock().map_err(internal)?;
    let user_id = auth_user(&conn, &headers)?;
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|raw| raw.trim_start_matches("Bearer ").trim().to_string())
        .unwrap_or_default();
    conn.execute(
        "DELETE FROM sessions WHERE token = ?1 AND user_id = ?2",
        params![token, user_id],
    )
    .map_err(internal)?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct PutNote {
    path: String,
    content: String,
    #[serde(default, rename = "baseVersion")]
    base_version: i64,
}

async fn sync(
    State(state): State<App>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ApiError> {
    let conn = state.db.lock().map_err(internal)?;
    let user_id = auth_user(&conn, &headers)?;
    let since: i64 = query.get("since").and_then(|v| v.parse().ok()).unwrap_or(0);

    let mut stmt = conn
        .prepare(
            "SELECT path, content, version, updated_at, deleted FROM notes
             WHERE user_id = ?1 AND updated_at > ?2 ORDER BY updated_at ASC",
        )
        .map_err(internal)?;
    let rows = stmt
        .query_map(params![user_id, since], |row| {
            Ok(json!({
                "path": row.get::<_, String>(0)?,
                "content": row.get::<_, String>(1)?,
                "version": row.get::<_, i64>(2)?,
                "updatedAt": row.get::<_, i64>(3)?,
                "deleted": row.get::<_, i64>(4)? != 0,
            }))
        })
        .map_err(internal)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(internal)?;

    let cursor = rows
        .iter()
        .filter_map(|v| v.get("updatedAt").and_then(|x| x.as_i64()))
        .max()
        .unwrap_or(since);

    Ok(Json(json!({ "cursor": cursor, "notes": rows })))
}

async fn put_note(
    State(state): State<App>,
    headers: HeaderMap,
    Json(payload): Json<PutNote>,
) -> Result<Json<Value>, ApiError> {
    let conn = state.db.lock().map_err(internal)?;
    let user_id = auth_user(&conn, &headers)?;
    if payload.path.trim().is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "path 不能为空"));
    }

    let current: Option<(String, i64)> = conn
        .query_row(
            "SELECT content, version FROM notes WHERE user_id = ?1 AND path = ?2",
            params![user_id, payload.path],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()
        .map_err(internal)?;

    if let Some((content, version)) = current {
        if version != payload.base_version {
            return Err((
                StatusCode::CONFLICT,
                Json(json!({ "version": version, "content": content })),
            ));
        }
        let next = version + 1;
        conn.execute(
            "UPDATE notes SET content = ?3, version = ?4, updated_at = ?5, deleted = 0
             WHERE user_id = ?1 AND path = ?2",
            params![user_id, payload.path, payload.content, next, now_ms()],
        )
        .map_err(internal)?;
        return Ok(Json(json!({ "version": next })));
    }

    conn.execute(
        "INSERT INTO notes (user_id, path, content, version, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![user_id, payload.path, payload.content, 1, now_ms()],
    )
    .map_err(internal)?;
    Ok(Json(json!({ "version": 1 })))
}

#[derive(Deserialize)]
struct DeleteQuery {
    path: String,
}

/// 删除 = 写墓碑：保留 path/version/updated_at，内容清空、deleted=1。
/// 其他设备靠增量拉取看到墓碑后把本地文件移到回收站。
async fn delete_note(
    State(state): State<App>,
    headers: HeaderMap,
    Query(query): Query<DeleteQuery>,
) -> Result<Json<Value>, ApiError> {
    let conn = state.db.lock().map_err(internal)?;
    let user_id = auth_user(&conn, &headers)?;
    if query.path.trim().is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "path 不能为空"));
    }

    let current: Option<i64> = conn
        .query_row(
            "SELECT version FROM notes WHERE user_id = ?1 AND path = ?2",
            params![user_id, query.path],
            |row| row.get(0),
        )
        .optional()
        .map_err(internal)?;

    let next = match current {
        Some(version) => {
            let next = version + 1;
            conn.execute(
                "UPDATE notes SET content = '', version = ?3, updated_at = ?4, deleted = 1
                 WHERE user_id = ?1 AND path = ?2",
                params![user_id, query.path, next, now_ms()],
            )
            .map_err(internal)?;
            next
        }
        None => {
            conn.execute(
                "INSERT INTO notes (user_id, path, content, version, updated_at, deleted)
                 VALUES (?1, ?2, '', 1, ?3, 1)",
                params![user_id, query.path, now_ms()],
            )
            .map_err(internal)?;
            1
        }
    };

    Ok(Json(json!({ "version": next, "deleted": true })))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db_path = env::var("SYNC_DB").unwrap_or_else(|_| "data/sync.db".to_string());
    if let Some(parent) = std::path::Path::new(&db_path).parent() {
        std::fs::create_dir_all(parent)?;
    }

    let conn = Connection::open(&db_path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS users (
             id            INTEGER PRIMARY KEY AUTOINCREMENT,
             email         TEXT NOT NULL UNIQUE,
             password_hash TEXT NOT NULL,
             username      TEXT NOT NULL DEFAULT '',
             avatar        TEXT NOT NULL DEFAULT '',
             created_at    INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS sessions (
             token      TEXT PRIMARY KEY,
             user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
             created_at INTEGER NOT NULL,
             expires_at INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS notes (
             user_id    INTEGER NOT NULL,
             path       TEXT NOT NULL,
             content    TEXT NOT NULL,
             version    INTEGER NOT NULL,
             updated_at INTEGER NOT NULL,
             deleted    INTEGER NOT NULL DEFAULT 0,
             PRIMARY KEY (user_id, path)
         );
         CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(user_id, updated_at);",
    )?;

    // 旧库补列：CREATE TABLE IF NOT EXISTS 不会给已存在的表加字段
    let _ = conn.execute("ALTER TABLE users ADD COLUMN username TEXT NOT NULL DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE notes ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute(
        "UPDATE sessions SET expires_at = ?1 WHERE expires_at = 0",
        params![now_ms() + SESSION_TTL_MS],
    );

    let state = App {
        db: Arc::new(Mutex::new(conn)),
        attempts: Arc::new(Mutex::new(HashMap::new())),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me))
        .route("/auth/profile", axum::routing::patch(update_profile))
        .route("/sync", get(sync))
        .route("/notes", put(put_note).delete(delete_note))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr: SocketAddr = env::var("SYNC_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8787".to_string())
        .parse()?;
    println!("inksight-sync listening on http://{addr} (db: {db_path})");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
