//! The seam between presence and Discord's local IPC, as
//! [`crate::lastfm::transport`] is for last.fm: every rule in `discord` is
//! tested against [`FakeTransport`], and only [`IpcTransport`] opens a pipe.

use discord_rich_presence::activity::{ActivityType, Assets, StatusDisplayType, Timestamps};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};

use super::{Activity, CLIENT_ID};

#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    /// No pipe, or one that broke: Discord is not running, or has quit.
    #[error("Discord is unreachable: {0}")]
    Gone(String),
    /// Discord answered and refused the activity. The pipe is still good.
    #[error("Discord refused the activity: {0}")]
    Refused(String),
}

/// Somewhere an activity can be shown.
pub trait Transport: Send {
    fn connect(&mut self) -> Result<(), TransportError>;
    fn set(&mut self, activity: &Activity) -> Result<(), TransportError>;
    fn clear(&mut self) -> Result<(), TransportError>;
    /// Discord drops the activity when the pipe closes.
    fn close(&mut self);
}

/// The one implementation that opens `\\?\pipe\discord-ipc-N`.
#[derive(Default)]
pub struct IpcTransport {
    client: Option<DiscordIpcClient>,
}

impl IpcTransport {
    fn client(&mut self) -> Result<&mut DiscordIpcClient, TransportError> {
        self.client
            .as_mut()
            .ok_or_else(|| TransportError::Gone("not connected".to_owned()))
    }

    /// Reads the answer to the command just sent.
    ///
    /// The crate never reads one, so a refusal would go unnoticed and every
    /// answer would sit in the pipe until Discord's side of it filled.
    fn answer(&mut self) -> Result<(), TransportError> {
        let (_, body) = self.client()?.recv().map_err(gone)?;
        if body["evt"] == "ERROR" {
            let message = body["data"]["message"]
                .as_str()
                .unwrap_or("no reason given");
            return Err(TransportError::Refused(message.to_owned()));
        }
        Ok(())
    }
}

fn gone(error: discord_rich_presence::error::Error) -> TransportError {
    TransportError::Gone(error.to_string())
}

impl Transport for IpcTransport {
    fn connect(&mut self) -> Result<(), TransportError> {
        let mut client = DiscordIpcClient::new(CLIENT_ID);
        client.connect().map_err(gone)?;
        self.client = Some(client);
        Ok(())
    }

    fn set(&mut self, activity: &Activity) -> Result<(), TransportError> {
        let mut assets = Assets::new().large_image(activity.large_image.as_str());
        if let Some(text) = &activity.large_text {
            assets = assets.large_text(text.as_str());
        }
        let mut payload = discord_rich_presence::activity::Activity::new()
            .activity_type(ActivityType::Listening)
            .details(activity.details.as_str())
            .assets(assets)
            .timestamps(
                Timestamps::new()
                    .start(activity.start_ms)
                    .end(activity.end_ms),
            );
        payload = match &activity.state {
            Some(state) => payload
                .state(state.as_str())
                .status_display_type(StatusDisplayType::State),
            None => payload.status_display_type(StatusDisplayType::Name),
        };
        self.client()?.set_activity(payload).map_err(gone)?;
        self.answer()
    }

    fn clear(&mut self) -> Result<(), TransportError> {
        self.client()?.clear_activity().map_err(gone)?;
        self.answer()
    }

    fn close(&mut self) {
        if let Some(mut client) = self.client.take() {
            let _ = client.close();
        }
    }
}

/// One thing a [`FakeTransport`] was asked to do.
#[cfg(test)]
#[derive(Debug, Clone, PartialEq)]
pub enum Call {
    Connect,
    Set(Activity),
    Clear,
    Close,
}

/// Records every call, and fails the ones it is told to.
#[cfg(test)]
#[derive(Clone, Default)]
pub struct FakeTransport {
    calls: std::sync::Arc<std::sync::Mutex<Vec<Call>>>,
    /// Whether Discord is running: off, every connect fails and every write
    /// after it breaks the pipe.
    absent: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

#[cfg(test)]
impl FakeTransport {
    pub fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }

    pub fn forget(&self) {
        self.calls.lock().unwrap().clear();
    }

    pub fn set_absent(&self, absent: bool) {
        self.absent
            .store(absent, std::sync::atomic::Ordering::SeqCst);
    }

    fn record(&self, call: Call) -> Result<(), TransportError> {
        self.calls.lock().unwrap().push(call);
        if self.absent.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(TransportError::Gone("no pipe".to_owned()));
        }
        Ok(())
    }
}

#[cfg(test)]
impl Transport for FakeTransport {
    fn connect(&mut self) -> Result<(), TransportError> {
        self.record(Call::Connect)
    }

    fn set(&mut self, activity: &Activity) -> Result<(), TransportError> {
        self.record(Call::Set(activity.clone()))
    }

    fn clear(&mut self) -> Result<(), TransportError> {
        self.record(Call::Clear)
    }

    fn close(&mut self) {
        self.calls.lock().unwrap().push(Call::Close);
    }
}
