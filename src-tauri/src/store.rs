//! The till's local, encrypted database (SQLCipher). Everything the till keeps — its device token, the cached
//! catalog and ticket settings, offline cashier logins (and, next, the offline sale queue) — lives here. The only
//! secret outside it is the database key, kept in the OS credential store (Windows Credential Manager / the
//! Secret Service keyring on Linux), with a 0600 key file as a fallback where no keyring is running.

use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const KEYRING_SERVICE: &str = "com.riskycfashion.pos";
const KEYRING_USER: &str = "local-db-key";
const DB_FILE: &str = "riskyc-pos.db";
const KEY_FILE: &str = ".db-key";

pub struct Store {
    conn: Mutex<Connection>,
}

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn random_key_hex() -> String {
    let mut bytes = [0u8; 32];
    use argon2::password_hash::rand_core::RngCore;
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Where the database key lives. Tests use `File` so they never touch the real OS keyring.
pub enum KeySource {
    OsKeyring,
    File,
}

fn key_from_file(dir: &Path) -> Result<String, String> {
    let path = dir.join(KEY_FILE);
    if let Ok(existing) = fs::read_to_string(&path) {
        return Ok(existing.trim().to_string());
    }
    let key = random_key_hex();
    fs::write(&path, &key).map_err(|e| format!("cannot write key file: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(key)
}

fn database_key(dir: &Path, source: &KeySource) -> Result<String, String> {
    if let KeySource::OsKeyring = source {
        // A key file left by an earlier run without a keyring keeps being used, so the database stays readable.
        if !dir.join(KEY_FILE).exists() {
            match keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
                Ok(entry) => match entry.get_password() {
                    Ok(key) => return Ok(key),
                    Err(keyring::Error::NoEntry) => {
                        let key = random_key_hex();
                        if entry.set_password(&key).is_ok() {
                            return Ok(key);
                        }
                        eprintln!("[store] OS keyring rejected the key; falling back to a protected key file");
                    }
                    Err(e) => eprintln!("[store] OS keyring unavailable ({e}); using a protected key file"),
                },
                Err(e) => eprintln!("[store] OS keyring unavailable ({e}); using a protected key file"),
            }
        }
    }
    key_from_file(dir)
}

fn open_with_key(path: &Path, key: &str) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(&format!("PRAGMA key = \"x'{key}'\";"))?;
    // Fails with "file is not a database" when the key doesn't match.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))?;
    Ok(conn)
}

impl Store {
    pub fn open(dir: &Path, source: KeySource) -> Result<Store, String> {
        fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
        let key = database_key(dir, &source)?;
        let path = dir.join(DB_FILE);
        let conn = match open_with_key(&path, &key) {
            Ok(conn) => conn,
            Err(e) if path.exists() => {
                // The key is gone (keyring wiped, OS reinstalled): the old file can never be read again. Keep it
                // aside rather than deleting it, and start fresh — the till re-enrols and re-downloads the catalog.
                let aside: PathBuf = dir.join(format!("{DB_FILE}.unreadable-{}", now_secs()));
                eprintln!("[store] cannot open the local database ({e}); moving it to {}", aside.display());
                fs::rename(&path, &aside).map_err(|e| format!("cannot move unreadable database: {e}"))?;
                open_with_key(&path, &key).map_err(|e| e.to_string())?
            }
            Err(e) => return Err(e.to_string()),
        };
        // Encrypted anyway, but no reason for other accounts on the computer to read it.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
        }
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS kv (
                 key TEXT PRIMARY KEY,
                 value TEXT NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS cashiers (
                 email TEXT PRIMARY KEY,
                 verifier TEXT NOT NULL,
                 session_json TEXT NOT NULL,
                 verified_at INTEGER NOT NULL
             );",
        )
        .map_err(|e| e.to_string())?;
        Ok(Store { conn: Mutex::new(conn) })
    }

    pub fn kv_get(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|_| "store poisoned")?;
        conn.query_row("SELECT value FROM kv WHERE key = ?1", params![key], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn kv_set(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "store poisoned")?;
        conn.execute(
            "INSERT INTO kv (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, now_secs()],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
    }

    pub fn kv_delete(&self, key: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "store poisoned")?;
        conn.execute("DELETE FROM kv WHERE key = ?1", params![key]).map(|_| ()).map_err(|e| e.to_string())
    }

    /// Wipes everything tied to the till's enrolment (used when the till is revoked or re-enrolled).
    pub fn reset(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "store poisoned")?;
        conn.execute_batch("DELETE FROM kv; DELETE FROM cashiers;").map_err(|e| e.to_string())
    }

    /// After a successful online login: keep an Argon2 hash of the password (never the password itself) so the
    /// same cashier can sign in on this till while the server is unreachable.
    pub fn remember_cashier(&self, email: &str, password: &str, session_json: &str) -> Result<(), String> {
        let salt = SaltString::generate(&mut OsRng);
        let verifier = Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| e.to_string())?
            .to_string();
        let conn = self.conn.lock().map_err(|_| "store poisoned")?;
        conn.execute(
            "INSERT INTO cashiers (email, verifier, session_json, verified_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(email) DO UPDATE SET verifier = excluded.verifier, session_json = excluded.session_json,
                                              verified_at = excluded.verified_at",
            params![email.trim().to_lowercase(), verifier, session_json, now_secs()],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
    }

    /// Offline sign-in: the cashier's saved session if the password matches and they signed in online on this
    /// till within `max_age_days` — after that they must connect once, so a revoked account can't live on forever.
    pub fn offline_login(&self, email: &str, password: &str, max_age_days: i64) -> Result<Option<String>, String> {
        let row: Option<(String, String, i64)> = {
            let conn = self.conn.lock().map_err(|_| "store poisoned")?;
            conn.query_row(
                "SELECT verifier, session_json, verified_at FROM cashiers WHERE email = ?1",
                params![email.trim().to_lowercase()],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?
        };
        let Some((verifier, session_json, verified_at)) = row else { return Ok(None) };
        if now_secs() - verified_at > max_age_days * 86_400 {
            return Ok(None);
        }
        let parsed = PasswordHash::new(&verifier).map_err(|e| e.to_string())?;
        Ok(Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok().then_some(session_json))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("riskyc-pos-test-{name}-{}", now_secs()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn data_survives_reopen_with_the_same_key() {
        let dir = temp_dir("reopen");
        Store::open(&dir, KeySource::File).unwrap().kv_set("device", "{\"id\":1}").unwrap();
        let store = Store::open(&dir, KeySource::File).unwrap();
        assert_eq!(store.kv_get("device").unwrap().as_deref(), Some("{\"id\":1}"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn database_file_is_encrypted() {
        let dir = temp_dir("encrypted");
        Store::open(&dir, KeySource::File).unwrap().kv_set("secret", "device-token-123").unwrap();
        let raw = fs::read(dir.join(DB_FILE)).unwrap();
        assert!(!raw.starts_with(b"SQLite format 3"), "plain SQLite header found — not encrypted");
        assert!(!raw.windows(16).any(|w| w == b"device-token-123"), "plaintext value found in the file");
        // Opening without the key must fail.
        assert!(Connection::open(dir.join(DB_FILE)).unwrap().query_row("SELECT count(*) FROM kv", [], |r| r.get::<_, i64>(0)).is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn lost_key_moves_the_old_database_aside() {
        let dir = temp_dir("lostkey");
        Store::open(&dir, KeySource::File).unwrap().kv_set("device", "x").unwrap();
        fs::write(dir.join(KEY_FILE), random_key_hex()).unwrap();
        let store = Store::open(&dir, KeySource::File).unwrap();
        assert_eq!(store.kv_get("device").unwrap(), None);
        assert!(fs::read_dir(&dir).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().contains(".unreadable-")));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn offline_login_checks_password_and_age() {
        let dir = temp_dir("login");
        let store = Store::open(&dir, KeySource::File).unwrap();
        store.remember_cashier("Awa@Shop.cm", "s3cret", "{\"firstName\":\"Awa\"}").unwrap();
        assert_eq!(store.offline_login("awa@shop.cm ", "s3cret", 7).unwrap().as_deref(), Some("{\"firstName\":\"Awa\"}"));
        assert_eq!(store.offline_login("awa@shop.cm", "wrong", 7).unwrap(), None);
        assert_eq!(store.offline_login("other@shop.cm", "s3cret", 7).unwrap(), None);
        let verifier: String = store.conn.lock().unwrap().query_row("SELECT verifier FROM cashiers", [], |r| r.get(0)).unwrap();
        assert!(!verifier.contains("s3cret") && verifier.starts_with("$argon2"));
        store.conn.lock().unwrap().execute("UPDATE cashiers SET verified_at = verified_at - 8 * 86400", []).unwrap();
        assert_eq!(store.offline_login("awa@shop.cm", "s3cret", 7).unwrap(), None, "expired offline login accepted");
        store.reset().unwrap();
        assert_eq!(store.offline_login("awa@shop.cm", "s3cret", 7).unwrap(), None);
        fs::remove_dir_all(&dir).unwrap();
    }
}
