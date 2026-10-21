//! Comprehensive integration tests for OmniBill licence verification,
//! mode computation, export permits, and print restrictions (Task L3A).

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use omnibill_core::access::civil::{self, IST_OFFSET_MS};
use omnibill_core::access::licence::{
    Licence, LicencePayload, Mode, ModeInputs, Reason, compute_mode, compute_mode_default,
    export_allowed, parse_verifying_key, print_allowed, vendor_key,
};
use rand_core::OsRng;

/// Helper to construct a signing key and its corresponding verifying key.
fn test_keypair() -> (SigningKey, VerifyingKey) {
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();
    (signing_key, verifying_key)
}

/// Helper to build a canonical, valid `LicencePayload`.
fn sample_payload() -> LicencePayload {
    LicencePayload {
        v: 1,
        tenant_id: "tenant-uuid-1234".to_string(),
        business_name: "Apex Retail Solutions".to_string(),
        vertical: "retail".to_string(),
        plan: "pro".to_string(),
        features: vec![
            "cloud_sync".to_string(),
            "export_csv".to_string(),
            "export_xlsx".to_string(),
            "multi_counter".to_string(),
        ],
        max_counters: 5,
        device_id: "device-uuid-primary".to_string(),
        serial: 42,
        issued_ms: 1_700_000_000_000,
        valid_until_day: 20747, // 2026-10-21
        offline_days: 3,
        grace_days: 0,
        status: "active".to_string(),
        export_permit_until_ms: 0,
        support_text: "Contact support at help@apex.example.com".to_string(),
    }
}

/// Helper to sign a payload and produce a `Licence`.
fn sign_licence(payload: &LicencePayload, signing_key: &SigningKey) -> Licence {
    let mut payload = payload.clone();
    payload.features.sort();
    payload.features.dedup();
    let canonical_bytes = serde_json::to_vec(&payload).expect("canonical serialize");
    let sig = signing_key.sign(&canonical_bytes);
    let sig_b64 = URL_SAFE_NO_PAD.encode(sig.to_bytes());
    Licence {
        payload,
        sig: sig_b64,
        raw_payload_bytes: Some(canonical_bytes),
    }
}

/// Helper to build standard valid `ModeInputs` for the sample payload.
fn sample_mode_inputs(now_ms: i64) -> ModeInputs {
    ModeInputs {
        now_ms,
        last_checkin_ms: now_ms - 86_400_000, // 1 day ago
        device_id: "device-uuid-primary".to_string(),
        tenant_id_in_db: "tenant-uuid-1234".to_string(),
        max_seen_ms: now_ms,
    }
}

#[test]
fn test_licence_valid_computes_full_mode() {
    let (signing_key, verifying_key) = test_keypair();
    let payload = sample_payload();
    let licence = sign_licence(&payload, &signing_key);

    let day_d = payload.valid_until_day;
    let now_ms = (day_d * 86_400_000) - IST_OFFSET_MS + 3_600_000;
    let ctx = sample_mode_inputs(now_ms);

    let mode = compute_mode(Some(&licence), &verifying_key, &ctx);
    assert_eq!(mode, Mode::Full);
    assert!(export_allowed(
        Some(&licence),
        &verifying_key,
        &mode,
        now_ms
    ));
    assert!(print_allowed(&mode));
}

#[test]
fn test_licence_flipped_payload_bit_yields_bad_signature() {
    let (signing_key, verifying_key) = test_keypair();
    let mut payload = sample_payload();
    let mut licence = sign_licence(&payload, &signing_key);

    // Tamper payload after signing
    payload.business_name = "Apex Retail Solutions (Tampered)".to_string();
    licence.payload = payload;

    let now_ms = (licence.payload.valid_until_day * 86_400_000) - IST_OFFSET_MS + 3_600_000;
    let ctx = sample_mode_inputs(now_ms);

    let mode = compute_mode(Some(&licence), &verifying_key, &ctx);
    assert_eq!(mode, Mode::ReadOnly(Reason::BadSignature));
}

