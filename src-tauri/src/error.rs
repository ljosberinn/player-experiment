use serde::{Serialize, Serializer};

/// Every error that can cross the IPC boundary.
///
/// Variants are added as the domain modules land; the frontend only ever sees
/// the `Display` string, so adding a variant is never a breaking change for it.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Internal(String),
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
