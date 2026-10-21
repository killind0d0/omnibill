export interface BootState {
  has_primary_owner: boolean;
  vertical: string;
  plan: string;
  key_missing?: boolean;
}

export interface AuthenticatedUser {
  id: number;
  username: string;
  display_name: string;
  role: string;
  is_primary_owner: boolean;
  must_change_password: boolean;
}

export interface ClientSession {
  token: string;
  user: AuthenticatedUser;
  vertical: string;
}

export interface AccessStatus {
  mode: 'full' | 'read_only' | 'unlicensed';
  reason?: string | null;
  valid_until_day?: number | null;
  plan?: string | null;
  features?: string[];
  max_counters?: number;
  last_checkin_ms?: number;
  support_text?: string;
  user_id?: number | null;
  username?: string | null;
  role?: string | null;
  vertical?: string;
  is_primary_owner?: boolean;
}

export interface ActivateResult {
  success: boolean;
  tenant_id?: string;
  business_name?: string;
  vertical?: string;
  plan?: string;
  device_id?: string;
  error?: string;
}
