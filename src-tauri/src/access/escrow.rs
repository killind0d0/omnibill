//! Database Encryption Key (DEK) Escrow Subsystem (Task L3C).
//!
//! Sealed boxes are used to securely encrypt the 256-bit DEK to the vendor's
//! offline escrow public key using NaCl sealed boxes (X25519 + Salsa20 + Poly1305).
//!
//! Functions used:
//! - `crypto_box::PublicKey::seal`
//! - `crypto_box::SecretKey::unseal`

use crypto_box::{PublicKey, SecretKey};
use rand_core::OsRng;
use std::fmt;

use super::dbkey::DbKey;

/// Vendor's offline escrow public key bundled into the binary.
pub static ESCROW_PUBLIC_KEY: &[u8; 32] = include_bytes!("../../keys/escrow_public.bin");

#[derive(Debug)]
pub enum EscrowError {
    Unconfigured,
    EncryptionFailed,
    DecryptionFailed,
    InvalidKeyLength,
}

impl fmt::Display for EscrowError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EscrowError::Unconfigured => write!(f, "Escrow public key is unconfigured"),
            EscrowError::EncryptionFailed => write!(f, "Failed to seal key in escrow box"),
            EscrowError::DecryptionFailed => write!(f, "Failed to unseal key from escrow box"),
            EscrowError::InvalidKeyLength => write!(f, "Invalid key length for escrow operation"),
        }
    }
}

impl std::error::Error for EscrowError {}

/// Checks whether the bundled escrow public key is configured (non-zero).
pub fn is_escrow_configured() -> bool {
    ESCROW_PUBLIC_KEY != &[0u8; 32]
}

/// Seals a 256-bit database key into an escrow blob sealed to the specified escrow public key.
pub fn seal_dek(dek: &DbKey, escrow_public: &[u8; 32]) -> Result<Vec<u8>, EscrowError> {
    if escrow_public == &[0u8; 32] {
        return Err(EscrowError::Unconfigured);
    }

    let pk = PublicKey::from(*escrow_public);
    pk.seal(&mut OsRng, &dek.0)
        .map_err(|_| EscrowError::EncryptionFailed)
}

/// Unseals an escrow blob using the corresponding escrow private key (used for vendor recovery / tests).
pub fn unseal_dek(ciphertext: &[u8], escrow_secret: &[u8; 32]) -> Result<DbKey, EscrowError> {
    let sk = SecretKey::from(*escrow_secret);
    let plaintext = sk
        .unseal(ciphertext)
        .map_err(|_| EscrowError::DecryptionFailed)?;

    if plaintext.len() != 32 {
        return Err(EscrowError::InvalidKeyLength);
    }

    let mut key_bytes = [0u8; 32];
    key_bytes.copy_from_slice(&plaintext);
    Ok(DbKey(key_bytes))
}
