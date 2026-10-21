use control_plane::keys::{generate_keypairs, write_private_key, write_public_key};
use std::env;
use std::path::PathBuf;

fn print_usage() {
    eprintln!(
        "Usage: keygen --out-vendor-private <path> --out-vendor-public <path> \
         --out-escrow-private <path> --out-escrow-public <path>"
    );
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let mut vendor_priv: Option<PathBuf> = None;
    let mut vendor_pub: Option<PathBuf> = None;
    let mut escrow_priv: Option<PathBuf> = None;
    let mut escrow_pub: Option<PathBuf> = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--out-vendor-private" => {
                if i + 1 < args.len() {
                    vendor_priv = Some(PathBuf::from(&args[i + 1]));
                    i += 1;
                }
            }
            "--out-vendor-public" => {
                if i + 1 < args.len() {
                    vendor_pub = Some(PathBuf::from(&args[i + 1]));
                    i += 1;
                }
            }
            "--out-escrow-private" => {
                if i + 1 < args.len() {
                    escrow_priv = Some(PathBuf::from(&args[i + 1]));
                    i += 1;
                }
            }
            "--out-escrow-public" => {
                if i + 1 < args.len() {
                    escrow_pub = Some(PathBuf::from(&args[i + 1]));
                    i += 1;
                }
            }
            "--help" | "-h" => {
                print_usage();
                std::process::exit(0);
            }
            other => {
                eprintln!("Unknown argument: {}", other);
                print_usage();
                std::process::exit(1);
            }
        }
        i += 1;
    }

    let (v_priv, v_pub, e_priv, e_pub) = match (vendor_priv, vendor_pub, escrow_priv, escrow_pub) {
        (Some(a), Some(b), Some(c), Some(d)) => (a, b, c, d),
        _ => {
            eprintln!("Error: all 4 output path flags are required.");
            print_usage();
            std::process::exit(1);
        }
    };

    // Pre-flight check: refuse if ANY of the 4 files exist
    for p in [&v_priv, &v_pub, &e_priv, &e_pub] {
        if p.exists() {
            eprintln!("Error: Destination file already exists (refusing overwrite): {}", p.display());
            std::process::exit(1);
        }
    }

    let keys = generate_keypairs();

    if let Err(e) = write_private_key(&v_priv, &keys.vendor_private) {
        eprintln!("Failed writing vendor private key: {}", e);
        std::process::exit(1);
    }

    if let Err(e) = write_public_key(&v_pub, &keys.vendor_public) {
        eprintln!("Failed writing vendor public key: {}", e);
        std::process::exit(1);
    }

    if let Err(e) = write_private_key(&e_priv, &keys.escrow_private) {
        eprintln!("Failed writing escrow private key: {}", e);
        std::process::exit(1);
    }

    if let Err(e) = write_public_key(&e_pub, &keys.escrow_public) {
        eprintln!("Failed writing escrow public key: {}", e);
        std::process::exit(1);
    }

    println!("Keypairs generated successfully.");
}