#[test]
fn test_licence_corrupted_signature_yields_bad_signature() {
    let (signing_key, verifying_key) = test_keypair();
    let payload = sample_payload();
    let mut licence = sign_licence(&payload, &signing_key);

    // Corrupt base64 signature by flipping characters
    let mut chars: Vec<char> = licence.sig.chars().collect();
    if let Some(c) = chars.first_mut() {
        *c = if *c == 'A' { 'B' } else { 'A' };
    }
    licence.sig = chars.into_iter().collect();

    let now_ms = (licence.payload.valid_until_day * 86_400_000) - IST_OFFSET_MS + 3_600_000;
    let ctx = sample_mode_inputs(now_ms);

    let mode = compute_mode(Some(&licence), &verifying_key, &ctx);
    assert_eq!(mode, Mode::ReadOnly(Reason::BadSignature));
}

#[test]
fn test_licence_wrong_key_signature_yields_bad_signature() {
    let (signing_key_a, _) = test_keypair();
    let (_, verifying_key_b) = test_keypair();

    let payload = sample_payload();
    let licence = sign_licence(&payload, &signing_key_a);

    let now_ms = (payload.valid_until_day * 86_400_000) - IST_OFFSET_MS + 3_600_000;
    let ctx = sample_mode_inputs(now_ms);

    // Verify key B against signature made with key A
    let mode = compute_mode(Some(&licence), &verifying_key_b, &ctx);
    assert_eq!(mode, Mode::ReadOnly(Reason::BadSignature));
}

#[test]
fn test_licence_wrong_device_yields_wrong_device() {
    let (signing_key, verifying_key) = test_keypair();
    let payload = sample_payload();
    let licence = sign_licence(&payload, &signing_key);

    let now_ms = (payload.valid_until_day * 86_400_000) - IST_OFFSET_MS + 3_600_000;
    let mut ctx = sample_mode_inputs(now_ms);
    ctx.device_id = "device-uuid-other".to_string();

    let mode = compute_mode(Some(&licence), &verifying_key, &ctx);
    assert_eq!(mode, Mode::ReadOnly(Reason::WrongDevice));
}

#[test]
fn test_licence_wrong_tenant_yields_wrong_tenant() {
    let (signing_key, verifying_key) = test_keypair();
    let payload = sample_payload();
    let licence = sign_licence(&payload, &signing_key);

    let now_ms = (payload.valid_until_day * 86_400_000) - IST_OFFSET_MS + 3_600_000;
    let mut ctx = sample_mode_inputs(now_ms);
    ctx.tenant_id_in_db = "tenant-uuid-other".to_string();

    let mode = compute_mode(Some(&licence), &verifying_key, &ctx);
    assert_eq!(mode, Mode::ReadOnly(Reason::WrongTenant));
}

#[test]
fn test_licence_suspended_yields_suspended() {
    let (signing_key, verifying_key) = test_keypair();
    let mut payload = sample_payload();
    payload.status = "suspended".to_string();
    let licence = sign_licence(&payload, &signing_key);

    let now_ms = (payload.valid_until_day * 86_400_000) - IST_OFFSET_MS + 3_600_000;
    let ctx = sample_mode_inputs(now_ms);

    let mode = compute_mode(Some(&licence), &verifying_key, &ctx);
    assert_eq!(mode, Mode::ReadOnly(Reason::Suspended));
}

#[test]
fn test_licence_boundaries_valid_until_day_grace_zero() {
    let (signing_key, verifying_key) = test_keypair();
    let d = 20747; // 2026-10-21
    let mut payload = sample_payload();
    payload.valid_until_day = d;
    payload.grace_days = 0;
    let licence = sign_licence(&payload, &signing_key);

    // Exact boundary math:
    // Start of day D in UTC: D * 86_400_000 - IST_OFFSET_MS
    // Last ms of day D: (D + 1) * 86_400_000 - IST_OFFSET_MS - 1
    let last_ms_of_d = (d + 1) * 86_400_000 - IST_OFFSET_MS - 1;
    assert_eq!(civil::ist_day(last_ms_of_d), d);

    let ctx_last_ms = sample_mode_inputs(last_ms_of_d);
    assert_eq!(
        compute_mode(Some(&licence), &verifying_key, &ctx_last_ms),
        Mode::Full
    );

    // First ms of day D + 1: (D + 1) * 86_400_000 - IST_OFFSET_MS
    let first_ms_of_d1 = (d + 1) * 86_400_000 - IST_OFFSET_MS;
    assert_eq!(civil::ist_day(first_ms_of_d1), d + 1);

    let ctx_first_ms = sample_mode_inputs(first_ms_of_d1);
    assert_eq!(
        compute_mode(Some(&licence), &verifying_key, &ctx_first_ms),
        Mode::ReadOnly(Reason::Expired)
    );
}

