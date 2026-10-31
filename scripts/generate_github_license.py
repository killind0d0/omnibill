#!/usr/bin/env python3
"""
OmniBill Commercial License Generator
Generates cryptographically signed JSON license files for GitHub-based or offline verification.

Usage:
    python3 scripts/generate_github_license.py \
        --key RAMESH-KIRANA \
        --business "Ramesh Kirana Store" \
        --gstin "27AABCR1234D1Z5" \
        --vertical retail \
        --plan pro \
        --counters 3 \
        --valid-until "2027-10-31" \
        --support "+91 98765 43210 • dev@omnibill.com" \
        --out-dir ./licenses
"""

import os
import sys
import json
import base64
import argparse
from datetime import datetime, timezone
from cryptography.hazmat.primitives.asymmetric import ed25519

DEFAULT_PRIVATE_KEY = os.path.expanduser("~/omnibill/control-plane/keys/vendor_private.bin")

def calculate_civil_day(date_str: str) -> int:
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    epoch_ms = int(dt.timestamp() * 1000)
    return (epoch_ms + 19800000) // 86400000

def generate_license(
    license_key: str,
    business_name: str,
    gstin: str,
    vertical: str,
    plan: str,
    max_counters: int,
    valid_until: str,
    status: str,
    support_contact: str,
    private_key_path: str,
    out_dir: str
) -> str:
    key_file = os.path.expanduser(private_key_path)
    if not os.path.exists(key_file):
        raise FileNotFoundError(f"Vendor private key not found at: {key_file}")

    with open(key_file, "rb") as f:
        priv_bytes = f.read(32)

    private_key = ed25519.Ed25519PrivateKey.from_private_bytes(priv_bytes)
    tenant_id = f"T-{gstin.upper()}"
    valid_until_day = calculate_civil_day(valid_until)

    payload = {
        "version": 1,
        "license_key": license_key.upper().strip(),
        "tenant_id": tenant_id,
        "business_name": business_name.strip(),
        "gstin": gstin.upper().strip(),
        "vertical": vertical.lower().strip(),
        "plan": plan.lower().strip(),
        "max_counters": max_counters,
        "valid_until": valid_until.strip(),
        "valid_until_day": valid_until_day,
        "status": status.lower().strip(),
        "support_contact": support_contact.strip(),
        "issued_ms": int(datetime.now(timezone.utc).timestamp() * 1000)
    }

    # Canonical bytes for signing
    canonical_json = json.dumps(payload, sort_keys=True, separators=(',', ':')).encode('utf-8')
    sig_bytes = private_key.sign(canonical_json)
    sig_b64 = base64.urlsafe_b64encode(sig_bytes).decode('utf-8').rstrip('=')

    full_envelope = {
        **payload,
        "signature": sig_b64
    }

    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{license_key.upper().strip()}.json")
    with open(out_path, "w", encoding="utf-8") as out_f:
        json.dump(full_envelope, out_f, indent=2)

    print(f"✅ Generated signed license for '{business_name}' -> {out_path}")
    print(f"   Status: {status.upper()} | Plan: {plan.upper()} | Valid Until: {valid_until}")
    return out_path

def main():
    parser = argparse.ArgumentParser(description="Generate signed OmniBill customer license JSON")
    parser.add_argument("--key", required=True, help="License Key Code (e.g. RAMESH-KIRANA)")
    parser.add_argument("--business", required=True, help="Registered Trade Name")
    parser.add_argument("--gstin", default="27AABCR1234D1Z5", help="Business GSTIN")
    parser.add_argument("--vertical", default="retail", choices=["retail", "wholesale", "school", "hospital"])
    parser.add_argument("--plan", default="pro", choices=["basic", "pro"])
    parser.add_argument("--counters", type=int, default=3, help="Max billing terminals quota")
    parser.add_argument("--valid-until", default="2027-10-31", help="Expiry date YYYY-MM-DD")
    parser.add_argument("--status", default="active", choices=["active", "suspended", "expired"])
    parser.add_argument("--support", default="+91 98765 43210 • dev@omnibill.com")
    parser.add_argument("--privkey", default=DEFAULT_PRIVATE_KEY)
    parser.add_argument("--out-dir", default=os.path.expanduser("~/omnibill/licenses"))

    args = parser.parse_args()
    generate_license(
        license_key=args.key,
        business_name=args.business,
        gstin=args.gstin,
        vertical=args.vertical,
        plan=args.plan,
        max_counters=args.counters,
        valid_until=args.valid_until,
        status=args.status,
        support_contact=args.support,
        private_key_path=args.privkey,
        out_dir=args.out_dir
    )

if __name__ == "__main__":
    main()
