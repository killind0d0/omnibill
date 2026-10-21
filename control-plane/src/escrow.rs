use crate::keys::verify_strict_permissions;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use crypto_box::{PublicKey, SecretKey};
use rand::rngs::OsRng;
use std::fs;
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum EscrowError {
    #[error("Base64 decode error: {0}")]
    Base64(#[from] base64::DecodeError),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Key error: {0}")]
    Key(#[from] crate::keys::KeyError),
    #[error("Invalid secret key length: expected 32 bytes, got {0}")]
    InvalidKeyLength(usize),
    #[error("Decryption / unseal failed")]
    UnsealFailed,
}

/// Unseals a base64-encoded encrypted blob using the given 32-byte X25519 escrow private key.
/// Returns the 64-character lowercase hex string of the decrypted DEK.
pub fn unseal_dek(blob_b64: &str, secret_key_bytes: &[u8; 32]) -> Result<String, EscrowError> {
    let ciphertext = BASE64.decode(blob_b64.trim())?;
    let secret_key = SecretKey::from(*secret_key_bytes);

    let decrypted = secret_key
        .unseal(&ciphertext)
        .map_err(|_| EscrowError::UnsealFailed)?;

    let mut hex = String::with_capacity(decrypted.len() * 2);
    for byte in decrypted {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{:02x}", byte);
    }
    Ok(hex)
}

/// Unseals a base64-encoded blob using a private key file, enforcing strict owner-only permissions.
pub fn unseal_dek_from_file<P: AsRef<Path>>(
    blob_b64: &str,
    key_file_path: P,
) -> Result<String, EscrowError> {
    let p = key_file_path.as_ref();
    verify_strict_permissions(p)?;

    let key_bytes = fs::read(p)?;
    if key_bytes.len() != 32 {
        return Err(EscrowError::InvalidKeyLength(key_bytes.len()));
    }

    let mut arr = [0u8; 32];
    arr.copy_from_slice(&key_bytes);
    unseal_dek(blob_b64, &arr)
}

/// Seals a 32-byte DEK to the escrow public key using NaCl sealed box.
pub fn seal_dek(dek: &[u8; 32], escrow_public_bytes: &[u8; 32]) -> Result<String, EscrowError> {
    let pk = PublicKey::from(*escrow_public_bytes);
    let mut rng = OsRng;
    let sealed = pk
        .seal(&mut rng, dek.as_slice())
        .map_err(|_| EscrowError::UnsealFailed)?;
    Ok(BASE64.encode(sealed))
}