#[test]
fn test_licence_boundaries_valid_until_day_grace_two() {
    let (signing_key, verifying_key) = test_keypair();
    let d = 20747;
    let mut payload = sample_payload();
    payload.valid_until_day = d;
    payload.grace_days = 2; // Valid through day D + 2
    let licence = sign_licence(&payload, &signing_key);

    // Last ms of day D + 2
    let last_ms_of_d2 = (d + 2 + 1) * 86_400_000 - IST_OFFSET_MS - 1;
    assert_eq!(civil::ist_day(last_ms_of_d2), d + 2);

    let ctx_d2 = sample_mode_inputs(last_ms_of_d2);
    assert_eq!(
        compute_mode(Some(&licence), &verifying_key, &ctx_d2),
        Mode::Full
    );

    // First ms of day D + 3
    let first_ms_of_d3 = (d + 3) * 86_400_000 - IST_OFFSET_MS;
    assert_eq!(civil::ist_day(first_ms_of_d3), d + 3);

    let ctx_d3 = sample_mode_inputs(first_ms_of_d3);
    assert_eq!(
        compute_mode(Some(&licence), &verifying_key, &ctx_d3),
        Mode::ReadOnly(Reason::Expired)
    );
}

#[test]
fn test_licence_boundaries_last_checkin_offline_days() {
    let (signing_key, verifying_key) = test_keypair();
    let mut payload = sample_payload();
    payload.offline_days = 3;
    let licence = sign_licence(&payload, &signing_key);

    let last_checkin = 1_700_000_000_000;
    let offline_window_ms = 3 * 86_400_000;

    // Exactly offline_days ago: now_ms == last_checkin + offline_window_ms -> Full
    let now_exact = last_checkin + offline_window_ms;
    let mut ctx_exact = sample_mode_inputs(now_exact);
    ctx_exact.last_checkin_ms = last_checkin;
    assert_eq!(
        compute_mode(Some(&licence), &verifying_key, &ctx_exact),
        Mode::Full
    );

    // Exactly +1 ms past the window -> CheckinRequired
    let now_past = last_checkin + offline_window_ms + 1;
    let mut ctx_past = sample_mode_inputs(now_past);
    ctx_past.last_checkin_ms = last_checkin;
    assert_eq!(
        compute_mode(Some(&licence), &verifying_key, &ctx_past),
        Mode::ReadOnly(Reason::CheckinRequired)
    );
}

#[test]
fn test_licence_boundaries_clock_rollback_tolerance() {
    let (signing_key, verifying_key) = test_keypair();
    let payload = sample_payload();
    let licence = sign_licence(&payload, &signing_key);

    let max_seen_ms = 1_700_000_000_000;

    // Clock back 9 minutes (< 10 min tolerance) -> Full
    let now_9m_back = max_seen_ms - 9 * 60_000;
    let mut ctx_9m = sample_mode_inputs(now_9m_back);
    ctx_9m.max_seen_ms = max_seen_ms;
    assert_eq!(
        compute_mode(Some(&licence), &verifying_key, &ctx_9m),
        Mode::Full
    );

    // Clock back 11 minutes (> 10 min tolerance) -> ClockTampered
    let now_11m_back = max_seen_ms - 11 * 60_000;
    let mut ctx_11m = sample_mode_inputs(now_11m_back);
    ctx_11m.max_seen_ms = max_seen_ms;
    assert_eq!(
        compute_mode(Some(&licence), &verifying_key, &ctx_11m),
        Mode::ReadOnly(Reason::ClockTampered)
    );
}

