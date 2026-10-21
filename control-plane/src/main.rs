use control_plane::auth::{create_admin, reset_admin_totp};
use control_plane::db::{init_schema, open_db};
use control_plane::keys::verify_strict_permissions;
use control_plane::ratelimit::SlidingWindowLimiter;
use control_plane::routes::{create_router, AppState};
use std::env;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

fn read_password_stdin() -> Result<String, std::io::Error> {
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("stty").arg("-echo").status();
        let mut input = String::new();
        let res = std::io::stdin().read_line(&mut input);
        let _ = std::process::Command::new("stty").arg("echo").status();
        eprintln!();
        res?;
        return Ok(input.trim().to_string());
    }
    #[allow(unreachable_code)]
    {
        let mut input = String::new();
        std::io::stdin().read_line(&mut input)?;
        Ok(input.trim().to_string())
    }
}

fn print_cli_usage() {
    eprintln!(
        "Usage: control-plane [COMMAND]\n\
         Commands:\n\
         \x20 create-admin --username <NAME> [--allow-second]\n\
         \x20 reset-admin-totp --username <NAME>\n\
         \x20 serve [--port <PORT>] [--db <PATH>]\n"
    );
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();

    let db_path_str = env::var("OMNIBILL_DB_PATH").unwrap_or_else(|_| "control_plane.db".into());
    let db_path = PathBuf::from(db_path_str);

    let server_secret = env::var("OMNIBILL_SERVER_SECRET")
        .unwrap_or_else(|_| "omnibill-dev-secret-do-not-use-in-prod".into());

    if args.len() > 1 && (args[1] == "--help" || args[1] == "-h" || args[1] == "help") {
        print_cli_usage();
        return Ok(());
    }

    if args.len() > 1 && args[1] == "create-admin" {
        let mut username = None;
        let mut allow_second = false;
        let mut i = 2;
        while i < args.len() {
            match args[i].as_str() {
                "--username" => {
                    if i + 1 < args.len() {
                        username = Some(args[i + 1].clone());
                        i += 1;
                    }
                }
                "--allow-second" => {
                    allow_second = true;
                }
                _ => {}
            }
            i += 1;
        }

        let u = match username {
            Some(name) => name,
            None => {
                eprintln!("Error: --username required");
                std::process::exit(1);
            }
        };

        eprint!("Enter password for admin '{}': ", u);
        let password = read_password_stdin()?;
        if password.is_empty() {
            eprintln!("Error: Password cannot be empty");
            std::process::exit(1);
        }

        let conn = open_db(&db_path)?;
        init_schema(&conn)?;

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        match create_admin(&conn, &u, &password, &server_secret, now_ms, allow_second) {
            Ok(created) => {
                println!("Admin '{}' created successfully (ID: {}).", u, created.admin_id);
                println!("\nTOTP Provisioning URI (scan into your authenticator app):");
                println!("{}", created.totp_uri);
                println!("\nRecovery Codes (Save these safely! Each code can be used exactly ONCE):");
                for (idx, code) in created.recovery_codes.iter().enumerate() {
                    println!("  Code {}: {}", idx + 1, code);
                }
            }
            Err(e) => {
                eprintln!("Error creating admin: {}", e);
                std::process::exit(1);
            }
        }
        return Ok(());
    }

    if args.len() > 1 && args[1] == "reset-admin-totp" {
        let mut username = None;
        let mut i = 2;
        while i < args.len() {
            if args[i] == "--username" && i + 1 < args.len() {
                username = Some(args[i + 1].clone());
                i += 1;
            }
            i += 1;
        }

        let u = match username {
            Some(name) => name,
            None => {
                eprintln!("Error: --username required");
                std::process::exit(1);
            }
        };

        let conn = open_db(&db_path)?;
        init_schema(&conn)?;

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        match reset_admin_totp(&conn, &u, &server_secret, now_ms) {
            Ok(created) => {
                println!("TOTP and recovery codes reset for admin '{}'.", u);
                println!("\nNew TOTP Provisioning URI:");
                println!("{}", created.totp_uri);
                println!("\nNew Recovery Codes (Previous codes are now invalid):");
                for (idx, code) in created.recovery_codes.iter().enumerate() {
                    println!("  Code {}: {}", idx + 1, code);
                }
            }
            Err(e) => {
                eprintln!("Error resetting admin TOTP: {}", e);
                std::process::exit(1);
            }
        }
        return Ok(());
    }

    // Default or "serve": Run server
    let vendor_key_path_str = match env::var("OMNIBILL_VENDOR_KEY_FILE") {
        Ok(v) => v,
        Err(_) => {
            eprintln!("Error: OMNIBILL_VENDOR_KEY_FILE environment variable is required.");
            std::process::exit(1);
        }
    };

    let vendor_key_path = Path::new(&vendor_key_path_str);
    if !vendor_key_path.exists() {
        eprintln!(
            "Error: Vendor key file not found: {}",
            vendor_key_path.display()
        );
        std::process::exit(1);
    }

    if let Err(e) = verify_strict_permissions(vendor_key_path) {
        eprintln!(
            "Error: Vendor key file has insecure permissions (must be mode 0600): {}",
            e
        );
        std::process::exit(1);
    }

    let conn = open_db(&db_path)?;
    init_schema(&conn)?;
    drop(conn);

    let vendor_key_bytes = std::fs::read(vendor_key_path)?;
    if vendor_key_bytes.len() != 32 {
        eprintln!(
            "Error: Vendor key file must be 32 bytes, got {}",
            vendor_key_bytes.len()
        );
        std::process::exit(1);
    }
    let mut key_arr = [0u8; 32];
    key_arr.copy_from_slice(&vendor_key_bytes[..32]);
    let signing_key = ed25519_dalek::SigningKey::from_bytes(&key_arr);

    let state = Arc::new(AppState {
        db_path,
        server_secret,
        signing_key: Arc::new(signing_key),
        rate_limiter: Arc::new(SlidingWindowLimiter::new(60 * 1000, 100)),
    });

    let app = create_router(state);
    let port = env::var("PORT").unwrap_or_else(|_| "8080".into());
    let addr: SocketAddr = format!("127.0.0.1:{}", port).parse()?;

    println!("Control plane listening on http://{}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;

    Ok(())
}
