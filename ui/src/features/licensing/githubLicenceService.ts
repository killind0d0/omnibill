// ui/src/features/licensing/githubLicenceService.ts
// Automated GitHub-Powered Serverless License Verification Service for OmniBill

import { posStorage } from '../../lib/api';
import { BusinessProfile } from '../../types/pos';

export interface OnlineLicensePayload {
  version: number;
  license_key: string;
  tenant_id: string;
  business_name: string;
  legal_name?: string;
  gstin: string;
  phone?: string;
  email?: string;
  address_line1?: string;
  city?: string;
  state_code?: string;
  postal_code?: string;
  vertical: 'retail' | 'wholesale' | 'school' | 'hospital';
  plan: 'basic' | 'pro';
  max_counters: number;
  valid_until: string; // "YYYY-MM-DD"
  valid_until_day: number; // Civil day count
  status: 'active' | 'suspended' | 'expired';
  support_contact: string;
  signature?: string;
  last_verified_ms?: number;
}

export interface LicenseVerificationResult {
  valid: boolean;
  isOffline: boolean;
  reason?: 'expired' | 'suspended' | 'not_found' | 'unlicensed' | 'error';
  license?: OnlineLicensePayload;
  message?: string;
  supportContact?: string;
}

const STORAGE_KEY_LICENSE = 'omnibill_online_license';
const STORAGE_KEY_REGISTRY_BASE = 'omnibill_license_registry_base';
const DEFAULT_REGISTRY_BASE = 'https://raw.githubusercontent.com/killind0d0/omnibill-licenses/main/licenses';

export class GithubLicenceService {
  /**
   * Retrieves the current registry base URL from storage or default.
   */
  public static getRegistryBaseUrl(): string {
    if (typeof window !== 'undefined') {
      try {
        const custom = localStorage.getItem(STORAGE_KEY_REGISTRY_BASE);
        if (custom) return custom.trim().replace(/\/$/, '');
      } catch {}
    }
    return DEFAULT_REGISTRY_BASE;
  }