#[test]
fn test_licence_reserialization_mismatch_rejected() {
    let (signing_key, verifying_key) = test_keypair();

    // Case 1: Features array is not sorted ascending
    let mut payload_unsorted = sample_payload();
    payload_unsorted.features = vec!["zeta".to_string(), "alpha".to_string()];
    let canonical = serde_json::to_vec(&payload_unsorted).unwrap();
    let sig = URL_SAFE_NO_PAD.encode(signing_key.sign(&canonical).to_bytes());
    let licence_unsorted = Licence {
        payload: payload_unsorted,
        sig,
        raw_payload_bytes: Some(canonical),
    };
    let ctx = sample_mode_inputs(1_700_000_000_000);
    assert_eq!(
        compute_mode(Some(&licence_unsorted), &verifying_key, &ctx),
        Mode::ReadOnly(Reason::BadSignature)
    );

    // Case 2: Features array contains duplicates
    let mut payload_dups = sample_payload();
    payload_dups.features = vec!["alpha".to_string(), "alpha".to_string()];
    let canonical = serde_json::to_vec(&payload_dups).unwrap();
    let sig = URL_SAFE_NO_PAD.encode(signing_key.sign(&canonical).to_bytes());
    let licence_dups = Licence {
        payload: payload_dups,
        sig,
        raw_payload_bytes: Some(canonical),
    };
    assert_eq!(
        compute_mode(Some(&licence_dups), &verifying_key, &ctx),
        Mode::ReadOnly(Reason::BadSignature)
    );

    // Case 3: Raw payload bytes differ from canonical re-serialization (tampered raw bytes)
    let payload_valid = sample_payload();
    let mut licence_tampered_bytes = sign_licence(&payload_valid, &signing_key);
    licence_tampered_bytes.raw_payload_bytes = Some(b"{\"v\":1,\"extra_injected\":true}".to_vec());
    assert_eq!(
        compute_mode(Some(&licence_tampered_bytes), &verifying_key, &ctx),
        Mode::ReadOnly(Reason::BadSignature)
    );

    // Case 4: Deserializing JSON with injected unknown fields in payload
    let valid_licence = sign_licence(&payload_valid, &signing_key);
    let valid_json = serde_json::to_string(&valid_licence).unwrap();
    let injected_json = valid_json.replace(
        "\"v\":1",
        "\"v\":1,\"unknown_smuggled_param\":\"malicious\"",
    );
    let parsed_licence = Licence::from_json(&injected_json).unwrap();
    assert_eq!(
        compute_mode(Some(&parsed_licence), &verifying_key, &ctx),
        Mode::ReadOnly(Reason::BadSignature)
    );
}

#[test]
fn test_licence_permit_on_expired_licence_allows_export_but_denies_writes() {
    let (signing_key, verifying_key) = test_keypair();
    let mut payload = sample_payload();
    payload.valid_until_day = 10000; // Far in past -> expired
    let now_ms = 1_700_000_000_000;
    payload.export_permit_until_ms = now_ms + 72 * 3_600_000; // Active permit
    let licence = sign_licence(&payload, &signing_key);

    let ctx = sample_mode_inputs(now_ms);
    let mode = compute_mode(Some(&licence), &verifying_key, &ctx);

    // Mode must be ReadOnly(Expired)
    assert_eq!(mode, Mode::ReadOnly(Reason::Expired));

    // Export must be allowed under the permit
    assert!(export_allowed(
        Some(&licence),
        &verifying_key,
        &mode,
        now_ms
    ));

    // Writes must be strictly denied because mode is ReadOnly
    assert_ne!(mode, Mode::Full);

    // Printing must be denied even with a permit
    assert!(!print_allowed(&mode));
}

#[test]
fn test_licence_permit_expired_denies_export() {
    let (signing_key, verifying_key) = test_keypair();
    let mut payload = sample_payload();
    payload.valid_until_day = 10000; // Expired
    let now_ms = 1_700_000_000_000;
    payload.export_permit_until_ms = now_ms - 1000; // Permit expired 1 second ago
    let licence = sign_licence(&payload, &signing_key);

    let ctx = sample_mode_inputs(now_ms);
    let mode = compute_mode(Some(&licence), &verifying_key, &ctx);

    assert_eq!(mode, Mode::ReadOnly(Reason::Expired));
    assert!(!export_allowed(
        Some(&licence),
        &verifying_key,
        &mode,
        now_ms
    ));
}

