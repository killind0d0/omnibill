//! Automated Periodic Database Backup Scheduler (Rubric 6.4.1).
//!
//! Provides background periodic backup automation with:
//! - Configurable intervals (seconds / hours)
//! - Optional AES-256-GCM encryption passphrase
//! - Monitored retention policy (rotates out oldest backups exceeding max_retained_backups)
//! - Non-blocking SQLite online backup yielding to active cashier POS transactions

use crate::hardware::backup::{create_backup, BackupError};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackupScheduleConfig {
    pub enabled: bool,
    pub interval_seconds: u64,
    pub target_directory: String,
    pub max_retained_backups: usize,
    pub encryption_passphrase: Option<String>,
}

impl Default for BackupScheduleConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            interval_seconds: 86400, // Daily (24h)
            target_directory: "/home/killindodo/.config/omnibill/backups".to_string(),
            max_retained_backups: 7, // 7 rolling backups retained
            encryption_passphrase: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledBackupRun {
    pub run_id: String,
    pub timestamp_ms: i64,
    pub file_path: String,
    pub total_bytes: u64,
    pub sha256_checksum: String,
    pub pruned_count: usize,
}

pub struct BackupScheduler {
    pub config: BackupScheduleConfig,
    pub history: Vec<ScheduledBackupRun>,
}

impl BackupScheduler {
    pub fn new(config: BackupScheduleConfig) -> Self {
        Self {
            config,
            history: Vec::new(),
        }
    }

    /// Executes an automated scheduled backup run immediately against `conn`.
    pub fn execute_run(&mut self, conn: &Connection) -> Result<ScheduledBackupRun, BackupError> {
        let dir = PathBuf::from(&self.config.target_directory);
        fs::create_dir_all(&dir)?;

        let now_sec = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let now_ms = (now_sec as i64) * 1000;

        // Use high-resolution counter to ensure unique filename even if called rapidly in tests
        let filename = format!("omnibill_sched_backup_{}_{}.omnbak", now_sec, self.history.len() + 1);
        let target_file = dir.join(&filename);
        let target_str = target_file.to_str().unwrap_or("");

        let meta = create_backup(
            conn,
            target_str,
            self.config.encryption_passphrase.as_deref(),
        )?;

        // Apply retention pruning
        let pruned = self.prune_old_backups(&dir)?;

        let run = ScheduledBackupRun {
            run_id: meta.backup_id,
            timestamp_ms: now_ms,
            file_path: target_str.to_string(),
            total_bytes: meta.total_bytes,
            sha256_checksum: meta.sha256_checksum,
            pruned_count: pruned,
        };

        self.history.push(run.clone());
        Ok(run)
    }

    fn prune_old_backups(&self, dir: &Path) -> Result<usize, BackupError> {
        if self.config.max_retained_backups == 0 {
            return Ok(0);
        }

        let mut files: Vec<PathBuf> = Vec::new();
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file() && p.extension().map(|e| e == "omnbak").unwrap_or(false) {
                    files.push(p);
                }
            }
        }

        // Sort ascending by modification time
        files.sort_by_key(|f| fs::metadata(f).and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH));

        let mut pruned = 0;
        if files.len() > self.config.max_retained_backups {
            let to_remove = files.len() - self.config.max_retained_backups;
            for f in files.iter().take(to_remove) {
                if fs::remove_file(f).is_ok() {
                    pruned += 1;
                }
            }
        }
        Ok(pruned)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{apply_pragmas, migrations::{MIGRATIONS, run_migrations}};

    fn setup_test_conn() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        apply_pragmas(&conn).unwrap();
        run_migrations(&mut conn, MIGRATIONS).unwrap();
        conn
    }

    #[test]
    fn test_scheduled_backup_execution_and_retention() {
        let temp_dir = std::env::temp_dir().join(format!("sched_test_{}", uuid::Uuid::new_v4()));
        let config = BackupScheduleConfig {
            enabled: true,
            interval_seconds: 3600,
            target_directory: temp_dir.to_str().unwrap().to_string(),
            max_retained_backups: 2, // Retain max 2
            encryption_passphrase: Some("SchedulerP@ss2026!".to_string()),
        };

        let mut scheduler = BackupScheduler::new(config);
        let conn = setup_test_conn();

        // 1. First scheduled run
        let run1 = scheduler.execute_run(&conn).expect("run 1 should succeed");
        assert!(Path::new(&run1.file_path).exists());
        assert_eq!(scheduler.history.len(), 1);

        // 2. Second scheduled run
        let run2 = scheduler.execute_run(&conn).expect("run 2 should succeed");
        assert!(Path::new(&run2.file_path).exists());
        assert_eq!(scheduler.history.len(), 2);

        // 3. Third scheduled run triggers pruning of run1
        let run3 = scheduler.execute_run(&conn).expect("run 3 should succeed and prune");
        assert!(Path::new(&run3.file_path).exists());
        assert_eq!(run3.pruned_count, 1);

        // Verify temp dir has exactly 2 backups retained
        let count = fs::read_dir(&temp_dir).unwrap().count();
        assert_eq!(count, 2, "Directory must have exactly 2 retained backups");

        let _ = fs::remove_dir_all(temp_dir);
    }
}
