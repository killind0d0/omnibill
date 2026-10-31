export interface TenantSummary {
  id: string;
  business_name: string;
  vertical: string;
  plan: string;
  valid_until_day: number;
  status: string;
  computed_status: string;
  max_counters: number;
  offline_days: number;
  grace_days: number;
  export_permit_until_ms: number;
  created_ms: number;
  notes: string;
  active_devices: number;
  last_checkin_ms: number;
  license_key?: string;
  valid_until?: string;
  sha?: string;
  gstin?: string;
  support_contact?: string;
  raw_payload?: any;
}

export interface DeviceInfo {
  device_id: string;
  app_version: string;
  first_activated_ms: number;
  last_checkin_ms: number;
  revoked: boolean;
}

export interface DeviceItem {
  id: string;
  tenant_id: string;
  activated_ms: number;
  last_checkin_ms: number;
  app_version: string;
  revoked: boolean;
}

export interface AuditEntry {
  id: number;
  seq?: number;
  prev_hash?: string;
  event_hash?: string;
  admin_id: number | null;
  admin_username?: string;
  action?: string;
  event_type?: string;
  tenant_id: string | null;
  detail?: string;
  details?: string;
  ts_ms?: number;
  created_ms?: number;
}

export interface UsageEntry {
  id?: number;
  tenant_id: string;
  device_id: string;
  day?: number;
  bills_24h: number;
  active_users: number;
  last_login_day: number;
  counters_paired: number;
  app_version?: string;
  reported_ms?: number;
  received_ms?: number;
}

export interface AdminMe {
  admin_id: number;
  username: string;
}

export interface CreateTenantResponse {
  tenant_id: string;
  owner_username: string;
  temp_password: string;
}

export interface MarkPaidDryRunResponse {
  new_valid_until_day: number;
  formatted_new_date: string;
}
