//! Engram: memory, Journal, blob store and Rewind (SPEC §3.5, §3.7).
//!
//! One SQLite file (`<data>/engram.db`) plus a content-addressed blob
//! directory (`<data>/blobs/`). [`Engram`] is `Send + Sync`: a single
//! connection sits behind a mutex. At personal scale that is fast enough,
//! and it keeps writes serialized without SQLite busy handling.

mod blobs;
mod episodes;
mod facts;
mod forget;
mod journal;
mod kv;
mod rewind;
mod schema;
#[cfg(test)]
mod testutil;
mod vectors;

pub use blobs::{BlobSnapshotter, DEFAULT_RETENTION_DAYS};
pub use episodes::Episode;
pub use facts::{Fact, FactRecord};
pub use forget::ForgetReport;
pub use journal::EventQuery;
pub use rewind::{RewindItem, RewindReport, RewindSelector};
pub use vectors::Hit;

use rusqlite::Connection;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use xz_types::{Result, XzError};

/// The user's memory: Journal, blobs, KV, facts, vectors and episodes.
pub struct Engram {
    conn: Mutex<Connection>,
    data_dir: PathBuf,
    blobs_dir: PathBuf,
    device_id: String,
    /// Serializes rewinds so two of them never undo the same event twice.
    rewind_lock: Mutex<()>,
    /// Keeps the directory of [`Engram::open_temp`] alive as long as the store.
    _temp: Option<tempfile::TempDir>,
}

impl Engram {
    /// Opens (or creates) `<data_dir>/engram.db` and `<data_dir>/blobs/`.
    /// `device_id` names this device in the Journal and in Hive sync.
    pub fn open(data_dir: impl AsRef<Path>, device_id: impl Into<String>) -> Result<Self> {
        Self::open_in(data_dir.as_ref().to_path_buf(), device_id.into(), None)
    }

    /// Opens a store in a fresh temporary directory, deleted on drop.
    /// The device id is `local`.
    pub fn open_temp() -> Result<Self> {
        let dir = tempfile::tempdir()?;
        Self::open_in(dir.path().to_path_buf(), "local".into(), Some(dir))
    }

    fn open_in(
        data_dir: PathBuf,
        device_id: String,
        temp: Option<tempfile::TempDir>,
    ) -> Result<Self> {
        if device_id.trim().is_empty() {
            return Err(XzError::InvalidArgs("device id must not be empty".into()));
        }
        let blobs_dir = data_dir.join("blobs");
        std::fs::create_dir_all(&blobs_dir)?;
        let mut conn = Connection::open(data_dir.join("engram.db")).map_err(db_err)?;
        schema::init(&mut conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
            data_dir,
            blobs_dir,
            device_id,
            rewind_lock: Mutex::new(()),
            _temp: temp,
        })
    }

    /// The data directory this store lives in.
    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    /// This device's id, stamped on every locally appended event.
    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    fn db(&self) -> MutexGuard<'_, Connection> {
        // A panic while holding the lock cannot leave the database
        // half-written (open transactions roll back on drop), so a poisoned
        // lock is safe to keep using.
        self.conn.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl fmt::Debug for Engram {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Engram")
            .field("data_dir", &self.data_dir)
            .field("device_id", &self.device_id)
            .finish_non_exhaustive()
    }
}

/// SQLite errors cannot convert into `XzError` directly (both types are
/// foreign here), so every query maps them through this.
pub(crate) fn db_err(e: rusqlite::Error) -> XzError {
    XzError::Other(format!("engram db: {e}"))
}

/// Converts a row count or limit for SQL, saturating instead of wrapping.
pub(crate) fn sql_limit(n: usize) -> i64 {
    i64::try_from(n).unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engram_is_shareable_across_threads() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<Engram>();
    }

    #[test]
    fn open_creates_the_layout_and_reopens() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let e = Engram::open(&data, "pc").unwrap();
        assert!(data.join("engram.db").is_file());
        assert!(data.join("blobs").is_dir());
        assert_eq!(e.device_id(), "pc");
        e.kv_set("ns", "k", &serde_json::json!("v")).unwrap();
        drop(e);
        let e = Engram::open(&data, "pc").unwrap();
        assert_eq!(e.kv_get("ns", "k").unwrap(), Some(serde_json::json!("v")));
        assert!(Engram::open(&data, " ").is_err());
    }
}
