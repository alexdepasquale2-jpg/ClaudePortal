//! `xz-boot` renders a native layout or a Windows login launcher.
//!
//! `render` only accepts a staging directory. `apply` also requires
//! `XZ_BOOT_APPLY=1`. Neither command writes `/boot` or the firmware.

use std::env;
use std::path::PathBuf;
use std::process::ExitCode;

use xz_boot::{
    Auth, ConquestMode, NativePlan, TakeoverPlan, install_layout, install_takeover, render_layout,
    revert_takeover,
};

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("xz-boot: {err}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), xz_boot::BootError> {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some("render") => {
            let (arch, out) = arch_and_out(&mut args)?;
            let plan = NativePlan::alpine(&arch)?;
            let layout = render_layout(&out, &plan)?;
            println!("{} {}", layout.report.line, out.display());
            Ok(())
        }
        Some("apply") => {
            let (arch, out) = arch_and_out(&mut args)?;
            let plan = NativePlan::alpine(&arch)?;
            let layout = install_layout(&out, &plan, Auth::from_env())?;
            println!("{} {}", layout.report.line, out.display());
            Ok(())
        }
        Some("takeover") => match args.next().as_deref() {
            Some("install") => {
                let mode = conquest(args.next().as_deref().unwrap_or("takeover"))?;
                let data = named(&mut args, "--data")?;
                let startup = named(&mut args, "--startup")?;
                let plan = TakeoverPlan::new(mode)?;
                let wrote = install_takeover(&data, &startup, &plan, Auth::from_env())?;
                println!("wrote {}", wrote.state.display());
                if let Some(launcher) = wrote.launcher {
                    println!("launcher {}", launcher.display());
                }
                Ok(())
            }
            Some("revert") => {
                let data = named(&mut args, "--data")?;
                let startup = named(&mut args, "--startup")?;
                let removed = revert_takeover(&data, &startup)?;
                if removed.is_empty() {
                    println!("nothing to revert");
                }
                for path in removed {
                    println!("removed {}", path.display());
                }
                Ok(())
            }
            _ => Err(xz_boot::BootError::Refused(
                "usage: xz-boot takeover install [guest|overlay|takeover] --data DIR --startup DIR | takeover revert --data DIR --startup DIR".into(),
            )),
        },
        _ => Err(xz_boot::BootError::Refused(
            "usage: xz-boot render|apply --arch x86_64|aarch64 --out DIR".into(),
        )),
    }
}

fn arch_and_out(
    args: &mut impl Iterator<Item = String>,
) -> Result<(String, PathBuf), xz_boot::BootError> {
    let arch = named(args, "--arch")?;
    let out = named(args, "--out")?;
    Ok((arch.to_string_lossy().into_owned(), out))
}

fn named(
    args: &mut impl Iterator<Item = String>,
    flag: &str,
) -> Result<PathBuf, xz_boot::BootError> {
    match args.next().as_deref() {
        Some(got) if got == flag => {}
        _ => {
            return Err(xz_boot::BootError::Refused(format!("expected {flag}")));
        }
    }
    args.next()
        .map(PathBuf::from)
        .ok_or_else(|| xz_boot::BootError::Refused(format!("missing value for {flag}")))
}

fn conquest(name: &str) -> Result<ConquestMode, xz_boot::BootError> {
    match name {
        "guest" => Ok(ConquestMode::Guest),
        "overlay" => Ok(ConquestMode::Overlay),
        "takeover" => Ok(ConquestMode::Takeover),
        _ => Err(xz_boot::BootError::Refused(
            "mode is guest, overlay, or takeover".into(),
        )),
    }
}
