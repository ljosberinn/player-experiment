//! The `api_sig` every authenticated last.fm call carries.
//!
//! Pure, and separated from everything that could send one, because this is
//! the part with a wrong implementation that looks right: the rule is
//! documented in one paragraph of [authspec §8](https://www.last.fm/api/authspec)
//! and gets three things wrong quietly - which parameters take part, what
//! order they go in, and that nothing separates them.

use md5::{Digest, Md5};

/// Parameters that take no part in the signature.
///
/// `format` and `callback` are excluded by the spec. Signing them produces a
/// signature the server rejects with error 13, which reads as a wrong secret
/// rather than as a wrong parameter list.
const UNSIGNED: [&str; 2] = ["format", "callback"];

/// The signature for a set of request parameters.
pub fn api_sig(params: &[(&str, String)], secret: &str) -> String {
    let digest = Md5::digest(signature_base(params, secret).as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The string that gets hashed.
///
/// Its own function so a test can assert the ordering rule directly: an md5 of
/// the wrong string is indistinguishable from an md5 of the right one, so a
/// test that only checks the hex would tell you *that* something is wrong and
/// never what.
///
/// The sort is by parameter name over raw bytes, which is what makes
/// `artist[10]` come before `artist[1]` - `'0'` is below `']'`. Every array
/// call is signed in an order that is not the order the parameters were built
/// in, and Rust's `str` ordering is byte-wise, so this is right by default and
/// would only break if someone reached for a "natural" or case-insensitive
/// comparison.
fn signature_base(params: &[(&str, String)], secret: &str) -> String {
    let mut signed: Vec<&(&str, String)> = params
        .iter()
        .filter(|(name, _)| !UNSIGNED.contains(name))
        .collect();
    signed.sort_by(|(left, _), (right, _)| left.as_bytes().cmp(right.as_bytes()));

    let mut base = String::new();
    for (name, value) in signed {
        // No separator of any kind, between pairs or within one.
        base.push_str(name);
        base.push_str(value);
    }
    base.push_str(secret);
    base
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(pairs: &[(&'static str, &str)]) -> Vec<(&'static str, String)> {
        pairs
            .iter()
            .map(|(name, value)| (*name, (*value).to_owned()))
            .collect()
    }

    #[test]
    fn sorts_by_name_concatenates_without_separators_and_appends_the_secret() {
        let base = signature_base(
            &params(&[("method", "auth.getSession"), ("api_key", "KEY")]),
            "SECRET",
        );
        assert_eq!(base, "api_keyKEYmethodauth.getSessionSECRET");
    }

    #[test]
    fn leaves_format_and_callback_out() {
        // Signing either is the failure this guards: the request still looks
        // well-formed and comes back as error 13, "invalid method signature",
        // which points at the secret instead of at the parameter list.
        let base = signature_base(
            &params(&[("format", "json"), ("callback", "cb"), ("api_key", "KEY")]),
            "SECRET",
        );
        assert_eq!(base, "api_keyKEYSECRET");
    }

    #[test]
    fn orders_array_parameters_by_ascii_so_ten_precedes_one() {
        // The mandatory vector. `artist[10]` sorts before `artist[1]` because
        // `'0'` (0x30) is below `']'` (0x5D) - a batch of ten or more
        // scrobbles signs in an order nothing about the code hints at, and
        // getting it wrong breaks exactly the batches that only occur after
        // the app has been offline.
        let base = signature_base(
            &params(&[
                ("artist[1]", "One"),
                ("artist[10]", "Ten"),
                ("artist[0]", "Zero"),
                ("method", "track.scrobble"),
                ("sk", "SESSION"),
                ("api_key", "APIKEY"),
                ("format", "json"),
            ]),
            "SECRET",
        );

        assert_eq!(
            base,
            "api_keyAPIKEYartist[0]Zeroartist[10]Tenartist[1]Onemethodtrack.scrobbleskSESSIONSECRET"
        );
    }

    #[test]
    fn hashes_to_lowercase_hex() {
        let signature = api_sig(
            &params(&[
                ("artist[1]", "One"),
                ("artist[10]", "Ten"),
                ("artist[0]", "Zero"),
                ("method", "track.scrobble"),
                ("sk", "SESSION"),
                ("api_key", "APIKEY"),
                ("format", "json"),
            ]),
            "SECRET",
        );

        assert_eq!(signature, "b3a09318a0adcdc7770bbec2ec0e107c");
        assert_eq!(signature.len(), 32);
    }

    #[test]
    fn hashes_the_utf8_bytes_of_a_value_rather_than_its_chars() {
        // Artist and title come from tags, so non-ASCII is the common case,
        // not the edge one. `Md5::digest` takes bytes and `String` is already
        // UTF-8, so this is right by construction - and the vector is here
        // because a future rewrite that reaches for `chars()` or a lossy
        // encoding would still pass every ASCII test above.
        let signature = api_sig(&params(&[("artist", "Björk"), ("title", "Jóga")]), "SECRET");
        assert_eq!(signature, "67b989b445ee070d79b4c62bcbdbf128");
    }

    #[test]
    fn an_empty_call_signs_the_secret_alone() {
        assert_eq!(signature_base(&[], "SECRET"), "SECRET");
    }
}
