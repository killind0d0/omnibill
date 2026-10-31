// ui/src/components/common/DatabaseBackupModal.tsx
// 1-Click Local Database Backup, Restore & Health Hub for OmniBill ERP

import React, { useState, useEffect } from 'react';
import {
  Database,
  ShieldCheck,
  Download,
  Upload,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Unlock,
  Clock,
  HardDrive,
  Layers,
  X,
  FileCheck2,
  Copy,
  Check,
  ShieldAlert,
} from 'lucide-react';
import {
  BackupService,
  DatabaseHealthInfo,
  BackupMetadata,
  AllBackupsResponse,
  BackupHistoryItem,
} from '../../lib/backupService';
import { posSound } from '../../lib/sound';

interface DatabaseBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeVertical?: string;
}

export const DatabaseBackupModal: React.FC<DatabaseBackupModalProps> = ({
  isOpen,
  onClose,
  activeVertical = 'RETAIL',
}) => {
  const [activeTab, setActiveTab] = useState<'BACKUP' | 'RESTORE' | 'HEALTH'>('BACKUP');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Backup Tab State
  const [backupScope, setBackupScope] = useState<'ACTIVE' | 'ALL'>('ACTIVE');
  const [useEncryption, setUseEncryption] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [lastCreatedBackup, setLastCreatedBackup] = useState<BackupMetadata | null>(null);
  const [allBackupsResult, setAllBackupsResult] = useState<AllBackupsResponse | null>(null);
  const [copiedChecksum, setCopiedChecksum] = useState(false);

  // Restore Tab State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [restoreSuccessPath, setRestoreSuccessPath] = useState<string | null>(null);
  const [preRestoreSafetyPath, setPreRestoreSafetyPath] = useState<string | null>(null);

  // Health Tab State
  const [healthList, setHealthList] = useState<DatabaseHealthInfo[]>([]);
  const [healthCheckedAt, setHealthCheckedAt] = useState<number | null>(null);
  const [historyList, setHistoryList] = useState<BackupHistoryItem[]>([]);

  // Load initial health & history when modal opens
  const refreshHealthAndHistory = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [health, history] = await Promise.all([
        BackupService.getDatabaseHealth(),
        BackupService.listBackups(),
      ]);
      setHealthList(health.databases);
      setHealthCheckedAt(health.checked_at);
      setHistoryList(history);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to fetch database health');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      refreshHealthAndHistory();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Handle 1-Click Backup Generation
  const handleExecuteBackup = async () => {
    setLoading(true);
    setErrorMessage(null);
    setStatusMessage(null);
    setLastCreatedBackup(null);
    setAllBackupsResult(null);

    try {
      posSound.playItemAdd();
      const res = await BackupService.createBackup({
        vertical: activeVertical,
        scope: backupScope,
        passphrase: useEncryption ? passphrase : undefined,
      });

      if ('scope' in res && res.scope === 'ALL') {
        setAllBackupsResult(res);
        posSound.playSuccess();
        setStatusMessage(`Successfully generated master enterprise backup for all 4 isolated databases!`);
      } else {
        const singleMeta = res as BackupMetadata;
        setLastCreatedBackup(singleMeta);
        posSound.playSuccess();
        setStatusMessage(`Successfully created verified backup snapshot for ${activeVertical.toUpperCase()}!`);
      }

      // Refresh backup list
      const updatedHistory = await BackupService.listBackups();
      setHistoryList(updatedHistory);
    } catch (err: any) {
      posSound.playWarning();
      setErrorMessage(err.message || 'Backup generation failed');
    } finally {
      setLoading(false);
    }
  };

  // Handle file select for restore
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setErrorMessage(null);
      const reader = new FileReader();
      reader.onload = () => {
        const res = reader.result as string;
        // Strip data:application/octet-stream;base64,
        const b64 = res.split(',')[1] || res;
        setFileBase64(b64);
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle 1-Click Restore
  const handleExecuteRestore = async () => {
    if (!fileBase64 && !selectedFile) {
      setErrorMessage('Please select a .omnibackup file to restore.');
      return;
    }
    if (!restoreConfirmed) {
      setErrorMessage('Please confirm the restore checkbox before proceeding.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setStatusMessage(null);
    setRestoreSuccessPath(null);

    try {
      const res = await BackupService.restoreBackup({
        backupData: fileBase64 || undefined,
        passphrase: restorePassphrase ? restorePassphrase : undefined,
        vertical: activeVertical,
      });

      if (res.success) {
        posSound.playSuccess();
        setRestoreSuccessPath(res.restored_db);
        setPreRestoreSafetyPath(res.safety_backup_path);
        setStatusMessage(
          `Database restore verified and completed successfully! Pre-restore safety snapshot created at ${res.safety_backup_path}`
        );
        refreshHealthAndHistory();
      }
    } catch (err: any) {
      posSound.playWarning();
      setErrorMessage(err.message || 'Database restore failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyChecksum = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedChecksum(true);
    setTimeout(() => setCopiedChecksum(false), 2000);
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-slate-100">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  OmniBill Database Safety & Backup Hub
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30">
                  {activeVertical}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                1-Click AES-256 encrypted SQLite backups, automated pre-restore safeguards & B-tree integrity health.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center space-x-2 px-6 pt-3 border-b border-slate-800/80 bg-slate-950/30 shrink-0">
          <button
            onClick={() => setActiveTab('BACKUP')}
            className={`flex items-center space-x-2 px-4 py-2 text-xs font-bold border-b-2 transition cursor-pointer ${
              activeTab === 'BACKUP'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Download className="w-4 h-4" />
            <span>1-Click Backup (Export)</span>
          </button>
          <button
            onClick={() => setActiveTab('RESTORE')}
            className={`flex items-center space-x-2 px-4 py-2 text-xs font-bold border-b-2 transition cursor-pointer ${
              activeTab === 'RESTORE'
                ? 'border-rose-500 text-rose-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>1-Click Restore (Import)</span>
          </button>
          <button
            onClick={() => setActiveTab('HEALTH')}
            className={`flex items-center space-x-2 px-4 py-2 text-xs font-bold border-b-2 transition cursor-pointer ${
              activeTab === 'HEALTH'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            <span>Physical DB Health & Archives ({historyList.length})</span>
          </button>
        </div>

        {/* Alerts / Feedback Banner */}
        {statusMessage && (
          <div className="mx-6 mt-4 p-3 bg-emerald-950/60 border border-emerald-500/50 rounded-xl text-xs text-emerald-200 flex items-center space-x-2 shrink-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-medium">{statusMessage}</span>
          </div>
        )}
        {errorMessage && (
          <div className="mx-6 mt-4 p-3 bg-rose-950/60 border border-rose-500/50 rounded-xl text-xs text-rose-200 flex items-center space-x-2 shrink-0">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="font-medium">{errorMessage}</span>
          </div>
        )}

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* TAB 1: 1-CLICK BACKUP */}
          {activeTab === 'BACKUP' && (
            <div className="space-y-6">
              <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-4 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-400" />
                  1. Select Backup Scope
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div
                    onClick={() => setBackupScope('ACTIVE')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition flex items-start space-x-3 ${
                      backupScope === 'ACTIVE'
                        ? 'bg-blue-950/40 border-blue-500/80 text-white shadow-md'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="mt-0.5">
                      <input
                        type="radio"
                        checked={backupScope === 'ACTIVE'}
                        onChange={() => setBackupScope('ACTIVE')}
                        className="cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-200">
                        Current Store Database ({activeVertical})
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Backs up isolated SQLite database <code className="text-blue-300">omnibill_{activeVertical.toLowerCase()}.db</code> including inventory, ledger, and sales.
                      </p>
                    </div>
                  </div>

                  <div
                    onClick={() => setBackupScope('ALL')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition flex items-start space-x-3 ${
                      backupScope === 'ALL'
                        ? 'bg-purple-950/40 border-purple-500/80 text-white shadow-md'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="mt-0.5">
                      <input
                        type="radio"
                        checked={backupScope === 'ALL'}
                        onChange={() => setBackupScope('ALL')}
                        className="cursor-pointer"
                      />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-200">
                        All 4 Businesses (Master Enterprise Archive)
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Backs up all 4 databases (Retail, Wholesale, School, Hospital) in one complete snapshot.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Optional AES-256 Encryption */}
                <div className="pt-3 border-t border-slate-800/80 space-y-2">
                  <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useEncryption}
                      onChange={(e) => setUseEncryption(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-0 cursor-pointer"
                    />
                    <span className="font-semibold flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-amber-400" />
                      Encrypt Backup with AES-256-GCM & Passphrase (Recommended for USB Storage)
                    </span>
                  </label>

                  {useEncryption && (
                    <div className="pl-6 pt-1 max-w-md">
                      <input
                        type="password"
                        placeholder="Enter encryption passphrase..."
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
                      />
                      <p className="text-[10px] text-amber-400/80 mt-1">
                        ⚠️ Remember this passphrase. It will be strictly required when restoring this archive.
                      </p>
                    </div>
                  )}
                </div>

                {/* Action Button */}
                <div className="pt-2">
                  <button
                    onClick={handleExecuteBackup}
                    disabled={loading || (useEncryption && !passphrase.trim())}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl font-bold text-xs flex items-center space-x-2 shadow-lg shadow-blue-600/30 transition cursor-pointer"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Creating Zero-Lock Snapshot...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        <span>Create Instant 1-Click Backup</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* SUCCESS RESULTS CARD - SINGLE BACKUP */}
              {lastCreatedBackup && (
                <div className="bg-slate-950 border border-emerald-500/50 rounded-xl p-4 space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-emerald-400 font-bold text-xs uppercase tracking-wide">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Backup Generated & Verified</span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400">
                      ID: {lastCreatedBackup.backup_id}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                    <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                      <span className="block text-[9px] text-slate-500 uppercase">Schema Version</span>
                      <span className="font-mono font-bold text-white">v{lastCreatedBackup.schema_version}</span>
                    </div>
                    <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                      <span className="block text-[9px] text-slate-500 uppercase">Archive Size</span>
                      <span className="font-mono font-bold text-white">{formatBytes(lastCreatedBackup.total_bytes)}</span>
                    </div>
                    <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                      <span className="block text-[9px] text-slate-500 uppercase">Timestamp</span>
                      <span className="font-mono text-slate-300">{new Date(lastCreatedBackup.created_at).toLocaleTimeString()}</span>
                    </div>
                    <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                      <span className="block text-[9px] text-slate-500 uppercase">Format</span>
                      <span className="font-mono font-bold text-blue-400">OMNIBACKUP_V1</span>
                    </div>
                  </div>

                  <div className="p-2 bg-slate-900 rounded-lg border border-slate-800 flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-400 truncate mr-2">
                      SHA256: <span className="text-slate-200">{lastCreatedBackup.sha256_checksum}</span>
                    </span>
                    <button
                      onClick={() => handleCopyChecksum(lastCreatedBackup.sha256_checksum)}
                      className="text-blue-400 hover:text-blue-300 p-1 shrink-0 flex items-center gap-1 cursor-pointer"
                      title="Copy SHA-256 Checksum"
                    >
                      {copiedChecksum ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {lastCreatedBackup.base64_data && (
                    <div className="pt-2 flex items-center space-x-3">
                      <button
                        onClick={() =>
                          BackupService.downloadBase64Backup(
                            lastCreatedBackup.base64_data!,
                            lastCreatedBackup.filename || `omnibill_backup_${activeVertical.toLowerCase()}.omnibackup`
                          )
                        }
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs flex items-center space-x-1.5 transition cursor-pointer"
                      >
                        <Download className="w-4 h-4" />
                        <span>Download Backup File (.omnibackup) to Local PC / USB</span>
                      </button>
                      <span className="text-[11px] text-slate-400">
                        Saved on server disk: <code className="text-slate-300">{lastCreatedBackup.out_path}</code>
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* SUCCESS RESULTS CARD - ALL BACKUPS */}
              {allBackupsResult && (
                <div className="bg-slate-950 border border-purple-500/50 rounded-xl p-4 space-y-3 animate-in fade-in">
                  <div className="flex items-center space-x-2 text-purple-400 font-bold text-xs uppercase tracking-wide">
                    <Layers className="w-4 h-4" />
                    <span>Master All-Vertical Backup Complete ({allBackupsResult.backups.length} Databases)</span>
                  </div>

                  <div className="divide-y divide-slate-800">
                    {allBackupsResult.backups.map((b) => (
                      <div key={b.vertical} className="py-2.5 flex items-center justify-between text-xs">
                        <div>
                          <span className="font-bold uppercase text-white font-mono mr-2">
                            {b.vertical}:
                          </span>
                          <span className="text-slate-400 font-mono text-[11px]">{b.filename}</span>
                        </div>
                        <div className="flex items-center space-x-3">
                          <span className="font-mono text-slate-300 font-bold">
                            {formatBytes(b.metadata.total_bytes)}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold font-mono">
                            SHA256 OK
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: 1-CLICK RESTORE */}
          {activeTab === 'RESTORE' && (
            <div className="space-y-6">
              <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-4 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-rose-300 flex items-center gap-2">
                  <Upload className="w-4 h-4 text-rose-400" />
                  Restore Database from .omnibackup Archive
                </h3>

                {/* Upload input */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-2">
                    Select .omnibackup Archive File:
                  </label>
                  <input
                    type="file"
                    accept=".omnibackup,.db"
                    onChange={handleFileChange}
                    className="block w-full text-xs text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700 cursor-pointer"
                  />
                  {selectedFile && (
                    <div className="mt-2 text-xs text-slate-300 flex items-center gap-2">
                      <FileCheck2 className="w-4 h-4 text-emerald-400" />
                      <span>Loaded: <strong className="text-white font-mono">{selectedFile.name}</strong> ({formatBytes(selectedFile.size)})</span>
                    </div>
                  )}
                </div>

                {/* Passphrase if needed */}
                <div className="max-w-md space-y-1">
                  <label className="block text-xs font-medium text-slate-300">
                    Decryption Passphrase (if backup was encrypted):
                  </label>
                  <input
                    type="password"
                    placeholder="Leave blank if backup is unencrypted"
                    value={restorePassphrase}
                    onChange={(e) => setRestorePassphrase(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 font-mono"
                  />
                </div>

                {/* Safeguard Assurance Banner */}
                <div className="p-3 bg-blue-950/40 border border-blue-500/40 rounded-xl text-xs text-blue-200 flex items-start space-x-2.5">
                  <ShieldAlert className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Automated Safety Snapshot Protection:</span>
                    <p className="text-[11px] text-blue-300/80 mt-0.5">
                      Before applying this restore, OmniBill will automatically create a pre-restore safety snapshot of your current database. You will never lose current data accidentally.
                    </p>
                  </div>
                </div>

                {/* Confirmation Checkbox */}
                <div className="pt-2">
                  <label className="flex items-center space-x-2 text-xs text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={restoreConfirmed}
                      onChange={(e) => setRestoreConfirmed(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-rose-600 focus:ring-0 cursor-pointer"
                    />
                    <span className="font-semibold text-rose-300">
                      I understand this will overwrite active database records for {activeVertical} with the backup snapshot.
                    </span>
                  </label>
                </div>

                {/* Execute Button */}
                <div className="pt-2">
                  <button
                    onClick={handleExecuteRestore}
                    disabled={loading || !selectedFile || !restoreConfirmed}
                    className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white rounded-xl font-bold text-xs flex items-center space-x-2 shadow-lg shadow-rose-600/30 transition cursor-pointer"
                  >
                    {loading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Verifying Ledger & Restoring...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        <span>Verify & Restore Database Now</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* RESTORE SUCCESS SUMMARY */}
              {restoreSuccessPath && (
                <div className="bg-slate-950 border border-emerald-500/60 rounded-xl p-4 space-y-2 animate-in fade-in">
                  <div className="flex items-center space-x-2 text-emerald-400 font-bold text-xs">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Database Successfully Restored & Reconciled!</span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Restored Target: <code className="font-mono text-emerald-300">{restoreSuccessPath}</code>
                  </p>
                  {preRestoreSafetyPath && (
                    <p className="text-[11px] text-slate-400">
                      Safety Snapshot Saved: <code className="font-mono text-slate-300">{preRestoreSafetyPath}</code>
                    </p>
                  )}
                  <div className="pt-2">
                    <button
                      onClick={() => window.location.reload()}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      Reload Application Data Now
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: PHYSICAL DATABASE HEALTH & ARCHIVES */}
          {activeTab === 'HEALTH' && (
            <div className="space-y-6">
              
              {/* Database Health Grid */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-emerald-400" />
                    Physical SQLite Database Files ({healthList.length} Isolated Databases)
                  </h3>
                  <button
                    onClick={refreshHealthAndHistory}
                    disabled={loading}
                    className="text-xs font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    <span>Re-Run SQLite Diagnostics</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {healthList.map((db) => (
                    <div
                      key={db.vertical}
                      className={`p-3.5 rounded-xl border bg-slate-950/60 transition ${
                        db.vertical === activeVertical
                          ? 'border-blue-500/60 shadow-md shadow-blue-500/10'
                          : 'border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-xs text-white uppercase font-mono">
                            {db.vertical}
                          </span>
                          {db.vertical === activeVertical && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] bg-blue-500/20 text-blue-300 border border-blue-500/30 font-bold uppercase">
                              Active Counter
                            </span>
                          )}
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                            db.is_healthy
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          {db.is_healthy ? '✓ B-TREE HEALTHY' : 'CORRUPT / MISSING'}
                        </span>
                      </div>

                      <div className="mt-2 text-[11px] font-mono text-slate-400 truncate" title={db.path}>
                        {db.path}
                      </div>

                      <div className="mt-2.5 grid grid-cols-3 gap-2 text-[10px] font-mono pt-2 border-t border-slate-800/80">
                        <div>
                          <span className="text-slate-500 block">FILE SIZE</span>
                          <span className="text-slate-200 font-bold">{formatBytes(db.size_bytes)}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">SCHEMA</span>
                          <span className="text-slate-200 font-bold">v{db.schema_version}</span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">PRAGMA</span>
                          <span className="text-emerald-400 font-bold">{db.integrity}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Local Backups Directory History */}
              <div className="space-y-3 pt-4 border-t border-slate-800">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-purple-400" />
                  Recent Local Backup Archives (~/omnibill_backups/)
                </h3>

                {historyList.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
                    No backup archives found yet. Create your first 1-click backup in the Backup tab!
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800 border border-slate-800 rounded-xl overflow-hidden bg-slate-950/40">
                    {historyList.map((item) => (
                      <div
                        key={item.filename}
                        className="p-3 flex items-center justify-between text-xs hover:bg-slate-900/60 transition"
                      >
                        <div className="space-y-0.5 max-w-[65%]">
                          <div className="flex items-center space-x-2">
                            <span className="font-mono font-bold text-white text-[11px]">
                              {item.filename}
                            </span>
                            <span className="px-1.5 py-0.2 rounded text-[9px] bg-slate-800 text-slate-300 font-mono">
                              {item.vertical}
                            </span>
                            {item.details.encrypted && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] bg-amber-500/10 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                                <Lock className="w-2.5 h-2.5" /> AES-256
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500 truncate">
                            SHA: {item.details.checksum || 'N/A'} • {new Date(item.modified_ms).toLocaleString()}
                          </div>
                        </div>

                        <div className="flex items-center space-x-3 shrink-0">
                          <span className="font-mono text-slate-300 text-xs font-bold">
                            {formatBytes(item.size_bytes)}
                          </span>
                          <button
                            onClick={async () => {
                              setSelectedFile(new File([], item.filename));
                              setActiveTab('RESTORE');
                            }}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold border border-slate-700 transition cursor-pointer"
                          >
                            Select for Restore
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-800 flex items-center justify-between bg-slate-950/80 text-[11px] text-slate-500 shrink-0">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
            <span>Zero-Lock SQLite Online Backup API • SHA-256 Verification</span>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
