use std::{borrow::Cow, num::NonZeroU32};

use base64::{Engine, engine::general_purpose::STANDARD};
use hmac::{Hmac, Mac};
use rand::{TryRngCore, rngs::OsRng};
use sha2::{Digest, Sha256};

pub(super) fn scram_iterations(value: Option<&str>) -> Result<NonZeroU32, sqlx::Error> {
    value
        .unwrap_or("4096")
        .parse()
        .map_err(|_| sqlx::Error::Protocol("Invalid PostgreSQL SCRAM iteration setting".into()))
}

pub(super) fn postgres_password_verifier(
    password: &str,
    iterations: NonZeroU32,
) -> Result<String, sqlx::Error> {
    let mut salt = [0u8; 16];
    OsRng
        .try_fill_bytes(&mut salt)
        .map_err(|_| sqlx::Error::Protocol("Unable to obtain password salt entropy".into()))?;
    Ok(verifier_with_salt(password, &salt, iterations))
}

fn verifier_with_salt(password: &str, salt: &[u8; 16], iterations: NonZeroU32) -> String {
    // PostgreSQL falls back to the original bytes when SASLprep rejects a password.
    let normalized = stringprep::saslprep(password).unwrap_or(Cow::Borrowed(password));
    let mut salted_password = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(
        normalized.as_bytes(),
        salt,
        iterations.get(),
        &mut salted_password,
    );
    let mut client =
        Hmac::<Sha256>::new_from_slice(&salted_password).expect("HMAC accepts a 32-byte key");
    client.update(b"Client Key");
    let stored_key = Sha256::digest(client.finalize().into_bytes());
    let mut server =
        Hmac::<Sha256>::new_from_slice(&salted_password).expect("HMAC accepts a 32-byte key");
    server.update(b"Server Key");
    let server_key = server.finalize().into_bytes();
    format!(
        "SCRAM-SHA-256${}:{}${}:{}",
        iterations.get(),
        STANDARD.encode(salt),
        STANDARD.encode(stored_key),
        STANDARD.encode(server_key),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_independent_pbkdf2_hmac_vector() {
        let salt = std::array::from_fn(|i| i as u8);
        assert_eq!(
            verifier_with_salt("pencil", &salt, scram_iterations(None).unwrap()),
            "SCRAM-SHA-256$4096:AAECAwQFBgcICQoLDA0ODw==$zHCdol2044/ZyWzPLi7oxApCkamKw9Z+E4U/QApd/5Y=:dd5peBOitVnLNFu7VmwP+HiDaaw4OUCv396eVCWhYiE="
        );
    }

    #[test]
    fn uses_fresh_salt_and_does_not_embed_the_password() {
        let password = "synthetic-password-with'quote-and\\backslash";
        let first = postgres_password_verifier(password, scram_iterations(None).unwrap()).unwrap();
        let second = postgres_password_verifier(password, scram_iterations(None).unwrap()).unwrap();
        assert_ne!(first, second);
        assert!(!first.contains(password));
        assert!(first.starts_with("SCRAM-SHA-256$4096:"));
        assert!(!first.contains(['\'', '\\']));
    }

    #[test]
    fn follows_postgres_saslprep_normalization_and_fallback() {
        let salt = [7; 16];
        assert_eq!(
            verifier_with_salt("I\u{00ad}X", &salt, scram_iterations(None).unwrap()),
            verifier_with_salt("IX", &salt, scram_iterations(None).unwrap()),
        );
        assert_eq!(
            verifier_with_salt("\u{2168}", &salt, scram_iterations(None).unwrap()),
            verifier_with_salt("IX", &salt, scram_iterations(None).unwrap()),
        );
        assert!(stringprep::saslprep("bad\u{0007}password").is_err());
        assert_ne!(
            verifier_with_salt(
                "bad\u{0007}password",
                &salt,
                scram_iterations(None).unwrap()
            ),
            verifier_with_salt("badpassword", &salt, scram_iterations(None).unwrap()),
        );
    }

    #[test]
    fn honors_server_iteration_setting_and_rejects_invalid_values() {
        let salt = std::array::from_fn(|i| i as u8);
        assert_eq!(scram_iterations(None).unwrap().get(), 4096);
        let iterations = scram_iterations(Some("8192")).unwrap();
        assert_eq!(iterations.get(), 8192);
        assert_eq!(
            verifier_with_salt("pencil", &salt, iterations),
            "SCRAM-SHA-256$8192:AAECAwQFBgcICQoLDA0ODw==$eI1E9qPUhOYZx05jCoqauAhM1bqykROi3uxPdU5871c=:a+NNdjY/qhkGdh1UQ0YE5zldslVJ0rA1ipdr9lbCgBU="
        );
        for invalid in ["0", "-1", "invalid", "4294967296"] {
            assert!(scram_iterations(Some(invalid)).is_err());
        }
    }
}
