use crypto_box::SecretKey;
use ed25519_dalek::SigningKey;
use rand::rngs::OsRng;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum KeyError {
    #[error("File already exists: {0}")]
    AlreadyExists(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Insecure file permissions on {0}: group/world readable (mode {1:o})")]
    InsecurePermissions(String, u32),
}

/// Validates that a sensitive private key file has strict owner-only permissions (0600 on Unix).
pub fn verify_strict_permissions<P: AsRef<Path>>(path: P) -> Result<(), KeyError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let p = path.as_ref();
        let meta = std::fs::metadata(p)?;
        let mode = meta.permissions().mode();
        if mode & 0o077 != 0 {
            return Err(KeyError::InsecurePermissions(
                p.display().to_string(),
                mode & 0o777,
            ));
        }
    }
    Ok(())
}

/// Writes private key bytes with strict 0600 permissions, refusing to overwrite.
pub fn write_private_key<P: AsRef<Path>>(path: P, bytes: &[u8]) -> Result<(), KeyError> {
    let p = path.as_ref();
    if p.exists() {
        return Err(KeyError::AlreadyExists(p.display().to_string()));
    }

    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(p)?;
        file.write_all(bytes)?;
    }

    #[cfg(not(unix))]
    {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(p)?;
        file.write_all(bytes)?;
    }

    Ok(())
}

/// Writes public key bytes, refusing to overwrite.
pub fn write_public_key<P: AsRef<Path>>(path: P, bytes: &[u8]) -> Result<(), KeyError> {
    let p = path.as_ref();
    if p.exists() {
        return Err(KeyError::AlreadyExists(p.display().to_string()));
    }

    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(p)?;
    file.write_all(bytes)?;
    Ok(())
}

pub struct GeneratedKeys {
    pub vendor_private: [u8; 32],
    pub vendor_public: [u8; 32],
    pub escrow_private: [u8; 32],
    pub escrow_public: [u8; 32],
}

pub fn generate_keypairs() -> GeneratedKeys {
    let mut rng = OsRng;
    let vendor_sk = SigningKey::generate(&mut rng);
    let vendor_pk = vendor_sk.verifying_key();

    let escrow_sk = SecretKey::generate(&mut rng);
    let escrow_pk = escrow_sk.public_key();

    GeneratedKeys {
        vendor_private: vendor_sk.to_bytes(),
        vendor_public: vendor_pk.to_bytes(),
        escrow_private: escrow_sk.to_bytes(),
        escrow_public: *escrow_pk.as_bytes(),
    }
}