  /**
   * Allows setting a custom GitHub repo registry URL if needed.
   */
  public static setRegistryBaseUrl(url: string): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_REGISTRY_BASE, url.trim().replace(/\/$/, ''));
    }
  }

  /**
   * Loads the cached license payload from localStorage.
   */
  public static getStoredLicense(): OnlineLicensePayload | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY_LICENSE);
      if (!raw) return null;
      return JSON.parse(raw) as OnlineLicensePayload;
    } catch {
      return null;
    }
  }

  /**
   * Saves the verified license into localStorage and syncs business profile.
   */
  public static saveLicense(license: OnlineLicensePayload): void {
    if (typeof window === 'undefined') return;
    try {
      const enriched: OnlineLicensePayload = {
        ...license,
        last_verified_ms: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY_LICENSE, JSON.stringify(enriched));

      // Automatically sync store profile so daily counter uses real trade name & GSTIN
      const profile: BusinessProfile = {
        id: license.tenant_id,
        trade_name: license.business_name,
        legal_name: license.legal_name || license.business_name,
        gstin: license.gstin,
        state_code: license.state_code || license.gstin.slice(0, 2) || '27',
        phone: license.phone || '+91 98200 12345',
        email: license.email || 'support@omnibill.local',
        address_line1: license.address_line1 || 'Store Premises',
        city: license.city || 'Mumbai',
        postal_code: license.postal_code || '400001',
        upi_vpa: '',
      };
      posStorage.setBusinessProfile(profile);

      // Lock vertical
      localStorage.setItem('omnibill_active_vertical', license.vertical.toUpperCase());
    } catch (err) {
      console.error('Failed to cache verified license:', err);
    }
  }

  /**
   * Computes current civil IST day index from timestamp.
   */
  public static getCivilDay(nowMs: number = Date.now()): number {
    return Math.floor((nowMs + 19800000) / 86400000);
  }

  /**
   * Main Automated Startup Verification:
   * 1. Checks online GitHub registry first (with fast 2.5s timeout).
   * 2. If online: validates status and date, updates local storage.
   * 3. If offline: validates cached local license.
   * 4. If expired or suspended: returns valid: false with developer contact info.
   */
  public static async verifyLicense(licenseKeyInput?: string): Promise<LicenseVerificationResult> {
    const cached = this.getStoredLicense();
    const targetKey = (licenseKeyInput || cached?.license_key || '').trim().toUpperCase();

    if (!targetKey) {
      return {
        valid: false,
        isOffline: false,
        reason: 'unlicensed',
        message: 'No license key configured on this device.',
        supportContact: '+91 98765 43210 • dev@omnibill.com',
      };
    }

    const registryUrl = `${this.getRegistryBaseUrl()}/${encodeURIComponent(targetKey)}.json`;
    const todayDay = this.getCivilDay();

    try {
      // 1. Attempt online verification from GitHub with 2500ms timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const response = await fetch(registryUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const onlinePayload: OnlineLicensePayload = await response.json();

        // Check if suspended
        if (onlinePayload.status === 'suspended') {
          return {
            valid: false,
            isOffline: false,
            reason: 'suspended',
            license: onlinePayload,
            message: `Subscription for ${onlinePayload.business_name} is suspended. Please contact developer.`,
            supportContact: onlinePayload.support_contact,
          };
        }

        // Check date expiry
        const expiryDay = onlinePayload.valid_until_day || this.parseIsoToCivilDay(onlinePayload.valid_until);
        if (todayDay > expiryDay) {
          return {
            valid: false,
            isOffline: false,
            reason: 'expired',
            license: onlinePayload,
            message: `Subscription for ${onlinePayload.business_name} expired on ${onlinePayload.valid_until}.`,
            supportContact: onlinePayload.support_contact,
          };
        }

        // Online check succeeded and valid! Cache it locally
        this.saveLicense(onlinePayload);

        return {
          valid: true,
          isOffline: false,
          license: onlinePayload,
          supportContact: onlinePayload.support_contact,
        };
      } else if (response.status === 404) {
        // License key not found on GitHub registry
        if (!cached) {
          return {
            valid: false,
            isOffline: false,
            reason: 'not_found',
            message: `License key "${targetKey}" was not found in the developer registry.`,
            supportContact: '+91 98765 43210 • dev@omnibill.com',
          };
        }
      }
    } catch {
      // Network offline, timeout, or DNS failure — fallback to local cached verification
    }

    // 2. Offline Fallback Verification using local cached license
    if (cached && cached.license_key.toUpperCase() === targetKey) {
      if (cached.status === 'suspended') {
        return {
          valid: false,
          isOffline: true,
          reason: 'suspended',
          license: cached,
          message: `Subscription for ${cached.business_name} is currently suspended.`,
          supportContact: cached.support_contact,
        };
      }

      const expiryDay = cached.valid_until_day || this.parseIsoToCivilDay(cached.valid_until);
      if (todayDay > expiryDay) {
        return {
          valid: false,
          isOffline: true,
          reason: 'expired',
          license: cached,
          message: `Subscription for ${cached.business_name} expired on ${cached.valid_until}.`,
          supportContact: cached.support_contact,
        };
      }

      return {
        valid: true,
        isOffline: true,
        license: cached,
        supportContact: cached.support_contact,
      };
    }

    return {
      valid: false,
      isOffline: true,
      reason: 'unlicensed',
      message: 'Unable to verify license online and no valid offline license found.',
      supportContact: '+91 98765 43210 • dev@omnibill.com',
    };
  }

  /**
   * Helper to parse ISO date string "YYYY-MM-DD" into civil day index.
   */
  public static parseIsoToCivilDay(isoStr?: string): number {
    if (!isoStr) return 0;
    try {
      const parts = isoStr.split('-');
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        return Math.floor((d.getTime() + 19800000) / 86400000);
      }
    } catch {}
    return 0;
  }

  /**
   * Validates a license payload (e.g. from an imported JSON file) and saves it if valid.
   */
  public static validateAndApplyPayload(payload: any): LicenseVerificationResult {
    if (!payload || typeof payload !== 'object') {
      return {
        valid: false,
        isOffline: true,
        reason: 'error',
        message: 'License payload is empty or invalid format.',
      };
    }

    const key = (payload.license_key || payload.payload?.license_key || '').trim().toUpperCase();
    if (!key) {
      return {
        valid: false,
        isOffline: true,
        reason: 'unlicensed',
        message: 'License key code is missing in file.',
        supportContact: payload.support_contact,
      };
    }

    const license: OnlineLicensePayload = {
      version: payload.version || 1,
      license_key: key,
      tenant_id: payload.tenant_id || `T-${payload.gstin || 'OMNIBILL'}`,
      business_name: payload.business_name || 'OmniBill Store',
      legal_name: payload.legal_name || payload.business_name,
      gstin: payload.gstin || '27AABCR1234D1Z5',
      phone: payload.phone,
      email: payload.email,
      address_line1: payload.address_line1,
      city: payload.city,
      state_code: payload.state_code,
      postal_code: payload.postal_code,
      vertical: (payload.vertical || 'retail').toLowerCase(),
      plan: (payload.plan || 'pro').toLowerCase(),
      max_counters: payload.max_counters || 1,
      valid_until: payload.valid_until || '2099-12-31',
      valid_until_day: payload.valid_until_day || this.parseIsoToCivilDay(payload.valid_until),
      status: payload.status || 'active',
      support_contact: payload.support_contact || '+91 98765 43210 • dev@omnibill.com',
      signature: payload.signature,
      last_verified_ms: Date.now(),
    };

    if (license.status === 'suspended') {
      return {
        valid: false,
        isOffline: true,
        reason: 'suspended',
        license,
        message: `Subscription for ${license.business_name} is suspended.`,
        supportContact: license.support_contact,
      };
    }

    const todayDay = this.getCivilDay();
    const expiryDay = license.valid_until_day || this.parseIsoToCivilDay(license.valid_until);
    if (todayDay > expiryDay) {
      return {
        valid: false,
        isOffline: true,
        reason: 'expired',
        license,
        message: `Subscription for ${license.business_name} expired on ${license.valid_until}.`,
        supportContact: license.support_contact,
      };
    }

    // Save valid license into cache & synchronize profile
    this.saveLicense(license);

    return {
      valid: true,
      isOffline: true,
      license,
      supportContact: license.support_contact,
    };
  }
}
