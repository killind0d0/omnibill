//! Database Key Custody & Storage for OmniBill (Task L3C).
//!
//! Enforces:
//! - 256-bit AES database key (`DbKey`) with automatic memory zeroization on drop.
//! - Lowercase 64-character hexadecimal parsing with strict validation against injections.
//! - OS keyring storage via the `keyring` crate.
//! - In-memory and dev-file keystores for testing and headless environments.
//! - Zero logging or exposure of raw key material.

use rand_core::{OsRng, RngCore};
use std::fmt;
use std::sync::Mutex;
use zeroize::{Zeroize, ZeroizeOnDrop};

/// 256-bit SQLCipher encryption key for the local SQLite database.
#[derive(Clone, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
pub struct DbKey(pub [u8; 32]);

impl fmt::Debug for DbKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "DbKey([REDACTED])")
    }
}

impl DbKey {
    /// Generates a new cryptographic 256-bit database key using OS CSPRNG.
    pub fn generate() -> Self {
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        DbKey(bytes)
    }

    /// Encodes the key as a 64-character lowercase hexadecimal string.
    pub fn to_hex(&self) -> String {
        const HEX_CHARS: &[u8; 16] = b"0123456789abcdef";
        let mut s = String::with_capacity(64);
        for &b in &self.0 {
            s.push(HEX_CHARS[(b >> 4) as usize] as char);
            s.push(HEX_CHARS[(b & 0x0f) as usize] as char);
        }
        s
    }

    /// Parses a 64-character lowercase hexadecimal string into a `DbKey`.
    /// Rejects anything other than exactly 64 lowercase hex digits.
    pub fn from_hex(s: &str) -> Result<Self, String> {
        let bytes = s.as_bytes();
        if bytes.len() != 64 {
            return Err("Hex key must be exactly 64 characters long".into());
        }

        let mut key = [0u8; 32];
        for i in 0..32 {
            let h = bytes[2 * i];
            let l = bytes[2 * i + 1];

            let high = match h {
                b'0'..=b'9' => h - b'0',
                b'a'..=b'f' => h - b'a' + 10,
                _ => return Err("Invalid hex character: only lowercase 0-9 and a-f allowed".into()),
            };

            let low = match l {
                b'0'..=b'9' => l - b'0',
                b'a'..=b'f' => l - b'a' + 10,
                _ => return Err("Invalid hex character: only lowercase 0-9 and a-f allowed".into()),
            };

            key[i] = (high << 4) | low;
        }

        Ok(DbKey(key))
    }
}

/// Abstract storage interface for custody of the local database key.
pub trait KeyStore: Send + Sync {
    fn get(&self) -> Option<DbKey>;
    fn set(&self, key: &DbKey) -> Result<(), String>;
    fn clear(&self) -> Result<(), String>;
}

/// Production OS Credential Store (Keyring / Secret Service / Windows Credential Manager).
pub struct KeyringStore;

impl KeyringStore {
    pub fn new() -> Self {
        Self
    }
}

impl Default for KeyringStore {
    fn default() -> Self {
        Self::new()
    }
}

impl KeyStore for KeyringStore {
    fn get(&self) -> Option<DbKey> {
        let entry = match keyring::Entry::new("omnibill", "db-key") {
            Ok(e) => e,
            Err(_) => return None,
        };

        let pw = match entry.get_password() {
            Ok(p) => p,
            Err(_) => return None,
        };

        DbKey::from_hex(&pw).ok()
    }

    fn set(&self, key: &DbKey) -> Result<(), String> {
        let entry = keyring::Entry::new("omnibill", "db-key")
            .map_err(|e| format!("Keyring access failed: {}", e))?;

        entry
            .set_password(&key.to_hex())
            .map_err(|e| format!("Keyring store failed: {}", e))
    }

    fn clear(&self) -> Result<(), String> {
        let entry = keyring::Entry::new("omnibill", "db-key")
            .map_err(|e| format!("Keyring access failed: {}", e))?;

        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Keyring delete failed: {}", e)),
        }
    }
}

/// In-memory keystore for tests and mock environments.
pub struct MemoryStore {
    key: Mutex<Option<DbKey>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self {
            key: Mutex::new(None),
        }
    }

    pub fn with_key(key: DbKey) -> Self {
        Self {
            key: Mutex::new(Some(key)),
        }
    }
}

impl Default for MemoryStore {
    fn default() -> Self {
        Self::new()
    }
}

impl KeyStore for MemoryStore {
    fn get(&self) -> Option<DbKey> {
        let lock = match self.key.lock() {
            Ok(l) => l,
            Err(_) => return None,
        };
        lock.clone()
    }

    fn set(&self, key: &DbKey) -> Result<(), String> {
        let mut lock = self.key.lock().map_err(|_| "Lock error".to_string())?;
        *lock = Some(key.clone());
        Ok(())
    }

    fn clear(&self) -> Result<(), String> {
        let mut lock = self.key.lock().map_err(|_| "Lock error".to_string())?;
        *lock = None;
        Ok(())
    }
}

/// Developer-only file-backed key store for headless Linux dev environments without a Secret Service.
#[cfg(debug_assertions)]
pub struct DevFileStore {
    path: std::path::PathBuf,
}

#[cfg(debug_assertions)]
impl DevFileStore {
    pub fn new(path: std::path::PathBuf) -> Self {
        Self { path }
    }
}

#[cfg(debug_assertions)]
impl KeyStore for DevFileStore {
    fn get(&self) -> Option<DbKey> {
        let content = match std::fs::read_to_string(&self.path) {
            Ok(c) => c,
            Err(_) => return None,
        };
        DbKey::from_hex(content.trim()).ok()
    }

    fn set(&self, key: &DbKey) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::write(&self.path, key.to_hex())
            .map_err(|e| format!("Failed to write dev keyfile: {}", e))
    }

    fn clear(&self) -> Result<(), String> {
        if self.path.exists() {
            std::fs::remove_file(&self.path)
                .map_err(|e| format!("Failed to delete dev keyfile: {}", e))?;
        }
        Ok(())
    }
}

/// Resolves the default KeyStore for the current runtime.
/// In release builds, this is strictly `KeyringStore`.
pub fn default_keystore() -> Box<dyn KeyStore> {
    #[cfg(debug_assertions)]
    {
        if let Ok(path) = std::env::var("OMNIBILL_DEV_KEYFILE") {
            if !path.is_empty() {
                return Box::new(DevFileStore::new(std::path::PathBuf::from(path)));
            }
        }
    }

    Box::new(KeyringStore::new())
}
