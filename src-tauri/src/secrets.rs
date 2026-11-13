//! 本地凭据库：账号密码 / API Key 等。
//!
//! 存储位置写死在**安装目录**的 `data/.secrets/`：
//!   - `items.enc`：AES-256-GCM 密文（整份 JSON，带随机 nonce）
//!   - `key.bin`：32 字节密钥，用 Windows DPAPI（当前用户）包裹
//!
//! 刻意**不走** `resolve_vault_dir` —— 那个函数在安装目录不可写时会回落到 AppData，
//! 而这里的约定是「只存安装文件夹」，所以宁可报错也不换地方。
//!
//! 密钥和密文放在一起，安全性来自 DPAPI：文件被拷到别的机器 / 别的用户下解不开。
//! 代价是当前用户被攻破等同于明文 —— 这是个人工具的取舍。
//!
//! `data/.gitignore` 会被确保包含 `.secrets/`，否则 git 同步会把密文推到远端。

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use windows_sys::Win32::Foundation::{LocalFree, HLOCAL};
use windows_sys::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
};

const NONCE_LEN: usize = 12;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SecretItem {
    pub id: String,
    pub name: String,
    /// login / apikey / database / other
    pub category: String,
    pub username: String,
    /// 密码或 API Key 本身
    pub secret: String,
    pub url: String,
    pub note: String,
    /// unix 秒
    pub updated: u64,
}

fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    }
}

fn dpapi_protect(data: &[u8]) -> Result<Vec<u8>, String> {
    unsafe {
        let input = blob(data);
        let mut out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        let ok = CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut out,
        );
        if ok == 0 || out.pbData.is_null() {
            return Err("DPAPI 加密失败".to_string());
        }
        let bytes = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        LocalFree(out.pbData as HLOCAL);
        Ok(bytes)
    }
}

fn dpapi_unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    unsafe {
        let input = blob(data);
        let mut out = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        let mut descr = std::ptr::null_mut();
        let ok = CryptUnprotectData(
            &input,
            &mut descr,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut out,
        );
        if ok == 0 || out.pbData.is_null() {
            return Err("无法解开本机密钥：文件可能来自其他电脑或用户".to_string());
        }
        let bytes = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        LocalFree(out.pbData as HLOCAL);
        Ok(bytes)
    }
}

/// 安装目录下的 data/.secrets，不可写就明确报错，绝不回落
fn secret_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("无法定位程序位置：{e}"))?;
    let data = exe
        .parent()
        .ok_or_else(|| "无法定位安装目录".to_string())?
        .join("data");
    let dir = data.join(".secrets");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("无法在安装目录创建 .secrets：{e}"))?;

    // 可写自检：只读安装（比如装在 Program Files）要在这里失败，而不是静默换地方
    let probe = dir.join(".probe");
    std::fs::write(&probe, b"ok").map_err(|e| format!("安装目录不可写：{e}"))?;
    let _ = std::fs::remove_file(&probe);

    ensure_gitignore(&data)?;
    Ok(dir)
}

fn ensure_gitignore(data: &Path) -> Result<(), String> {
    let path = data.join(".gitignore");
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    if existing.lines().any(|line| line.trim() == ".secrets/") {
        return Ok(());
    }
    let mut next = existing;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(".secrets/\n");
    std::fs::write(&path, next).map_err(|e| format!("写入 .gitignore 失败：{e}"))
}

fn load_key(dir: &Path) -> Result<[u8; 32], String> {
    let path = dir.join("key.bin");
    if path.is_file() {
        let wrapped = std::fs::read(&path).map_err(|e| format!("读取密钥失败：{e}"))?;
        let raw = dpapi_unprotect(&wrapped)?;
        if raw.len() != 32 {
            return Err("密钥文件损坏".to_string());
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&raw);
        return Ok(key);
    }

    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    let wrapped = dpapi_protect(&key)?;
    std::fs::write(&path, &wrapped).map_err(|e| format!("写入密钥失败：{e}"))?;
    Ok(key)
}

fn cipher_of(dir: &Path) -> Result<Aes256Gcm, String> {
    let key = load_key(dir)?;
    Aes256Gcm::new_from_slice(&key).map_err(|_| "密钥无效".to_string())
}

fn load_items(dir: &Path) -> Result<Vec<SecretItem>, String> {
    let path = dir.join("items.enc");
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read(&path).map_err(|e| format!("读取凭据文件失败：{e}"))?;
    if raw.len() <= NONCE_LEN {
        return Err("凭据文件损坏".to_string());
    }
    let cipher = cipher_of(dir)?;
    let (nonce, body) = raw.split_at(NONCE_LEN);
    let plain = cipher
        .decrypt(Nonce::from_slice(nonce), body)
        .map_err(|_| "解密失败：文件被改动，或来自其他电脑".to_string())?;
    serde_json::from_slice(&plain).map_err(|e| format!("解析凭据失败：{e}"))
}

fn write_items(dir: &Path, items: &[SecretItem]) -> Result<(), String> {
    let cipher = cipher_of(dir)?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let plain = serde_json::to_vec(items).map_err(|e| format!("序列化失败：{e}"))?;
    let body = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plain.as_slice())
        .map_err(|_| "加密失败".to_string())?;

    let mut out = Vec::with_capacity(NONCE_LEN + body.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&body);

    let path = dir.join("items.enc");
    // 先写临时文件再改名，避免写一半断电把整库写坏
    let tmp = dir.join("items.enc.tmp");
    std::fs::write(&tmp, &out).map_err(|e| format!("写入凭据失败：{e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("落盘凭据失败：{e}"))
}

#[tauri::command]
pub fn secrets_list() -> Result<Vec<SecretItem>, String> {
    let dir = secret_dir()?;
    let mut items = load_items(&dir)?;
    items.sort_by(|a, b| b.updated.cmp(&a.updated));
    Ok(items)
}

#[tauri::command]
pub fn secrets_save(mut item: SecretItem) -> Result<SecretItem, String> {
    let dir = secret_dir()?;
    let mut items = load_items(&dir)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    item.updated = now;

    if item.id.trim().is_empty() {
        item.id = format!("s{now}{:03}", rand::thread_rng().next_u32() % 1000);
        items.push(item.clone());
    } else if let Some(existing) = items.iter_mut().find(|row| row.id == item.id) {
        *existing = item.clone();
    } else {
        items.push(item.clone());
    }

    write_items(&dir, &items)?;
    Ok(item)
}

#[tauri::command]
pub fn secrets_remove(id: String) -> Result<(), String> {
    let dir = secret_dir()?;
    let mut items = load_items(&dir)?;
    items.retain(|row| row.id != id);
    write_items(&dir, &items)
}

/// 设置页要展示「数据存在哪」，让用户能自己去看 / 备份
#[tauri::command]
pub fn secrets_location() -> Result<String, String> {
    let dir = secret_dir()?;
    Ok(dir.to_string_lossy().to_string())
}
