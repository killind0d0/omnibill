use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CursorError {
    InvalidCursor,
    CursorMismatch,
    JsonError(String),
}

impl std::fmt::Display for CursorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CursorError::InvalidCursor => write!(f, "Invalid cursor string"),
            CursorError::CursorMismatch => {
                write!(f, "Cursor does not match current sort specification")
            }
            CursorError::JsonError(s) => write!(f, "Cursor JSON error: {}", s),
        }
    }
}

impl std::error::Error for CursorError {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CursorVal {
    Int(i64),
    Str(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorPayload {
    pub spec_hash: u64,
    pub sort_values: Vec<CursorVal>,
    pub id: String,
}

const B64_CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

pub fn base64url_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() * 4).div_ceil(3));
    let mut i = 0;
    while i < data.len() {
        let b0 = data[i];
        let b1 = if i + 1 < data.len() { data[i + 1] } else { 0 };
        let b2 = if i + 2 < data.len() { data[i + 2] } else { 0 };

        let triple = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);

        out.push(B64_CHARS[((triple >> 18) & 0x3F) as usize] as char);
        out.push(B64_CHARS[((triple >> 12) & 0x3F) as usize] as char);

        if i + 1 < data.len() {
            out.push(B64_CHARS[((triple >> 6) & 0x3F) as usize] as char);
        }
        if i + 2 < data.len() {
            out.push(B64_CHARS[(triple & 0x3F) as usize] as char);
        }
        i += 3;
    }
    out
}

pub fn base64url_decode(s: &str) -> Result<Vec<u8>, CursorError> {
    let mut table = [0xFFu8; 256];
    for (idx, &c) in B64_CHARS.iter().enumerate() {
        table[c as usize] = idx as u8;
    }
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity((bytes.len() * 3) / 4);
    let mut i = 0;
    while i < bytes.len() {
        let remaining = bytes.len() - i;
        if remaining == 1 {
            return Err(CursorError::InvalidCursor);
        }
        let c0 = table[bytes[i] as usize];
        let c1 = table[bytes[i + 1] as usize];
        if c0 == 0xFF || c1 == 0xFF {
            return Err(CursorError::InvalidCursor);
        }

        let b0 = (c0 << 2) | (c1 >> 4);
        out.push(b0);

        if remaining > 2 {
            let c2 = table[bytes[i + 2] as usize];
            if c2 == 0xFF {
                return Err(CursorError::InvalidCursor);
            }
            let b1 = ((c1 & 0x0F) << 4) | (c2 >> 2);
            out.push(b1);

            if remaining > 3 {
                let c3 = table[bytes[i + 3] as usize];
                if c3 == 0xFF {
                    return Err(CursorError::InvalidCursor);
                }
                let b2 = ((c2 & 0x03) << 6) | c3;
                out.push(b2);
            }
        }
        i += if remaining >= 4 { 4 } else { remaining };
    }
    Ok(out)
}

pub fn encode_cursor(
    sort_values: Vec<CursorVal>,
    id: &str,
    spec_hash: u64,
) -> Result<String, CursorError> {
    let payload = CursorPayload {
        spec_hash,
        sort_values,
        id: id.to_string(),
    };
    let json_bytes =
        serde_json::to_vec(&payload).map_err(|e| CursorError::JsonError(e.to_string()))?;
    Ok(base64url_encode(&json_bytes))
}

pub fn decode_cursor(
    cursor_str: &str,
    expected_spec_hash: u64,
) -> Result<(Vec<CursorVal>, String), CursorError> {
    let bytes = base64url_decode(cursor_str)?;
    let payload: CursorPayload =
        serde_json::from_slice(&bytes).map_err(|e| CursorError::JsonError(e.to_string()))?;
    if payload.spec_hash != expected_spec_hash {
        return Err(CursorError::CursorMismatch);
    }
    Ok((payload.sort_values, payload.id))
}