#[test]
fn test_licence_permit_on_tampered_payload_denies_export() {
    let (signing_key, verifying_key) = test_keypair();
    let mut payload = sample_payload();
    payload.valid_until_day = 10000; // Expired
    let now_ms = 1_700_000_000_000;
    payload.export_permit_until_ms = now_ms + 3_600_000; // Active permit
    let mut licence = sign_licence(&payload, &signing_key);

    // Tamper the payload so signature is invalid
    licence.payload.business_name = "Tampered".to_string();

    let ctx = sample_mode_inputs(now_ms);
    let mode = compute_mode(Some(&licence), &verifying_key, &ctx);

    assert_eq!(mode, Mode::ReadOnly(Reason::BadSignature));
    assert!(!export_allowed(
        Some(&licence),
        &verifying_key,
        &mode,
        now_ms
    ));
}

#[test]
fn test_licence_permit_with_wrong_device_denies_export() {
    let (signing_key, verifying_key) = test_keypair();
    let mut payload = sample_payload();
    payload.valid_until_day = 10000; // Expired
    let now_ms = 1_700_000_000_000;
    payload.export_permit_until_ms = now_ms + 3_600_000; // Active permit
    let licence = sign_licence(&payload, &signing_key);

    let mut ctx = sample_mode_inputs(now_ms);
    ctx.device_id = "device-uuid-different".to_string(); // Wrong device

    let mode = compute_mode(Some(&licence), &verifying_key, &ctx);

    assert_eq!(mode, Mode::ReadOnly(Reason::WrongDevice));
    assert!(!export_allowed(
        Some(&licence),
        &verifying_key,
        &mode,
        now_ms
    ));
}

#[test]
fn test_licence_print_denied_for_every_non_full_mode_including_with_permit() {
    let non_full_modes = vec![
        Mode::Unlicensed,
        Mode::ReadOnly(Reason::BadSignature),
        Mode::ReadOnly(Reason::WrongDevice),
        Mode::ReadOnly(Reason::WrongTenant),
        Mode::ReadOnly(Reason::Suspended),
        Mode::ReadOnly(Reason::ClockTampered),
        Mode::ReadOnly(Reason::Expired),
        Mode::ReadOnly(Reason::CheckinRequired),
    ];

    for mode in non_full_modes {
        assert!(
            !print_allowed(&mode),
            "Print must be denied for mode {:?}",
            mode
        );
    }

    assert!(print_allowed(&Mode::Full));
}

#[test]
fn test_licence_zero_bytes_vendor_key_yields_bad_signature() {
    let (signing_key, _) = test_keypair();
    let payload = sample_payload();
    let licence = sign_licence(&payload, &signing_key);

    let now_ms = (payload.valid_until_day * 86_400_000) - IST_OFFSET_MS + 3_600_000;
    let ctx = sample_mode_inputs(now_ms);

    // Parsing 32 zero bytes returns Err
    let zero_bytes = [0u8; 32];
    assert!(parse_verifying_key(&zero_bytes).is_err());

    // The embedded vendor_public.bin is currently 32 zero bytes placeholder
    assert!(vendor_key().is_err());

    // compute_mode_default fails closed to BadSignature
    let default_mode = compute_mode_default(Some(&licence), &ctx);
    assert_eq!(default_mode, Mode::ReadOnly(Reason::BadSignature));
}

#[test]
fn test_licence_unlicensed_mode() {
    let (_, verifying_key) = test_keypair();
    let now_ms = 1_700_000_000_000;
    let ctx = sample_mode_inputs(now_ms);

    let mode = compute_mode(None, &verifying_key, &ctx);
    assert_eq!(mode, Mode::Unlicensed);
    assert!(!export_allowed(None, &verifying_key, &mode, now_ms));
    assert!(!print_allowed(&mode));
}
