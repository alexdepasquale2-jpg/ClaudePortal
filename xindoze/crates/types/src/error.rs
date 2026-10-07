/// The one error type that crosses crate boundaries.
#[derive(Debug, thiserror::Error)]
pub enum XzError {
    /// The Warden or Charter refused the action.
    #[error("denied: {0}")]
    Denied(String),
    /// The user said no when asked to confirm.
    #[error("declined by user: {0}")]
    Declined(String),
    #[error("unknown tool: {0}")]
    UnknownTool(String),
    #[error("invalid arguments: {0}")]
    InvalidArgs(String),
    #[error("model error: {0}")]
    Model(String),
    #[error("budget exceeded: {0}")]
    Budget(String),
    #[error("not found: {0}")]
    NotFound(String),
    /// The current host has no support for this capability family.
    #[error("unsupported on this host: {0}")]
    Unsupported(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("parse: {0}")]
    Parse(String),
    #[error("{0}")]
    Other(String),
}

impl From<serde_json::Error> for XzError {
    fn from(e: serde_json::Error) -> Self {
        XzError::Parse(e.to_string())
    }
}
