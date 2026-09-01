//! Connecting an account: the browser token flow.
//!
//! Three steps, per [desktopauth](https://www.last.fm/api/desktopauth) and
//! [authspec §4](https://www.last.fm/api/authspec):
//!
//! 1. [`request_token`] asks for an unauthorized token, good for 60 minutes
//!    and one use.
//! 2. The user opens [`authorize_url`] in their own browser and says yes
//!    there.
//! 3. [`poll_session`] exchanges the token for a session key, answering
//!    [`Poll::NotYet`] until they have.
//!
//! **The password never enters this process.** It is typed on last.fm's own
//! page, so there is nothing to keep out of a log line or out of `crash.rs`,
//! which writes a panic payload verbatim. That is the whole reason this flow
//! was chosen over `auth.getMobileSession`, which documents its `password`
//! parameter as plain text.
//!
//! **No callback URL and no local HTTP listener.** `desktopauth` §1 mentions a
//! callback but no step of the desktop flow uses one - a genuine contradiction
//! in last.fm's own text, where the callback belongs to the *web* flow. Two of
//! eleven surveyed clients run a redirect server anyway; we do not.
//!
//! **The cadence of the poll is not here.** This module answers one attempt at
//! a time and the frontend decides how often to ask, so nothing in Rust sleeps
//! and the timing is testable against a mocked `ipc` like everything else.

use rusqlite::Connection;

use crate::db::settings;
use crate::error::AppResult;

use super::transport::Transport;
use super::{code, signed, Credentials, Error};

/// A connected account.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
    pub username: String,
    /// Non-expiring by default, and revoked by the user from last.fm's own
    /// settings screen. Error 9 at runtime is how this build finds out.
    pub key: String,
}

/// Whether the user has finished with the browser yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Poll {
    /// Error 14: the token exists and has not been authorized. Ask again.
    NotYet,
    Authorized(Session),
}

/// Step one: an unauthorized token.
pub fn request_token(
    transport: &dyn Transport,
    credentials: &Credentials,
) -> Result<String, Error> {
    let params = signed("auth.getToken", credentials, Vec::new());
    let body = transport.post(&params)?;
    super::parse(&body)?
        .get("token")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| Error::Malformed("a token request came back without a token".to_owned()))
}

/// Step two: where the user says yes.
///
/// Opened in the user's own browser by the frontend, which is also the only
/// place with the opener capability - and the capability names
/// `https://www.last.fm/*` explicitly rather than granting `opener:default`.
pub fn authorize_url(api_key: &str, token: &str) -> String {
    // Neither value can contain a character needing escaping: an API key is
    // hex and a token is hex. Percent-encoding them anyway would mean a URL
    // builder for a string with two known-safe substitutions.
    format!("https://www.last.fm/api/auth/?api_key={api_key}&token={token}")
}

/// Step three: the token for a session key, if the user has said yes.
pub fn poll_session(
    transport: &dyn Transport,
    credentials: &Credentials,
    token: &str,
) -> Result<Poll, Error> {
    let params = signed(
        "auth.getSession",
        credentials,
        vec![("token", token.to_owned())],
    );
    let body = transport.post(&params)?;

    let value = match super::parse(&body) {
        Ok(value) => value,
        // The one error that is not a failure: the browser tab is still open.
        Err(error) if error.api_code() == Some(code::TOKEN_NOT_AUTHORIZED) => {
            return Ok(Poll::NotYet)
        }
        Err(error) => return Err(error),
    };

    let session = &value["session"];
    match (
        session["name"].as_str(),
        session["key"].as_str().filter(|key| !key.is_empty()),
    ) {
        (Some(username), Some(key)) => Ok(Poll::Authorized(Session {
            username: username.to_owned(),
            key: key.to_owned(),
        })),
        _ => Err(Error::Malformed(
            "a session came back without a name and a key".to_owned(),
        )),
    }
}

/// The connected account, if there is one.
///
/// Both halves or neither: a key with no name would leave the status line with
/// nothing to say, and a name with no key would claim a connection that cannot
/// scrobble.
pub fn stored_session(conn: &Connection) -> AppResult<Option<Session>> {
    let key = settings::get(conn, settings::LASTFM_SESSION_KEY)?;
    let username = settings::get(conn, settings::LASTFM_USERNAME)?;
    Ok(match (username, key) {
        (Some(username), Some(key)) if !key.is_empty() => Some(Session { username, key }),
        _ => None,
    })
}

pub fn store_session(conn: &Connection, session: &Session) -> AppResult<()> {
    settings::set(conn, settings::LASTFM_SESSION_KEY, &session.key)?;
    settings::set(conn, settings::LASTFM_USERNAME, &session.username)
}

