//! Android bridge: foreground service, embedded llama.cpp, drafts.
//!
//! The Canvas calls the shell. The shell calls this plugin. Kotlin performs
//! the platform work. Safety limits live in `xz-android`.

use serde::{Deserialize, Serialize};
use tauri::{
    Manager, Runtime,
    plugin::{Builder, TauriPlugin},
};

#[cfg(not(target_os = "android"))]
mod desktop;
#[cfg(target_os = "android")]
mod mobile;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Message(String),
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneStatus {
    pub install_id: String,
    pub ram_mb: u64,
    pub charging: bool,
    pub edition: String,
}

pub struct Bridge<R: Runtime> {
    #[cfg(target_os = "android")]
    handle: tauri::plugin::PluginHandle<R>,
    #[cfg(not(target_os = "android"))]
    _runtime: std::marker::PhantomData<R>,
}

impl<R: Runtime> Bridge<R> {
    pub fn status(&self) -> Result<PhoneStatus> {
        #[cfg(target_os = "android")]
        {
            return self
                .handle
                .run_mobile_plugin("status", ())
                .map_err(|e| Error::Message(e.to_string()));
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = self;
            Err(Error::Message(
                "the Android bridge runs on the phone".into(),
            ))
        }
    }

    pub fn complete(&self, prompt: &str, max_tokens: u32) -> Result<String> {
        #[cfg(target_os = "android")]
        {
            #[derive(Serialize)]
            #[serde(rename_all = "camelCase")]
            struct Args<'a> {
                prompt: &'a str,
                max_tokens: u32,
            }
            #[derive(Deserialize)]
            struct Out {
                text: String,
            }
            let out: Out = self
                .handle
                .run_mobile_plugin("complete", Args { prompt, max_tokens })
                .map_err(|e| Error::Message(e.to_string()))?;
            return Ok(out.text);
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (self, prompt, max_tokens);
            Err(Error::Message(
                "embedded llama.cpp ships in the Android APK".into(),
            ))
        }
    }

    pub fn message_draft(&self, to: &str, body: &str) -> Result<()> {
        #[cfg(target_os = "android")]
        {
            #[derive(Serialize)]
            #[serde(rename_all = "camelCase")]
            struct Args<'a> {
                to: &'a str,
                body: &'a str,
            }
            self.handle
                .run_mobile_plugin::<()>("messageDraft", Args { to, body })
                .map_err(|e| Error::Message(e.to_string()))?;
            return Ok(());
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (self, to, body);
            Err(Error::Message(
                "message drafts open in the Android SMS app".into(),
            ))
        }
    }

    pub fn open_url(&self, url: &str) -> Result<()> {
        #[cfg(target_os = "android")]
        {
            #[derive(Serialize)]
            struct Args<'a> {
                url: &'a str,
            }
            self.handle
                .run_mobile_plugin::<()>("openUrl", Args { url })
                .map_err(|e| Error::Message(e.to_string()))?;
            return Ok(());
        }
        #[cfg(not(target_os = "android"))]
        {
            let _ = (self, url);
            Err(Error::Message(
                "open_url on Android opens the system browser".into(),
            ))
        }
    }
}

pub trait AndroidBridgeExt<R: Runtime> {
    fn android_bridge(&self) -> &Bridge<R>;
}

impl<R: Runtime, T: Manager<R>> AndroidBridgeExt<R> for T {
    fn android_bridge(&self) -> &Bridge<R> {
        self.state::<Bridge<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-bridge")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let bridge =
                mobile::init(app, api).map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            #[cfg(not(target_os = "android"))]
            let bridge = desktop::init(app, api);
            app.manage(bridge);
            Ok(())
        })
        .build()
}
