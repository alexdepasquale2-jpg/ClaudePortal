//! Content-addressed blob store for pre-images (SPEC §3.5).
//!
//! A blob lives at `blobs/<h[0..2]>/<h[2..4]>/<h>` where `h` is the
//! lowercase hex sha256 of its bytes. Writes go to a temp file first and
//! are renamed into place, so a crash never leaves a truncated blob under
//! a valid name.

use crate::{Engram, db_err};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use xz_types::{Effect, Result, Snapshotter, XzError};

/// How long pre-images are kept by default (SPEC §3.5).
pub const DEFAULT_RETENTION_DAYS: u32 = 30;

/// Prefix of in-flight blob writes in the blob root; stale ones are GC'd.
const TMP_PREFIX: &str = ".tmp";

impl Engram {
    /// Stores `bytes` and returns their sha256 hex. Storing the same bytes
    /// twice keeps one copy.
    pub fn put_blob(&self, bytes: &[u8]) -> Result<String> {
        self.put_reader(bytes)
    }

    /// The bytes of blob `hash`, or `NotFound`.
    pub fn get_blob(&self, hash: &str) -> Result<Vec<u8>> {
        let path = self.blob_path(hash)?;
        fs::read(&path).map_err(|e| missing_blob(hash, e))
    }

    /// Deletes blobs older than `older_than_days` that no event from within
    /// that window references. Returns how many blobs were removed.
    ///
    /// Age is the blob file's mtime (refreshed when the same bytes are stored
    /// again), so a fresh snapshot whose event is not yet journaled survives.
    pub fn gc_blobs(&self, older_than_days: u32) -> Result<usize> {
        let window = Duration::from_secs(u64::from(older_than_days) * 86_400);
        let cutoff = SystemTime::now()
            .checked_sub(window)
            .unwrap_or(SystemTime::UNIX_EPOCH);
        let cutoff_ms = xz_types::now_ms().saturating_sub(i64::from(older_than_days) * 86_400_000);
        let keep = self.blobs_referenced_since(cutoff_ms)?;

        let mut removed = 0;
        for entry in fs::read_dir(&self.blobs_dir)? {
            let entry = entry?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if entry.file_type()?.is_dir() {
                removed += gc_fanout(&path, &keep, cutoff)?;
            } else if name.starts_with(TMP_PREFIX) && older_than(&path, cutoff) {
                // Left behind by a crash mid-write.
                fs::remove_file(&path)?;
            }
        }
        Ok(removed)
    }

