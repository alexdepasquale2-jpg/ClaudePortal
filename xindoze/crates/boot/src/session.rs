//! The face the native session starts. The Canvas binary belongs to the
//! shell track, so this crate only knows a program path and arguments.

/// What `cage` execs. The shell track supplies the real binary later.
pub trait SessionFace: Send + Sync {
    fn program(&self) -> &str;
    fn args(&self) -> &[String];
}

/// Argv for the Canvas binary the shell track installs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CanvasCommand {
    program: String,
    args: Vec<String>,
}

impl CanvasCommand {
    pub fn native() -> Self {
        Self {
            program: "/usr/bin/xindoze-canvas".into(),
            args: vec!["--fullscreen".into()],
        }
    }

    /// Path the Windows login launcher starts. The shell track owns the installer layout.
    pub const WINDOWS_PROGRAM: &'static str = r"C:\Program Files\Xindoze\xindoze-canvas.exe";
}

impl SessionFace for CanvasCommand {
    fn program(&self) -> &str {
        &self.program
    }

    fn args(&self) -> &[String] {
        &self.args
    }
}

pub fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

/// `exec cage -- <program> <args>`
pub fn cage_command(face: &dyn SessionFace) -> String {
    let mut command = format!("exec cage -- {}", shell_quote(face.program()));
    for arg in face.args() {
        command.push(' ');
        command.push_str(&shell_quote(arg));
    }
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canvas_command_is_fullscreen() {
        let canvas = CanvasCommand::native();
        assert_eq!(canvas.args(), &["--fullscreen".to_string()]);
        let line = cage_command(&canvas);
        assert_eq!(
            line,
            "exec cage -- '/usr/bin/xindoze-canvas' '--fullscreen'"
        );
    }
}
