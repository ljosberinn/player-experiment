//! The seam between the tag sources and the network.
//!
//! The same arrangement [`crate::lastfm::transport`] makes for last.fm, for
//! the same reason: one place opens a socket, behind a trait, so that every
//! rule above it - what to search for, how to read a tracklist, what a
//! candidate scores - is tested against a fake on a runner with no network.
//!
//! A separate trait rather than last.fm's. That one is a form-encoded POST to
//! a single root, because that is the only shape its API has; MusicBrainz and
//! the Cover Art Archive are GETs against two different hosts, one of which
//! answers with an image. Widening one trait to cover both would leave every
//! caller passing arguments the other half ignores.
//!
//! Synchronous, again like last.fm's: the callers are Tauri commands that
//! already run on a worker thread, so a blocking call costs no runtime and no
//! `async` colouring.

use std::time::Duration;

/// What this build calls itself.
///
/// MusicBrainz requires an application, a version and a contact, and refuses
/// or throttles clients that send a generic one. The contact is the repository
/// from the manifest rather than a person's address - it is where a report
/// about this client's traffic belongs.
pub const USER_AGENT: &str = concat!(
    env!("CARGO_PKG_NAME"),
    "/",
    env!("CARGO_PKG_VERSION"),
    " ( ",
    env!("CARGO_PKG_REPOSITORY"),
    " )"
);

/// How long a call may take before it counts as unreachable.
///
/// Shorter than the scrobbler's twenty seconds: a person is watching a dialog
/// that says "Searching…", and a minute of that is worse than being told the
/// lookup did not work.
const TIMEOUT: Duration = Duration::from_secs(15);

/// A request that produced nothing worth parsing.
///
/// A 404 is not here: for a release it means the id is wrong and for a cover
/// it means there is none, and both are answers rather than failures. It
/// arrives as `Ok(None)`.
#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    /// No answer: no route, DNS failure, TLS failure, timeout, refused.
    #[error("could not reach {host}: {message}")]
    Unreachable { host: String, message: String },
    /// An answer from something that is not the API - a gateway, a captive
    /// portal, a 5xx page - or a 503, which is how MusicBrainz says the rate
    /// limit was exceeded.
    #[error("{host} answered with HTTP {status}")]
    Server { host: String, status: u16 },
}

impl TransportError {
    /// Whether the same request could work later.
    pub fn transient(&self) -> bool {
        match self {
            Self::Unreachable { .. } => true,
            Self::Server { .. } => true,
        }
    }
}

/// What a [`Transport`] hands back: a body, or nothing for a 404.
pub type Fetched = Result<Option<Vec<u8>>, TransportError>;

/// Somewhere a GET can be sent.
///
/// `Sync` as well as `Send`, unlike last.fm's: a release and its cover are
/// fetched at the same time from two threads that share one transport, which
/// is the whole point of the Cover Art Archive having no rate limit.
///
/// The body comes back as bytes rather than a `String` because one of the two
/// callers is fetching a JPEG.
pub trait Transport: Send + Sync {
    /// One GET, resolving to the body, or to `None` for a 404.
    ///
    /// Parameters are handed over rather than interpolated into `url` so that
    /// the encoding is the HTTP client's business - a Lucene query is full of
    /// quotes and spaces, and a hand-rolled encoder is where those go wrong.
    fn get(&self, url: &str, params: &[(&str, String)]) -> Fetched;
}

/// The one implementation that uses the network.
pub struct HttpTransport {
    client: reqwest::blocking::Client,
}

impl HttpTransport {
    pub fn new(user_agent: &str) -> Result<Self, TransportError> {
        let client = reqwest::blocking::Client::builder()
            .timeout(TIMEOUT)
            .user_agent(user_agent)
            // The Cover Art Archive answers with a redirect to the storage
            // host it actually keeps the image on, so following redirects is
            // not optional here.
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .map_err(|e| TransportError::Unreachable {
                host: "the network".to_owned(),
                message: e.to_string(),
            })?;
        Ok(Self { client })
    }
}

/// The host part of a URL, for an error a person reads.
fn host_of(url: &str) -> String {
    url.split("://")
        .nth(1)
        .and_then(|rest| rest.split('/').next())
        .unwrap_or(url)
        .to_owned()
}

