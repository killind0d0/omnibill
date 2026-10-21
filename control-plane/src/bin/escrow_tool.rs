use control_plane::escrow::unseal_dek_from_file;
use std::env;
use std::path::PathBuf;

fn print_usage() {
    eprintln!("Usage: escrow_tool unseal --blob-b64 <b64> --key-file <escrow_private>");
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        print_usage();
        std::process::exit(1);
    }

    if args[1] != "unseal" {
        eprintln!("Unknown subcommand: {}", args[1]);
        print_usage();
        std::process::exit(1);
    }

    let mut blob_b64: Option<String> = None;
    let mut key_file: Option<PathBuf> = None;

    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--blob-b64" => {
                if i + 1 < args.len() {
                    blob_b64 = Some(args[i + 1].clone());
                    i += 1;
                }
            }
            "--key-file" => {
                if i + 1 < args.len() {
                    key_file = Some(PathBuf::from(&args[i + 1]));
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

    let (blob, kfile) = match (blob_b64, key_file) {
        (Some(b), Some(k)) => (b, k),
        _ => {
            eprintln!("Error: Both --blob-b64 and --key-file are required.");
            print_usage();
            std::process::exit(1);
        }
    };

    match unseal_dek_from_file(&blob, &kfile) {
        Ok(dek_hex) => {
            println!("{}", dek_hex);
        }
        Err(e) => {
            eprintln!("Unseal error: {}", e);
            std::process::exit(1);
        }
    }
}