/// Forgets the account.
///
/// Emptied rather than deleted, so the row keeps existing and a later connect
/// updates it. `stored_session` reads an empty key as no account.
pub fn forget_session(conn: &Connection) -> AppResult<()> {
    settings::set(conn, settings::LASTFM_SESSION_KEY, "")?;
    settings::set(conn, settings::LASTFM_USERNAME, "")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::lastfm::transport::{FakeTransport, TransportError};

    const CREDENTIALS: Credentials = Credentials {
        api_key: "KEY",
        api_secret: "SECRET",
    };

    fn conn() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        (dir, conn)
    }

    #[test]
    fn a_token_request_is_signed_and_asks_for_json() {
        let transport = FakeTransport::always(r#"{"token":"abc123"}"#);

        assert_eq!(request_token(&transport, &CREDENTIALS).unwrap(), "abc123");

        assert_eq!(
            transport.param(0, "method").as_deref(),
            Some("auth.getToken")
        );
        assert_eq!(transport.param(0, "api_key").as_deref(), Some("KEY"));
        assert_eq!(transport.param(0, "format").as_deref(), Some("json"));
        // `api_key` and `method` only, signed - which is the vector
        // `sign::tests` asserts the base of.
        assert_eq!(
            transport.param(0, "api_sig"),
            Some(crate::lastfm::sign::api_sig(
                &[
                    ("method", "auth.getToken".to_owned()),
                    ("api_key", "KEY".to_owned())
                ],
                "SECRET"
            ))
        );
    }

    #[test]
    fn the_signature_does_not_cover_itself_or_the_format() {
        let transport = FakeTransport::always(r#"{"token":"abc123"}"#);
        request_token(&transport, &CREDENTIALS).unwrap();

        let call = &transport.calls()[0];
        let names: Vec<&str> = call.iter().map(|(name, _)| name.as_str()).collect();
        // Present in the request, and the last two, because they are added
        // after the signature is computed over everything before them.
        assert_eq!(&names[names.len() - 2..], &["api_sig", "format"]);
    }

    #[test]
    fn the_authorize_url_carries_the_key_and_the_token() {
        assert_eq!(
            authorize_url("KEY", "abc123"),
            "https://www.last.fm/api/auth/?api_key=KEY&token=abc123"
        );
    }

    #[test]
    fn a_token_the_user_has_not_authorized_yet_says_to_ask_again() {
        // Error 14 is the only failure that is not one. Reporting it would put
        // "token has not been authorized" in front of a user who is still
        // looking at the browser tab it is telling them to use.
        let transport =
            FakeTransport::always(r#"{"error":14,"message":"This token has not been authorized"}"#);

        assert_eq!(
            poll_session(&transport, &CREDENTIALS, "abc123").unwrap(),
            Poll::NotYet
        );
    }

    #[test]
    fn an_authorized_token_comes_back_as_a_session() {
        let transport =
            FakeTransport::always(r#"{"session":{"name":"listener","key":"sk-1","subscriber":0}}"#);

        assert_eq!(
            poll_session(&transport, &CREDENTIALS, "abc123").unwrap(),
            Poll::Authorized(Session {
                username: "listener".to_owned(),
                key: "sk-1".to_owned(),
            })
        );
        assert_eq!(transport.param(0, "token").as_deref(), Some("abc123"));
    }

    #[test]
    fn an_expired_token_surfaces_rather_than_polling_forever() {
        let transport = FakeTransport::always(r#"{"error":15,"message":"This token has expired"}"#);

        let error = poll_session(&transport, &CREDENTIALS, "abc123").unwrap_err();
        assert_eq!(error.api_code(), Some(code::TOKEN_EXPIRED));
        assert!(!error.transient(), "asking again cannot unexpire a token");
    }

    #[test]
    fn a_session_missing_half_of_itself_is_malformed_rather_than_stored() {
        let transport = FakeTransport::always(r#"{"session":{"name":"listener"}}"#);

        assert!(matches!(
            poll_session(&transport, &CREDENTIALS, "abc123").unwrap_err(),
            Error::Malformed(_)
        ));
    }

    #[test]
    fn a_poll_that_never_reaches_the_network_reports_it_as_transient() {
        let transport =
            FakeTransport::always_failing(TransportError::Unreachable("refused".to_owned()));

        let error = poll_session(&transport, &CREDENTIALS, "abc123").unwrap_err();
        assert!(error.transient());
    }

    #[test]
    fn a_session_round_trips_and_disconnecting_forgets_it() {
        let (_dir, conn) = conn();
        assert_eq!(stored_session(&conn).unwrap(), None);

        let session = Session {
            username: "listener".to_owned(),
            key: "sk-1".to_owned(),
        };
        store_session(&conn, &session).unwrap();
        assert_eq!(stored_session(&conn).unwrap(), Some(session));

        forget_session(&conn).unwrap();
        assert_eq!(stored_session(&conn).unwrap(), None);
    }

    #[test]
    fn half_a_stored_session_is_no_session() {
        // A key with no name has nothing to show in the status line, and a
        // name with no key claims a connection that cannot scrobble. Both are
        // what a half-finished write leaves behind.
        let (_dir, conn) = conn();

        settings::set(&conn, settings::LASTFM_SESSION_KEY, "sk-1").unwrap();
        assert_eq!(stored_session(&conn).unwrap(), None);

        settings::set(&conn, settings::LASTFM_SESSION_KEY, "").unwrap();
        settings::set(&conn, settings::LASTFM_USERNAME, "listener").unwrap();
        assert_eq!(stored_session(&conn).unwrap(), None);
    }

    #[test]
    fn a_stored_session_key_never_reaches_an_export() {
        // The one guard this feature has about not leaking rather than about
        // working. `settings::EXPORTABLE` is an allowlist written before the
        // feature existed, so this passes by construction - which is the point,
        // and is why it is asserted against the real writer rather than against
        // the list.
        let (_dir, conn) = conn();
        store_session(
            &conn,
            &Session {
                username: "listener".to_owned(),
                key: "super-secret".to_owned(),
            },
        )
        .unwrap();

        let exported = settings::exportable(&conn).unwrap();
        assert!(
            !exported
                .iter()
                .any(|(_, value)| value.contains("super-secret")),
            "the session key reached an export: {exported:?}"
        );
        assert!(!exported.iter().any(
            |(key, _)| key == settings::LASTFM_SESSION_KEY || key == settings::LASTFM_USERNAME
        ));
    }
}