impl Transport for HttpTransport {
    fn get(&self, url: &str, params: &[(&str, String)]) -> Fetched {
        let response =
            self.client
                .get(url)
                .query(params)
                .send()
                .map_err(|e| TransportError::Unreachable {
                    host: host_of(url),
                    message: e.to_string(),
                })?;

        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !status.is_success() {
            return Err(TransportError::Server {
                host: host_of(url),
                status: status.as_u16(),
            });
        }

        response
            .bytes()
            .map(|bytes| Some(bytes.to_vec()))
            .map_err(|e| TransportError::Unreachable {
                host: host_of(url),
                message: e.to_string(),
            })
    }
}

/// The one client the app looks releases up through.
///
/// Built once, for the reason every connection pool is: a lookup is a search
/// followed by a fetch followed by a cover, three round trips to two hosts,
/// and a client per call would open a fresh TLS session for each.
pub fn shared() -> Option<&'static HttpTransport> {
    static SHARED: std::sync::OnceLock<Option<HttpTransport>> = std::sync::OnceLock::new();
    SHARED
        .get_or_init(|| HttpTransport::new(USER_AGENT).ok())
        .as_ref()
}

/// One recorded request: the URL it went to and the parameters it carried.
#[cfg(test)]
#[derive(Clone, Debug)]
pub struct Call {
    pub url: String,
    pub params: Vec<(String, String)>,
}

#[cfg(test)]
impl Call {
    pub fn param(&self, name: &str) -> Option<&str> {
        self.params
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }
}

/// A [`Transport`] that answers by URL and remembers what it was asked.
///
/// Keyed on a substring of the URL rather than on call order, because the two
/// hosts are deliberately called at the same time: a script in order would be
/// asserting a race.
#[cfg(test)]
#[derive(Default)]
pub struct FakeTransport {
    answers: Vec<(String, Fetched)>,
    calls: std::sync::Mutex<Vec<Call>>,
    /// Whether a URL matching nothing is a 404 rather than a panic. Off by
    /// default: an unplanned call is a fact worth failing on.
    lenient: bool,
}

#[cfg(test)]
impl FakeTransport {
    pub fn new() -> Self {
        Self::default()
    }

    /// Answers every URL containing `needle` with `body`.
    pub fn answering(mut self, needle: &str, body: &str) -> Self {
        self.answers
            .push((needle.to_owned(), Ok(Some(body.as_bytes().to_vec()))));
        self
    }

    pub fn answering_bytes(mut self, needle: &str, body: &[u8]) -> Self {
        self.answers
            .push((needle.to_owned(), Ok(Some(body.to_vec()))));
        self
    }

    /// Answers every URL containing `needle` with a 404.
    pub fn missing(mut self, needle: &str) -> Self {
        self.answers.push((needle.to_owned(), Ok(None)));
        self
    }

    pub fn failing(mut self, needle: &str, error: TransportError) -> Self {
        self.answers.push((needle.to_owned(), Err(error)));
        self
    }

    /// Turns unplanned URLs into 404s instead of panics.
    pub fn lenient(mut self) -> Self {
        self.lenient = true;
        self
    }

    pub fn calls(&self) -> Vec<Call> {
        self.calls.lock().expect("the fake transport's log").clone()
    }

    pub fn call_count(&self) -> usize {
        self.calls.lock().expect("the fake transport's log").len()
    }

    /// The one call whose URL contains `needle`, for assertions about what was
    /// asked rather than about how many times.
    pub fn call_to(&self, needle: &str) -> Option<Call> {
        self.calls()
            .into_iter()
            .find(|call| call.url.contains(needle))
    }
}

