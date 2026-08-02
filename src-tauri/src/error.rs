use serde::{Serialize, Serializer};

/// Every error that can cross the IPC boundary.
///
/// Variants are added as the domain modules land; the frontend only ever sees
/// the `Display` string, so adding a variant is never a breaking change for it.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Internal(String),

    /// The thing asked for is not there - as distinct from something going
    /// wrong while looking for it.
    #[error("{0}")]
    NotFound(String),

    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("{path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
}

impl AppError {
    pub fn io(path: impl std::fmt::Display, source: std::io::Error) -> Self {
        Self::Io {
            path: path.to_string(),
            source,
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_to_its_display_string() {
        let err = AppError::Internal("database is locked".into());
        assert_eq!(
            serde_json::to_string(&err).unwrap(),
            "\"database is locked\""
        );
    }
}
