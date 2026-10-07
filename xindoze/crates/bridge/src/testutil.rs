//! Test helpers: a sandboxed home and a Snapshotter that records pre-images.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use xz_types::{CallCtx, Result, Snapshotter};

/// Keeps every pre-image in memory; the blob id is `blob<n>`.
#[derive(Default)]
pub(crate) struct Recorder {
    pub blobs: Mutex<Vec<(PathBuf, Vec<u8>)>>,
}

impl Snapshotter for Recorder {
    fn snapshot(&self, path: &Path) -> Result<Option<String>> {
        match std::fs::read(path) {
            Ok(bytes) => {
                let mut blobs = self.blobs.lock().unwrap();
                blobs.push((path.to_path_buf(), bytes));
                Ok(Some(format!("blob{}", blobs.len() - 1)))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }
}

/// A temporary home with the data directory inside it, as on Linux.
pub(crate) struct Sandbox {
    _dir: tempfile::TempDir,
    pub home: PathBuf,
    pub data: PathBuf,
    pub recorder: Arc<Recorder>,
}

impl Sandbox {
    pub fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        let data = home.join(".local/share/xindoze");
        std::fs::create_dir_all(&data).unwrap();
        Self {
            _dir: dir,
            home,
            data,
            recorder: Arc::default(),
        }
    }

    /// A call context whose snapshots go to `self.recorder`.
    pub fn ctx(&self) -> CallCtx {
        CallCtx {
            organism: "test".into(),
            task_id: "task-1".into(),
            snapshot: self.recorder.clone(),
        }
    }

    /// Writes a file below home, creating parents.
    pub fn put(&self, rel: &str, content: impl AsRef<[u8]>) -> PathBuf {
        let p = self.home.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, content).unwrap();
        p
    }
}
