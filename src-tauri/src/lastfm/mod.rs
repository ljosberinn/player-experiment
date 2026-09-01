//! last.fm scrobbling.
//!
//! Opt-in, off by default, and inert with no account connected - with no
//! session key stored, nothing here opens a socket. See
//! `docs/plans/lastfm.md` for the decisions this shape comes from; the two
//! that explain most of it are that [`transport::Transport`] is the only thing
//! that touches the network, and that the session key is stored **unencrypted**
//! and labelled as such rather than obscured behind a constant compiled into
//! the binary.
//!
//! This module holds the vocabulary the rest of the feature shares: the error
//! taxonomy, and the one function that turns a response body into either a
//! value or one of those errors.

pub mod auth;
pub mod sign;
pub mod transport;

use crate::error::AppError;
use transport::TransportError;

/// The key pair this build was compiled with.
///
/// **The secret is extractable from the binary and there is no way around
/// that**: last.fm's model requires a desktop client to carry one, every
/// open-source client that scrobbles ships one, and obscuring it would only
/// change how long it takes to find. What limits the damage is that the secret
/// alone is useless - scrobbling needs a session key, which is per account and
/// revocable by its owner.
#[derive(Debug, Clone, Copy)]
pub struct Credentials {
    pub api_key: &'static str,
    pub api_secret: &'static str,
}

/// The credentials, if this build has any.
///
/// Compiled in from the environment, so a build made without them - every
/// local build and every CI run - has the feature **inert** rather than
/// broken: the settings pane says the build carries no key, and nothing offers
/// to connect. A key is needed to run the feature, not to test it.
pub fn credentials() -> Option<Credentials> {
    match (
        option_env!("APEX_LASTFM_API_KEY"),
        option_env!("APEX_LASTFM_API_SECRET"),
    ) {
        (Some(api_key), Some(api_secret)) if !api_key.is_empty() && !api_secret.is_empty() => {
            Some(Credentials {
                api_key,
                api_secret,
            })
        }
        _ => None,
    }
}

/// The full parameter list for one signed call.
///
/// Order matters only to [`sign::api_sig`], which sorts for itself, so the
/// list is built in the order that reads best. `api_sig` and `format` are
/// appended **after** signing: the first cannot sign itself and the second is
/// excluded by the spec.
pub fn signed<'a>(
    method: &'a str,
    credentials: &'a Credentials,
    extra: Vec<(&'a str, String)>,
) -> Vec<(&'a str, String)> {
    let mut params = vec![
        ("method", method.to_owned()),
        ("api_key", credentials.api_key.to_owned()),
    ];
    params.extend(extra);

    let signature = sign::api_sig(&params, credentials.api_secret);
    params.push(("api_sig", signature));
    params.push(("format", "json".to_owned()));
    params
}

/// The error numbers this code branches on.
///
/// Only the ones with different consequences are named; everything else is a
/// malformed request, and the answer to those is to stop rather than to
/// classify them. The full list is at <https://www.last.fm/api/errorcodes>.
pub mod code {
    /// The stored session key no longer works. The user revoked the
    /// application, or last.fm invalidated it. Forget it and ask again.
    pub const INVALID_SESSION_KEY: u32 = 9;
    /// The service is temporarily off. Retry.
    pub const SERVICE_OFFLINE: u32 = 11;
    /// During the browser trip: the user has not said yes yet. Poll again.
    pub const TOKEN_NOT_AUTHORIZED: u32 = 14;
    /// During the browser trip: the token is past its hour. Start over.
    pub const TOKEN_EXPIRED: u32 = 15;
    /// The service is temporarily unavailable. Retry.
    pub const SERVICE_UNAVAILABLE: u32 = 16;
    /// Rate limited.
    ///
    /// Absent from the retry list in last.fm's own scrobbling guide, which is
    /// a gap in their documentation rather than a claim that it is permanent:
    /// no published request budget exists, and the condition is plainly
    /// temporary. Treated as retryable, with backoff.
    pub const RATE_LIMITED: u32 = 29;
}

/// What a last.fm call can come back as, other than the answer.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Transport(#[from] TransportError),

    /// The API's own error envelope, which usually arrives with HTTP 200.
    #[error("last.fm error {code}: {message}")]
    Api { code: u32, message: String },

    /// A body that is not the envelope.
    ///
    /// Not a theoretical case: `track.scrobble` with too few parameters
    /// answers **HTTP 200** with the legacy `text/plain` line `FAILED
    /// Incorrect protocol version…`, ignoring `format=json` entirely. A parser
    /// that assumed JSON on a 200 would panic or silently succeed; this is
    /// where that lands instead.
    #[error("last.fm sent something this build cannot read: {0}")]
    Malformed(String),
}

impl Error {
    /// Whether making the same call later could work.
    ///
    /// The allowlist is deliberate and short. last.fm's guidance is to retry
    /// 11 and 16 only; 29 is added because it is transient and their omission
    /// of it is an oversight. **Everything else is a malformed request** -
    /// retrying a bad signature or an unknown method forever is how a client
    /// gets itself banned, and a body we cannot parse will not parse next time
    /// either.
    pub fn transient(&self) -> bool {
        match self {
            Self::Transport(error) => error.transient(),
            Self::Api { code, .. } => matches!(
                *code,
                code::SERVICE_OFFLINE | code::SERVICE_UNAVAILABLE | code::RATE_LIMITED
            ),
            Self::Malformed(_) => false,
        }
    }

