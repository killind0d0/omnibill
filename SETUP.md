# OmniBill ERP — Developer Setup Guide

This guide provides instructions for setting up the OmniBill ERP development environment on **Windows**, **Linux**, and **macOS**.

---

## 💻 System Prerequisites

| Dependency | Minimum Version | Recommended Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Rust Toolchain** | `1.85.0` (Edition 2024) | `stable` (latest) | Core backend, database engine & IPC |
| **Node.js** | `v18.0.0` | `v20.x` or `v24.x` LTS | Frontend tooling & Tauri CLI |
| **npm** | `v9.0.0` | `v10.x` or `v11.x` | Package management |
| **C/C++ Compiler** | C++17 compatible | Visual Studio 2022 / GCC 12+ / Clang 15+ | Compiling native SQLite (`bundled`) & WebView2 |

---

## 🛠️ Step-by-Step Platform Setup

### 1. Windows (Windows 10 / 11 64-bit)

#### A. Install Microsoft C++ Build Tools
Tauri and the `rusqlite` bundled C library require MSVC build tools:
1. Download **Visual Studio Build Tools 2022** from [visualstudio.microsoft.com](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
2. In the installer, select the workload: **"Desktop development with C++"**.
3. Ensure the following optional components are checked:
   * MSVC v143 - VS 2022 C++ x64/x86 build tools
   * Windows 10 or 11 SDK

*Alternative via winget:*
```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --force --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools;includeRecommended"
```

#### B. Install WebView2
WebView2 is included by default on Windows 11 and up-to-date Windows 10 installations. If missing, download the Evergreen Bootstrapper from [developer.microsoft.com/microsoft-edge/webview2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

#### C. Install Rust & Node.js
```powershell
# Install Rust
winget install Rustlang.Rustup
rustup default stable
rustup component add clippy rustfmt

# Install Node.js
winget install OpenJS.NodeJS.LTS
```

---

### 2. Linux (Ubuntu / Debian / Fedora / Arch)

#### Ubuntu / Debian
```bash
# Update repositories
sudo apt-get update

# Install C compiler, WebKit2GTK, and system libraries required for Tauri
sudo apt-get install -y \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libxdo-dev

# Install Rust via rustup
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustup component add clippy rustfmt

# Install Node.js (via NodeSource LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### Fedora
```bash
sudo dnf check-update
sudo dnf install -y \
  @development-tools \
  curl \
  wget \
  openssl-devel \
  webkit2gtk4.1-devel \
  libappindicator-gtk3-devel \
  librsvg2-devel \
  libxdo-devel

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
sudo dnf install -y nodejs
```

#### Arch Linux
```bash
sudo pacman -Syu --needed \
  base-devel \
  curl \
  wget \
  openssl \
  webkit2gtk-4.1 \
  libappindicator-gtk3 \
  librsvg \
  xdotool \
  rustup \
  nodejs \
  npm

rustup default stable
rustup component add clippy rustfmt
```

---

### 3. macOS (Apple Silicon M-Series / Intel)

#### A. Install Xcode Command Line Tools
```bash
xcode-select --install
```

#### B. Install Rust & Node.js via Homebrew
```bash
# Install Homebrew if not already installed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node@20

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustup component add clippy rustfmt
```

---

## 🚀 Repository Installation & Verification

### 1. Clone Repository
```bash
git clone https://github.com/killind0d0/omnibill.git
cd omnibill
```

### 2. Install Node Dependencies
```bash
npm install
```

### 3. Run Test Suite
Verify that your Rust toolchain, SQLite bindings, and database migrations are working properly:
```bash
npm test
```
*Expected Output:*
```text
running 58 tests
test database::tests::test_1_fresh_db_migrates_to_latest_user_version ... ok
test database::tests::test_3_all_pragmas_set_as_specified ... ok
test database::tests::test_11_verify_ledger_detects_unbalanced_transactions ... ok
test database::tests::test_20_transactions_update_guard_rules ... ok
test posting::sale::tests::test_11_valid_intra_state_sale_posting ... ok
...
test result: ok. 58 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

---

## 🏃 Running in Development Mode

Run OmniBill with native UI and hot module reloading:

```bash
npm run dev
# Or alternatively:
npm run tauri dev
```

During development:
* Database files (`omnibill.db`, `omnibill.db-wal`, `omnibill.db-shm`) are isolated in the local working directory or OS application data folder.
* Rust backend changes trigger incremental recompilation.
* Frontend code updates with Hot Module Replacement (HMR).

---

## 📦 Building Production Release Bundles

To produce standalone, optimized production installers (<15 MB):

```bash
npm run build
# Or alternatively:
npm run tauri build
```

### Release Profile Size Optimizations
The build uses release optimizations configured in `src-tauri/Cargo.toml`:
```toml
[profile.release]
opt-level = "z"       # Optimize for minimum binary size
lto = true            # Link-Time Optimization across all crates
codegen-units = 1     # Single compilation unit for maximum optimization
panic = "abort"       # Strips landing pads for stack unwinding
strip = true          # Strips symbols and debug information
```

### Output Artifact Locations

* **Windows**:
  * Standalone Executable: `src-tauri/target/release/omnibill.exe`
  * MSI Installer: `src-tauri/target/release/bundle/msi/OmniBill ERP_*.msi`
  * NSIS Setup: `src-tauri/target/release/bundle/nsis/OmniBill ERP_*-setup.exe`
* **Linux**:
  * Standalone Executable: `src-tauri/target/release/omnibill`
  * Debian Package: `src-tauri/target/release/bundle/deb/omnibill_*_amd64.deb`
  * AppImage: `src-tauri/target/release/bundle/appimage/omnibill_*_amd64.AppImage`
* **macOS**:
  * Application Bundle: `src-tauri/target/release/bundle/macos/OmniBill ERP.app`
  * DMG Image: `src-tauri/target/release/bundle/dmg/OmniBill ERP_*.dmg`

---

## 🔍 Verification & Linting Commands

```bash
# Run unit & integration test suite
npm test

# Run Rust linter (Clippy)
npm run lint

# Check code formatting
npm run format
```

---

## ❓ Troubleshooting

### 1. Linux: `Package webkit2gtk-4.1 was not found in the pkg-config search path`
* **Cause**: Missing WebKit2GTK 4.1 development headers.
* **Fix**: Run `sudo apt-get install -y libwebkit2gtk-4.1-dev` (Ubuntu/Debian) or `sudo dnf install webkit2gtk4.1-devel` (Fedora).

### 2. Windows: Linker error `LINK : fatal error LNK1181: cannot open input file 'windowsapp.lib'`
* **Cause**: Visual Studio C++ Build Tools installed without the Windows SDK.
* **Fix**: Re-run the Visual Studio Installer, click **Modify**, select **Desktop development with C++**, and ensure **Windows 10/11 SDK** is checked.

### 3. Database lock errors `database is locked (5)`
* **Cause**: An external database browser holds an exclusive transaction on `omnibill.db`.
* **Fix**: OmniBill operates in WAL mode (`PRAGMA journal_mode = WAL`). Ensure external SQLite viewer tools (like DB Browser for SQLite) are closed or set to Read-Only mode.
