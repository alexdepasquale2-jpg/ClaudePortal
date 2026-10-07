//! Content-addressed blob store (SPEC §3.5). Pre-images of files the
//! Organs are about to change live here, deduplicated by sha256.

use crate::Engram;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use xz_types::{Result, Snapshotter, XzError};

/// Largest file a snapshot will copy. Bigger writes must be refused by the
/// Organ rather than journaled without a pre-image.
const MAX_SNAPSHOT_BYTES: u64 = 32 * 1024 * 1024;

/// The blob directory beside `engram.db`.
#[derive(Clone, Debug)]
pub struct BlobStore {
    dir: PathBuf,
}

impl BlobStore {
    pub(crate) fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    /// Stores `bytes` and returns the hex sha256. A second put of the same
    /// bytes keeps the existing file.
    pub fn put(&self, bytes: &[u8]) -> Result<String> {
        let hash = sha256_hex(bytes);
        let path = self.path_for(&hash)?;
        if path.is_file() {
            return Ok(hash);
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("tmp");
        fs::write(&tmp, bytes)?;
        fs::rename(&tmp, &path)?;
        Ok(hash)
    }

    /// The bytes stored under `hash`.
    pub fn get(&self, hash: &str) -> Result<Vec<u8>> {
        let path = self.path_for(hash)?;
        fs::read(&path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                XzError::NotFound(format!("blob {hash}"))
            } else {
                e.into()
            }
        })
    }

    /// Deletes one blob. Returns whether a file was removed.
    pub fn delete(&self, hash: &str) -> Result<bool> {
        let path = self.path_for(hash)?;
        match fs::remove_file(&path) {
            Ok(()) => Ok(true),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(e.into()),
        }
    }

    /// Every stored hash.
    pub fn list(&self) -> Result<Vec<String>> {
        let mut out = Vec::new();
        if !self.dir.exists() {
            return Ok(out);
        }
        for shard in fs::read_dir(&self.dir)? {
            let shard = shard?;
            if !shard.file_type()?.is_dir() {
                continue;
            }
            let prefix = shard.file_name();
            let prefix = prefix.to_string_lossy();
            for file in fs::read_dir(shard.path())? {
                let file = file?;
                if !file.file_type()?.is_file() {
                    continue;
                }
                let name = file.file_name();
                let name = name.to_string_lossy();
                if name.ends_with(".tmp") {
                    continue;
                }
                out.push(format!("{prefix}{name}"));
            }
        }
        out.sort();
        Ok(out)
    }

    fn path_for(&self, hash: &str) -> Result<PathBuf> {
        if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(XzError::InvalidArgs(format!("blob hash `{hash}`")));
        }
        Ok(self.dir.join(&hash[..2]).join(&hash[2..]))
    }
}

/// [`Snapshotter`] over a [`BlobStore`].
#[derive(Clone, Debug)]
pub struct BlobSnapshotter {
    store: BlobStore,
}

impl BlobSnapshotter {
    pub(crate) fn new(store: BlobStore) -> Self {
        Self { store }
    }

    pub fn store(&self) -> &BlobStore {
        &self.store
    }
}

impl Snapshotter for BlobSnapshotter {
    fn snapshot(&self, path: &Path) -> Result<Option<String>, XzError> {
        let meta = match fs::symlink_metadata(path) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        // A symlink's target is not this path. Callers that follow links
        // re-check the target; the pre-image is the file itself.
        if !meta.is_file() {
            return Ok(None);
        }
        if meta.len() > MAX_SNAPSHOT_BYTES {
            return Err(XzError::InvalidArgs(format!(
                "{} is {} bytes; snapshots stop at {MAX_SNAPSHOT_BYTES}",
                path.display(),
                meta.len()
            )));
        }
        let bytes = fs::read(path)?;
        self.store.put(&bytes).map(Some)
    }
}

impl Engram {
    /// The content-addressed store next to this database.
    pub fn blobs(&self) -> BlobStore {
        BlobStore::new(self.blobs_dir.clone())
    }

    /// A snapshotter Organs can use while changing files.
    pub fn snapshotter(&self) -> BlobSnapshotter {
        BlobSnapshotter::new(self.blobs())
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let dig = Sha256::digest(bytes);
    let mut s = String::with_capacity(dig.len() * 2);
    for b in dig {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xf) as usize] as char);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn put_is_content_addressed_and_deduped() {
        let eg = Engram::open_temp().unwrap();
        let store = eg.blobs();
        let a = store.put(b"hello").unwrap();
        let b = store.put(b"hello").unwrap();
        assert_eq!(a, b);
        assert_eq!(a.len(), 64);
        assert_eq!(store.get(&a).unwrap(), b"hello");
        assert_eq!(store.list().unwrap(), vec![a.clone()]);
        assert!(store.delete(&a).unwrap());
        assert!(!store.delete(&a).unwrap());
        assert!(store.get(&a).is_err());
        assert!(store.get("../etc/passwd").is_err());
        assert!(store.get("abcd").is_err());
    }

    #[test]
    fn snapshot_reads_regular_files_only() {
        let eg = Engram::open_temp().unwrap();
        let dir = eg.data_dir().join("files");
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.txt");
        fs::write(&file, b"abc").unwrap();
        let snap = eg.snapshotter();
        let hash = snap.snapshot(&file).unwrap().unwrap();
        assert_eq!(snap.store().get(&hash).unwrap(), b"abc");
        assert_eq!(snap.snapshot(&dir.join("missing")).unwrap(), None);
        assert_eq!(snap.snapshot(&dir).unwrap(), None);
    }
}
