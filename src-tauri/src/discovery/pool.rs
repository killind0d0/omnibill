use rusqlite::{Connection, OpenFlags};
use std::sync::Mutex;

/// A small pool of 2 read-only SQLite connections with strict read-only pragmas.
pub struct ReadOnlyPool {
    db_path: String,
    pool: Mutex<Vec<Connection>>,
}

impl ReadOnlyPool {
    /// Creates a new read-only pool for the specified database path.
    pub fn new(db_path: &str) -> Result<Self, rusqlite::Error> {
        let pool = Mutex::new(Vec::with_capacity(2));
        let pool_inst = Self {
            db_path: db_path.to_string(),
            pool,
        };
        // Pre-initialize connections with read-only flags
        for _ in 0..2 {
            let conn = pool_inst.create_connection()?;
            let mut guard = pool_inst.pool.lock().map_err(|_| {
                rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
                    Some("Failed to acquire mutex lock for read-only pool".to_string()),
                )
            })?;
            guard.push(conn);
        }
        Ok(pool_inst)
    }

    /// Creates a dedicated connection opened with SQLITE_OPEN_READ_ONLY and PRAGMA query_only = 1.
    fn create_connection(&self) -> Result<Connection, rusqlite::Error> {
        let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        let key = crate::access::dbkey::default_keystore().get();
        let conn = crate::access::dbopen::open_database_with_flags(&self.db_path, flags, key.as_ref())
            .map_err(|e| match e {
                crate::access::dbopen::DbOpenError::Sqlite(err) => err,
                other => rusqlite::Error::ToSqlConversionFailure(Box::new(other)),
            })?;
        conn.pragma_update(None, "query_only", 1)?;
        conn.busy_timeout(std::time::Duration::from_millis(2000))?;
        Ok(conn)
    }

    /// Acquires a connection from the pool, or creates one if empty.
    pub fn acquire(&self) -> Result<PooledConnection<'_>, rusqlite::Error> {
        let conn = {
            let mut guard = self.pool.lock().map_err(|_| {
                rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
                    Some("Failed to acquire mutex lock".to_string()),
                )
            })?;
            guard.pop()
        };
        let conn = match conn {
            Some(c) => c,
            None => self.create_connection()?,
        };
        Ok(PooledConnection {
            conn: Some(conn),
            pool: self,
        })
    }

    fn release(&self, conn: Connection) {
        let Ok(mut guard) = self.pool.lock() else {
            return;
        };
        if guard.len() < 2 {
            guard.push(conn);
        }
    }
}

pub struct PooledConnection<'a> {
    conn: Option<Connection>,
    pool: &'a ReadOnlyPool,
}

impl<'a> std::ops::Deref for PooledConnection<'a> {
    type Target = Connection;
    fn deref(&self) -> &Self::Target {
        match &self.conn {
            Some(c) => c,
            None => panic!("Attempted to dereference released connection"),
        }
    }
}

impl<'a> Drop for PooledConnection<'a> {
    fn drop(&mut self) {
        if let Some(conn) = self.conn.take() {
            self.pool.release(conn);
        }
    }
}
