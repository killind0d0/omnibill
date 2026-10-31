#!/usr/bin/env python3
"""
OmniBill — Automated GitHub Serverless License Sync Tool
Commits and pushes signed customer license files directly to your GitHub repository
using the GitHub Contents API without requiring git clone.
"""

import argparse
import base64
import glob
import json
import os
import sys
import urllib.request
import urllib.error

DEFAULT_REPO = "killind0d0/omnibill-licenses"

def get_file_sha(repo: str, file_path: str, token: str) -> str | None:
    url = f"https://api.github.com/repos/{repo}/contents/{file_path}"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "OmniBill-License-Sync"
        }
    )
    try:
        with urllib.request.urlopen(req) as response:
            if response.status == 200:
                data = json.loads(response.read().decode("utf-8"))
                return data.get("sha")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise e
    return None

def push_file(repo: str, file_path: str, content_bytes: bytes, message: str, token: str) -> dict:
    sha = get_file_sha(repo, file_path, token)
    base64_content = base64.b64encode(content_bytes).decode("ascii")

    url = f"https://api.github.com/repos/{repo}/contents/{file_path}"
    payload = {
        "message": message,
        "content": base64_content,
        "branch": "main"
    }
    if sha:
        payload["sha"] = sha

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="PUT",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "OmniBill-License-Sync"
        }
    )

    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))

def main():
    parser = argparse.ArgumentParser(description="Push signed licenses to GitHub registry.")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="GitHub target repo (e.g. killind0d0/omnibill-licenses)")
    parser.add_argument("--token", help="GitHub Personal Access Token (or GITHUB_TOKEN env var)")
    parser.add_argument("--file", help="Specific license JSON file to push")
    parser.add_argument("--all", action="store_true", help="Push all licenses in licenses/ directory")
    args = parser.parse_args()

    token = args.token or os.environ.get("GITHUB_TOKEN") or os.environ.get("OMNIBILL_GITHUB_TOKEN")
    if not token:
        print("❌ Error: GitHub Token is required. Pass via --token <TOKEN> or export GITHUB_TOKEN=<TOKEN>")
        sys.exit(1)

    files_to_push = []
    if args.file:
        files_to_push.append(args.file)
    elif args.all:
        files_to_push = glob.glob("/home/killindodo/omnibill/licenses/*.json")
    else:
        print("❌ Error: Specify --file <PATH> or --all to sync all licenses.")
        sys.exit(1)

    if not files_to_push:
        print("⚠️ No license files found to push.")
        sys.exit(0)

    print(f"🚀 Pushing {len(files_to_push)} license(s) to GitHub: {args.repo}...")

    for fpath in files_to_push:
        fname = os.path.basename(fpath)
        dest_path = f"licenses/{fname}"
        with open(fpath, "rb") as f:
            content = f.read()

        try:
            parsed = json.loads(content)
            bname = parsed.get("business_name", fname)
            msg = f"Auto-sync license for {bname}"
            result = push_file(args.repo, dest_path, content, msg, token)
            html_url = result.get("content", {}).get("html_url", dest_path)
            print(f"  ✅ {fname} -> {html_url}")
        except Exception as e:
            print(f"  ❌ Failed to push {fname}: {e}")

    print("\n🎉 License sync complete! Clients can now activate online using their license key.")

if __name__ == "__main__":
    main()
