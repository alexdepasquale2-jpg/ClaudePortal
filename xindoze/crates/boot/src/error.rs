use std::fmt;

/// Failures of the boot planner. These never come from a model.
#[derive(Debug)]
pub enum BootError {
    /// The process is not in the phase this call requires.
    BadState(&'static str),
    /// The plan or the destination is not allowed.
    Refused(String),
    /// The destination is a host boot path this crate will not write.
    HostBootPath(String),
    /// The write would change how this machine starts, and `XZ_BOOT_APPLY` is off.
    NeedsFlag(String),
    Io(std::io::Error),
}

impl fmt::Display for BootError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BootError::BadState(msg) => write!(f, "bad state: {msg}"),
            BootError::Refused(msg) => write!(f, "refused: {msg}"),
            BootError::HostBootPath(path) => {
                write!(f, "refusing to write host boot path {path}")
            }
            BootError::NeedsFlag(path) => write!(
                f,
                "refusing to change boot integration at {path} without XZ_BOOT_APPLY=1"
            ),
            BootError::Io(err) => write!(f, "io: {err}"),
        }
    }
}

impl std::error::Error for BootError {}

impl From<std::io::Error> for BootError {
    fn from(err: std::io::Error) -> Self {
        BootError::Io(err)
    }
}