    /// Streams `src` into the store and returns its hash.
    pub(crate) fn put_reader(&self, mut src: impl Read) -> Result<String> {
        let mut tmp = tempfile::Builder::new()
            .prefix(TMP_PREFIX)
            .tempfile_in(&self.blobs_dir)?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = match src.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(e) => return Err(e.into()),
            };
            hasher.update(&buf[..n]);
            tmp.write_all(&buf[..n])?;
        }
        let hash = hex(&hasher.finalize());
        let dest = self.blob_path(&hash)?;
        // Dedup: refresh the age so GC treats the blob as just stored. If the
        // refresh fails (say GC removed the blob meanwhile), store it again.
        if dest.is_file() && touch(&dest).is_ok() {
            return Ok(hash);
        }
        if let Some(dir) = dest.parent() {
            fs::create_dir_all(dir)?;
        }
        // Pre-images are the only copy of overwritten data, so make them durable.
        tmp.as_file().sync_all()?;
        match tmp.persist_noclobber(&dest) {
            Ok(_) => Ok(hash),
            // A concurrent writer stored the same bytes first.
            Err(e) if e.error.kind() == io::ErrorKind::AlreadyExists => Ok(hash),
            Err(e) => Err(e.error.into()),
        }
    }

    /// Snapshots the file at `path`: `None` if it does not exist, an error
    /// if it is a directory.
    pub(crate) fn snapshot_file(&self, path: &Path) -> Result<Option<String>> {
        let meta = match fs::metadata(path) {
            Ok(m) => m,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        if meta.is_dir() {
            return Err(XzError::InvalidArgs(format!(
                "cannot snapshot a directory: {}",
                path.display()
            )));
        }
        self.put_reader(File::open(path)?).map(Some)
    }

    /// Opens blob `hash` for streaming reads.
    pub(crate) fn open_blob(&self, hash: &str) -> Result<File> {
        File::open(self.blob_path(hash)?).map_err(|e| missing_blob(hash, e))
    }

    /// Validates `hash` before it becomes a path: hashes also arrive inside
    /// Journal effects, and must never name a file outside the store.
    fn blob_path(&self, hash: &str) -> Result<PathBuf> {
        if !is_hash(hash) {
            return Err(XzError::InvalidArgs(format!("not a blob hash: {hash:?}")));
        }
        Ok(self.blobs_dir.join(&hash[..2]).join(&hash[2..4]).join(hash))
    }

    /// Hashes of pre-images named by events at or after `cutoff_ms`.
    fn blobs_referenced_since(&self, cutoff_ms: i64) -> Result<HashSet<String>> {
        let db = self.db();
        let mut stmt = db
            .prepare("SELECT effects FROM events WHERE ts_ms >= ?1 AND effects != '[]'")
            .map_err(db_err)?;
        let rows = stmt
            .query_map([cutoff_ms], |r| r.get::<_, String>(0))
            .map_err(db_err)?;
        let mut keep = HashSet::new();
        for row in rows {
            let effects: Vec<Effect> = serde_json::from_str(&row.map_err(db_err)?)?;
            for e in effects {
                if let Effect::FileModified { pre, .. } = e {
                    keep.insert(pre);
                }
            }
        }
        Ok(keep)
    }
}

/// Removes unkept, old blobs under one first-level fan-out directory.
fn gc_fanout(dir: &Path, keep: &HashSet<String>, cutoff: SystemTime) -> Result<usize> {
    let mut removed = 0;
    for sub in fs::read_dir(dir)? {
        let sub = sub?.path();
        if !sub.is_dir() {
            continue;
        }
        for blob in fs::read_dir(&sub)? {
            let blob = blob?;
            let name = blob.file_name().to_string_lossy().into_owned();
            let path = blob.path();
            if is_hash(&name) && !keep.contains(&name) && older_than(&path, cutoff) {
                fs::remove_file(&path)?;
                removed += 1;
            }
        }
        // Fails harmlessly while the directory still holds blobs.
        let _ = fs::remove_dir(&sub);
    }
    let _ = fs::remove_dir(dir);
    Ok(removed)
}

fn older_than(path: &Path, cutoff: SystemTime) -> bool {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .is_ok_and(|t| t < cutoff)
}

fn touch(path: &Path) -> io::Result<()> {
    File::options()
        .write(true)
        .open(path)?
        .set_modified(SystemTime::now())
}

fn missing_blob(hash: &str, e: io::Error) -> XzError {
    if e.kind() == io::ErrorKind::NotFound {
        XzError::NotFound(format!("blob {hash}"))
    } else {
        e.into()
    }
}

fn is_hash(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(DIGITS[usize::from(b >> 4)] as char);
        s.push(DIGITS[usize::from(b & 0xf)] as char);
    }
    s
}

/// The [`Snapshotter`] Organs use to keep pre-images before they change a
/// file (SPEC §3.5).
#[derive(Clone, Debug)]
pub struct BlobSnapshotter(pub Arc<Engram>);