#[cfg(test)]
impl Transport for FakeTransport {
    fn get(&self, url: &str, params: &[(&str, String)]) -> Fetched {
        self.calls
            .lock()
            .expect("the fake transport's log")
            .push(Call {
                url: url.to_owned(),
                params: params
                    .iter()
                    .map(|(name, value)| ((*name).to_owned(), value.clone()))
                    .collect(),
            });

        match self
            .answers
            .iter()
            .find(|(needle, _)| url.contains(needle.as_str()))
        {
            Some((_, Ok(body))) => Ok(body.clone()),
            Some((_, Err(TransportError::Unreachable { host, message }))) => {
                Err(TransportError::Unreachable {
                    host: host.clone(),
                    message: message.clone(),
                })
            }
            Some((_, Err(TransportError::Server { host, status }))) => {
                Err(TransportError::Server {
                    host: host.clone(),
                    status: *status,
                })
            }
            None if self.lenient => Ok(None),
            None => panic!("the fake transport was asked for {url}, which it has no answer for"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The header MusicBrainz blocks clients over, asserted here rather than
    /// at a call site because it is set once, in the client, and nowhere else.
    #[test]
    fn the_user_agent_names_the_app_its_version_and_where_to_complain() {
        assert!(USER_AGENT.starts_with("apex/"));
        assert!(USER_AGENT.contains(env!("CARGO_PKG_VERSION")));
        assert!(USER_AGENT.contains("https://"));
    }

    #[test]
    fn the_fake_answers_by_url_and_records_what_it_was_asked() {
        let transport = FakeTransport::new()
            .answering("musicbrainz.org", "{}")
            .missing("coverartarchive.org");

        assert_eq!(
            transport
                .get(
                    "https://musicbrainz.org/ws/2/release",
                    &[("fmt", "json".to_owned())]
                )
                .unwrap(),
            Some(b"{}".to_vec())
        );
        assert_eq!(
            transport
                .get("https://coverartarchive.org/release/x/front-500", &[])
                .unwrap(),
            None
        );

        assert_eq!(transport.call_count(), 2);
        assert_eq!(
            transport.call_to("musicbrainz").unwrap().param("fmt"),
            Some("json")
        );
    }

    #[test]
    fn a_host_is_pulled_out_of_a_url_for_the_message() {
        assert_eq!(
            host_of("https://musicbrainz.org/ws/2/release"),
            "musicbrainz.org"
        );
        assert_eq!(host_of("not a url"), "not a url");
    }

    #[test]
    fn both_ways_of_failing_are_worth_trying_again() {
        assert!(TransportError::Unreachable {
            host: "musicbrainz.org".to_owned(),
            message: "refused".to_owned()
        }
        .transient());
        assert!(TransportError::Server {
            host: "musicbrainz.org".to_owned(),
            status: 503
        }
        .transient());
    }

    /// The counterpart to last.fm's one socket-opening test, and it earns its
    /// keep the same way: everything above `Transport` runs against the fake,
    /// which would go on passing while the real client sent its parameters in
    /// the wrong place or turned a 404 into an error.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_real_round_trip_sends_the_agent_and_the_query() {
        use wiremock::matchers::{header, method, path, query_param};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/ws/2/release"))
            .and(header("user-agent", USER_AGENT))
            .and(query_param("fmt", "json"))
            .and(query_param("query", r#"release:"Loveless""#))
            .respond_with(ResponseTemplate::new(200).set_body_string(r#"{"releases":[]}"#))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/release/nothing/front-500"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;

        let base = server.uri();
        let (found, missing) = tokio::task::spawn_blocking(move || {
            let transport = HttpTransport::new(USER_AGENT).unwrap();
            let found = transport.get(
                &format!("{base}/ws/2/release"),
                &[
                    ("fmt", "json".to_owned()),
                    ("query", r#"release:"Loveless""#.to_owned()),
                ],
            );
            let missing = transport.get(&format!("{base}/release/nothing/front-500"), &[]);
            (found, missing)
        })
        .await
        .unwrap();

        assert_eq!(found.unwrap(), Some(br#"{"releases":[]}"#.to_vec()));
        assert_eq!(missing.unwrap(), None, "a 404 is an answer, not a failure");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_rate_limit_reply_is_a_server_error_rather_than_a_body() {
        use wiremock::matchers::method;
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(503).set_body_string("rate limit exceeded"))
            .mount(&server)
            .await;

        let base = server.uri();
        let error = tokio::task::spawn_blocking(move || {
            HttpTransport::new(USER_AGENT)
                .unwrap()
                .get(&format!("{base}/ws/2/release"), &[])
        })
        .await
        .unwrap()
        .expect_err("503 is not an answer to parse");

        assert!(matches!(error, TransportError::Server { status: 503, .. }));
    }
}
