//! Command Coverage & Authorization Guard Verification Suite (Task L2B)
//!
//! Enforces:
//! 1. Every command annotated with `#[tauri::command]` has a policy entry in `COMMAND_POLICY`.
//! 2. Every command is registered in `generate_handler!`.
//! 3. Every non-public command calls `authorize(` within its first 12 lines.
//! 4. Unknown commands fail closed with `GuardError::UnknownCommand`.
//! 5. Export surfaces and print surfaces are accurately classified in policy table.

use omnibill_core::access::guard::{AppAuthState, GuardError, authorize};
use omnibill_core::access::policy_table::{COMMAND_POLICY, find_policy};
use omnibill_core::commands::REGISTERED_COMMAND_HANDLERS;
use std::fs;
use std::path::{Path, PathBuf};

fn find_rs_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                files.extend(find_rs_files(&p));
            } else if p.extension().map(|e| e == "rs").unwrap_or(false) {
                files.push(p);
            }
        }
    }
    files
}

#[derive(Debug)]
struct ScannedCommand {
    fn_name: String,
    policy_name: String,
    file: PathBuf,
    line: usize,
    has_authorize: bool,
}

fn scan_commands() -> Vec<ScannedCommand> {
    let src_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let rs_files = find_rs_files(&src_dir);
    let mut commands = Vec::new();

    for file_path in rs_files {
        let content = fs::read_to_string(&file_path).unwrap_or_default();
        let lines: Vec<&str> = content.lines().collect();

        for (idx, line) in lines.iter().enumerate() {
            if line.contains("#[tauri::command]") {
                // Find function definition within the next few lines
                let mut fn_name = None;
                let mut fn_start_line = idx;

                for offset in 1..=5 {
                    if idx + offset < lines.len() {
                        let l = lines[idx + offset].trim();
                        if l.starts_with("pub fn ") || l.starts_with("fn ") {
                            let after_fn = if let Some(stripped) = l.strip_prefix("pub fn ") {
                                stripped
                            } else {
                                l.strip_prefix("fn ").unwrap_or("")
                            };
                            if let Some(pos) = after_fn.find('(') {
                                fn_name = Some(after_fn[..pos].trim().to_string());
                                fn_start_line = idx + offset;
                                break;
                            }
                        }
                    }
                }

                if let Some(name) = fn_name {
                    // Check if authorize( is called within the next 12 lines from fn start
                    let mut has_authorize = false;
                    let mut authorized_cmd_name = None;

                    for off in 1..=12 {
                        if fn_start_line + off < lines.len() {
                            let l = lines[fn_start_line + off];
                            if l.contains("authorize(") || has_authorize {
                                has_authorize = true;
                                // Look for string literal command name in quotes
                                for part in l.split('"') {
                                    if (part.starts_with("cmd_")
                                        || part == "logout"
                                        || part == "change_password"
                                        || part == "get_access_status")
                                        && !part.contains(' ')
                                    {
                                        authorized_cmd_name = Some(part.to_string());
                                        break;
                                    }
                                }
                                if authorized_cmd_name.is_some() {
                                    break;
                                }
                            }
                        }
                    }

                    let policy_name = authorized_cmd_name.unwrap_or_else(|| {
                        name.strip_suffix("_guarded").unwrap_or(&name).to_string()
                    });

                    commands.push(ScannedCommand {
                        fn_name: name,
                        policy_name,
                        file: file_path.clone(),
                        line: idx + 1,
                        has_authorize,
                    });
                }
            }
        }
    }

    commands
}

#[test]
fn test_all_annotated_commands_in_policy_and_guarded() {
    let scanned = scan_commands();
    assert!(
        !scanned.is_empty(),
        "Must scan at least one command in src/"
    );

    for cmd in &scanned {
        // Assert (a): Command is in COMMAND_POLICY
        let policy = find_policy(&cmd.policy_name).unwrap_or_else(|| {
            panic!(
                "Command '{}' (policy '{}') found in {:?}:{} but missing from COMMAND_POLICY",
                cmd.fn_name, cmd.policy_name, cmd.file, cmd.line
            )
        });

        // Assert (c): Source contains authorize( within first 12 lines unless public: true
        if policy.public {
            assert!(
                !cmd.has_authorize,
                "Public command '{}' should not require authorization in {:?}:{}",
                cmd.fn_name, cmd.file, cmd.line
            );
        } else {
            assert!(
                cmd.has_authorize,
                "Non-public command '{}' must call authorize(...) within first 12 lines in {:?}:{}",
                cmd.fn_name, cmd.file, cmd.line
            );
        }
    }
}

#[test]
fn test_all_commands_in_generate_handler() {
    let scanned = scan_commands();
    for cmd in &scanned {
        // Check if command policy_name or fn_name is in REGISTERED_COMMAND_HANDLERS
        let found = REGISTERED_COMMAND_HANDLERS.iter().any(|&h| {
            h == cmd.policy_name
                || h == cmd.fn_name
                || h == cmd
                    .policy_name
                    .strip_prefix("cmd_")
                    .unwrap_or(&cmd.policy_name)
        });

        assert!(
            found,
            "Command '{}' (policy '{}') is not registered in generate_handler!",
            cmd.fn_name, cmd.policy_name
        );
    }
}

#[test]
fn test_unknown_command_fails_closed() {
    let state = AppAuthState::new("retail");
    let now_ms = 1_700_000_000_000;

    // Unknown command must immediately fail closed without checking session
    let res = authorize(
        &state.as_guard_context(),
        Some("any-token"),
        "cmd_malicious_injected_endpoint",
        now_ms,
    );

    match res {
        Err(GuardError::UnknownCommand(cmd)) => {
            assert_eq!(cmd, "cmd_malicious_injected_endpoint");
        }
        other => panic!("Expected UnknownCommand, got {:?}", other),
    }

    // Even None token fails with UnknownCommand
    let res_none = authorize(
        &state.as_guard_context(),
        None,
        "some_nonexistent_command",
        now_ms,
    );
    assert_eq!(
        res_none,
        Err(GuardError::UnknownCommand(
            "some_nonexistent_command".to_string()
        ))
    );
}

#[test]
fn test_policy_table_invariants_and_coverage() {
    assert!(
        COMMAND_POLICY.len() >= 40,
        "Policy table must have at least 40 commands"
    );

    // Verify all export surfaces have export: true
    let export_cmds: Vec<&str> = COMMAND_POLICY
        .iter()
        .filter(|p| p.export)
        .map(|p| p.name)
        .collect();

    assert!(export_cmds.contains(&"cmd_export_discovery"));
    assert!(export_cmds.contains(&"cmd_day_summary_text"));
    assert!(export_cmds.contains(&"cmd_backup_create"));

    // Verify print surface
    let print_cmds: Vec<&str> = COMMAND_POLICY
        .iter()
        .filter(|p| p.print)
        .map(|p| p.name)
        .collect();

    assert_eq!(print_cmds, vec!["cmd_print_receipt"]);

    // Verify public commands
    let public_cmds: Vec<&str> = COMMAND_POLICY
        .iter()
        .filter(|p| p.public)
        .map(|p| p.name)
        .collect();

    assert_eq!(public_cmds, vec!["login", "get_boot_state"]);
}