impl Snapshotter for BlobSnapshotter {
    fn snapshot(&self, path: &Path) -> Result<Option<String>> {
        self.0.snapshot_file(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set_age(engram: &Engram, hash: &str, days: u64) {
        let path = engram.blob_path(hash).unwrap();
        let t = SystemTime::now() - Duration::from_secs(days * 86_400);
        File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(t)
            .unwrap();
    }

    fn event_with_pre(ts_ms: i64, pre: &str) -> xz_types::JournalEvent {
        let effect = Effect::FileModified {
            path: "/x".into(),
            pre: pre.into(),
        };
        let mut ev = crate::testutil::event("t", "fs.write", vec![effect]);
        ev.ts_ms = ts_ms;
        ev
    }

    #[test]
    fn put_get_dedup_and_fanout() {
        let e = Engram::open_temp().unwrap();
        let h = e.put_blob(b"hello").unwrap();
        assert_eq!(
            h,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
        assert_eq!(e.put_blob(b"hello").unwrap(), h);
        assert_eq!(e.get_blob(&h).unwrap(), b"hello");
        assert!(e.blobs_dir.join("2c").join("f2").join(&h).is_file());

        let empty = e.put_blob(b"").unwrap();
        assert_eq!(e.get_blob(&empty).unwrap(), b"");

        let missing = "0".repeat(64);
        assert!(matches!(e.get_blob(&missing), Err(XzError::NotFound(_))));
        // Hashes become paths, so anything else is refused.
        assert!(matches!(
            e.get_blob("../../engram.db"),
            Err(XzError::InvalidArgs(_))
        ));
        // No temp files left behind.
        let stray = fs::read_dir(&e.blobs_dir)
            .unwrap()
            .filter(|d| d.as_ref().unwrap().file_type().unwrap().is_file())
            .count();
        assert_eq!(stray, 0);
    }

    #[test]
    fn snapshotter_handles_missing_files_and_directories() {
        let e = Arc::new(Engram::open_temp().unwrap());
        let snap = BlobSnapshotter(e.clone());
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.txt");

        assert_eq!(snap.snapshot(&file).unwrap(), None);
        fs::write(&file, "before").unwrap();
        let h = snap.snapshot(&file).unwrap().unwrap();
        assert_eq!(e.get_blob(&h).unwrap(), b"before");
        assert!(snap.snapshot(dir.path()).is_err());
    }

    #[test]
    fn gc_keeps_blobs_referenced_by_recent_events() {
        let e = Engram::open_temp().unwrap();
        let now = xz_types::now_ms();
        let day = 86_400_000;
        let old_only = e.put_blob(b"old only").unwrap();
        let shared = e.put_blob(b"old and new").unwrap();
        let unreferenced_old = e.put_blob(b"orphan").unwrap();
        let unreferenced_fresh = e.put_blob(b"snapshot awaiting its event").unwrap();
        for h in [&old_only, &shared, &unreferenced_old] {
            set_age(&e, h, 40);
        }
        e.append(&event_with_pre(now - 40 * day, &old_only))
            .unwrap();
        e.append(&event_with_pre(now - 40 * day, &shared)).unwrap();
        e.append(&event_with_pre(now - day, &shared)).unwrap();

        assert_eq!(e.gc_blobs(DEFAULT_RETENTION_DAYS).unwrap(), 2);
        assert!(e.get_blob(&old_only).is_err());
        assert!(e.get_blob(&unreferenced_old).is_err());
        assert_eq!(e.get_blob(&shared).unwrap(), b"old and new");
        assert!(e.get_blob(&unreferenced_fresh).is_ok());
        // A second pass has nothing left to do.
        assert_eq!(e.gc_blobs(DEFAULT_RETENTION_DAYS).unwrap(), 0);
    }

    #[test]
    fn re_storing_a_blob_refreshes_its_age() {
        let e = Engram::open_temp().unwrap();
        let h = e.put_blob(b"again").unwrap();
        set_age(&e, &h, 40);
        e.put_blob(b"again").unwrap();
        assert_eq!(e.gc_blobs(DEFAULT_RETENTION_DAYS).unwrap(), 0);
        assert!(e.get_blob(&h).is_ok());
    }
}
