use serde::de::DeserializeOwned;
use tauri::{AppHandle, Runtime, plugin::PluginApi};

use crate::{Bridge, Error};

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> Result<Bridge<R>, Error> {
    let handle = api
        .register_android_plugin("org.xindoze.bridge", "BridgePlugin")
        .map_err(|e| Error::Message(e.to_string()))?;
    Ok(Bridge { handle })
}
