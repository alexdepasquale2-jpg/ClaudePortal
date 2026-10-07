//! Windows text-to-speech through SAPI (present on every Windows install).

use super::Speaker;
use windows::Win32::Media::Speech::{ISpVoice, SPF_IS_NOT_XML, SpVoice};
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize,
};
use windows::core::HSTRING;
use xz_types::XzError;

/// The system SAPI voice.
pub struct Sapi;

impl Speaker for Sapi {
    fn name(&self) -> &str {
        "sapi"
    }

    fn speak(&self, text: &str) -> Result<(), XzError> {
        // SAFETY: COM is initialized on this thread before any COM call, the
        // voice is dropped before COM is uninitialized, and COM is only
        // uninitialized when this call initialized it.
        unsafe {
            let init = CoInitializeEx(None, COINIT_MULTITHREADED);
            let result = (|| {
                let voice: ISpVoice = CoCreateInstance(&SpVoice, None, CLSCTX_ALL)?;
                // SPF_IS_NOT_XML: text is spoken literally, never parsed as SAPI markup.
                voice.Speak(&HSTRING::from(text), SPF_IS_NOT_XML.0 as u32, None)
            })();
            if init.is_ok() {
                CoUninitialize();
            }
            result.map_err(|e| XzError::Other(format!("sapi: {e}")))
        }
    }
}