    /// Whether the stored session key has stopped working, so the only way
    /// forward is to forget it and let the user connect again.
    pub fn needs_reconnect(&self) -> bool {
        matches!(
            self,
            Self::Api {
                code: code::INVALID_SESSION_KEY,
                ..
            }
        )
    }

    /// The API error number, for the two callers that branch on a specific one.
    pub fn api_code(&self) -> Option<u32> {
        match self {
            Self::Api { code, .. } => Some(*code),
            _ => None,
        }
    }
}

impl From<Error> for AppError {
    fn from(error: Error) -> Self {
        Self::Internal(error.to_string())
    }
}

/// Reads a response body into a value, or into the error it describes.
///
/// **HTTP 200 does not mean success**, so every body goes through here
/// regardless of status - last.fm says so outright, and the error envelope is
/// what a rejected call looks like.
pub fn parse(body: &str) -> Result<serde_json::Value, Error> {
    let value: serde_json::Value = serde_json::from_str(body).map_err(|_| {
        // The body, not the parser's complaint: what is worth knowing is what
        // last.fm sent, and the legacy failure line says so in words.
        Error::Malformed(first_line(body))
    })?;

    if let Some(code) = value.get("error").and_then(serde_json::Value::as_u64) {
        return Err(Error::Api {
            code: code as u32,
            message: value
                .get("message")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("no message")
                .to_owned(),
        });
    }

    Ok(value)
}

/// The first line of a body, trimmed and capped.
///
/// An unreadable body can be an entire HTML page from a captive portal, and
/// the whole of it would reach an error popover and a log line.
fn first_line(body: &str) -> String {
    const CAP: usize = 200;
    let line = body.lines().next().unwrap_or("").trim();
    if line.is_empty() {
        return "an empty response".to_owned();
    }
    match line.char_indices().nth(CAP) {
        Some((end, _)) => format!("{}…", &line[..end]),
        None => line.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_successful_body() {
        let value = parse(r#"{"session":{"name":"listener","key":"abc"}}"#).unwrap();
        assert_eq!(value["session"]["key"], "abc");
    }

    #[test]
    fn turns_the_error_envelope_into_an_error() {
        let error = parse(r#"{"error":6,"message":"Invalid parameters"}"#).unwrap_err();
        assert!(matches!(
            error,
            Error::Api {
                code: 6,
                ref message
            } if message == "Invalid parameters"
        ));
    }

    #[test]
    fn an_envelope_without_a_message_still_carries_its_code() {
        let error = parse(r#"{"error":29}"#).unwrap_err();
        assert_eq!(error.api_code(), Some(code::RATE_LIMITED));
    }

    #[test]
    fn survives_the_legacy_plain_text_two_hundred() {
        // The reply `track.scrobble` gives a request with too few parameters:
        // HTTP 200, `text/plain`, and `format=json` ignored. Nothing about the
        // status says the request failed.
        let error =
            parse("FAILED Incorrect protocol version. Please update your client.\n").unwrap_err();

        assert!(matches!(error, Error::Malformed(_)));
        assert!(error.to_string().contains("FAILED Incorrect protocol"));
        assert!(
            !error.transient(),
            "a malformed request is not worth a retry"
        );
    }

    #[test]
    fn an_unreadable_body_is_reported_by_its_first_line_and_capped() {
        let error = parse(&format!("<html>{}</html>\nmore", "x".repeat(500))).unwrap_err();
        // Enough to recognise, not enough to fill a popover with a web page.
        assert!(error.to_string().len() < 260, "{error}");
        assert!(!error.to_string().contains("more"));
    }

    #[test]
    fn an_empty_body_says_so_rather_than_reporting_nothing() {
        let error = parse("").unwrap_err();
        assert!(error.to_string().contains("an empty response"));
    }

    #[test]
    fn only_the_three_transient_codes_are_worth_retrying() {
        let api = |code| Error::Api {
            code,
            message: String::new(),
        };

        for code in [
            code::SERVICE_OFFLINE,
            code::SERVICE_UNAVAILABLE,
            code::RATE_LIMITED,
        ] {
            assert!(api(code).transient(), "{code} should be retried");
        }
        // Every other error is a request that will fail the same way forever:
        // 4 bad token, 6 bad parameters, 9 dead session key, 13 bad signature,
        // 26 suspended key.
        for code in [4, 6, code::INVALID_SESSION_KEY, 13, 26] {
            assert!(!api(code).transient(), "{code} should not be retried");
        }
    }

    #[test]
    fn a_dead_session_key_asks_for_a_reconnect_and_nothing_else_does() {
        let dead = Error::Api {
            code: code::INVALID_SESSION_KEY,
            message: "Invalid session key - Please re-authenticate".to_owned(),
        };
        assert!(dead.needs_reconnect());

        assert!(!Error::Api {
            code: code::RATE_LIMITED,
            message: String::new()
        }
        .needs_reconnect());
        assert!(!Error::Malformed("x".to_owned()).needs_reconnect());
    }

    #[test]
    fn an_unreachable_host_is_transient_and_carries_through_the_taxonomy() {
        let error = Error::from(TransportError::Unreachable("connection refused".to_owned()));
        assert!(error.transient());
        assert!(!error.needs_reconnect());
        assert_eq!(error.api_code(), None);
    }
}
