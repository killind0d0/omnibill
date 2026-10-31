// control-plane/web/src/utils/githubService.ts
// Automated GitHub Serverless License Sync & Deployment Service

export interface GithubConfig {
  repo: string; // e.g. "killind0d0/omnibill-licenses"
  token: string; // Personal Access Token (classic or fine-grained)
  autoSync: boolean;
}

const STORAGE_KEY_GITHUB_CONFIG = 'omnibill_github_sync_config';
const DEFAULT_REPO = 'killind0d0/omnibill-licenses';

export class GithubSyncService {
  /**
   * Retrieves current GitHub configuration from localStorage.
   */
  public static getConfig(): GithubConfig {
    if (typeof window === 'undefined') {
      return { repo: DEFAULT_REPO, token: '', autoSync: true };
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEY_GITHUB_CONFIG);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          repo: parsed.repo || DEFAULT_REPO,
          token: parsed.token || '',
          autoSync: parsed.autoSync !== false,
        };
      }
    } catch {}
    return { repo: DEFAULT_REPO, token: '', autoSync: true };
  }

  /**
   * Saves GitHub configuration to localStorage and syncs with backend.
   */
  public static saveConfig(config: GithubConfig): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY_GITHUB_CONFIG, JSON.stringify(config));
    } catch (err) {
      console.error('Failed to save GitHub config:', err);
    }
  }

  /**
   * Tests token access and repository status.
   */
  public static async testConnection(
    tokenInput?: string,
    repoInput?: string
  ): Promise<{
    ok: boolean;
    message: string;
    canCreateRepo?: boolean;
    repoUrl?: string;
  }> {
    const token = (tokenInput || this.getConfig().token || '').trim();
    const repo = (repoInput || this.getConfig().repo || DEFAULT_REPO).trim();

    if (!token) {
      return { ok: false, message: 'Please enter a GitHub Personal Access Token.' };
    }

    try {
      // 1. Check if token is valid via user endpoint
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      });

      if (!userRes.ok) {
        return { ok: false, message: 'Invalid GitHub Token (Bad credentials or expired).' };
      }

      const userData = await userRes.json();
      const authenticatedUser = userData.login;

      // 2. Check if repository exists
      const repoRes = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      });

      if (repoRes.ok) {
        const repoData = await repoRes.json();
        return {
          ok: true,
          message: `Connected successfully as @${authenticatedUser}! Repository is accessible.`,
          repoUrl: repoData.html_url,
        };
      } else if (repoRes.status === 404) {
        return {
          ok: false,
          canCreateRepo: true,
          message: `Repository "${repo}" not found under @${authenticatedUser}. Click "Initialize Repository" to auto-create it now.`,
        };
      } else {
        return {
          ok: false,
          message: `Error checking repository (HTTP ${repoRes.status}).`,
        };
      }
    } catch (err: any) {
      return { ok: false, message: err?.message || 'Network error connecting to GitHub API.' };
    }
  }

  /**
   * Automatically creates the repository on GitHub if it does not exist yet.
   */
  public static async createRepository(
    tokenInput?: string,
    repoName: string = 'omnibill-licenses'
  ): Promise<{ ok: boolean; message: string; repoUrl?: string }> {
    const token = (tokenInput || this.getConfig().token || '').trim();
    if (!token) {
      return { ok: false, message: 'GitHub Token is required to initialize repository.' };
    }

    try {
      const res = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: repoName,
          description: 'Serverless License Registry for OmniBill ERP Counters',
          private: false, // Public so raw.githubusercontent.com is accessible by client counters
          auto_init: true,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        return {
          ok: true,
          message: `Repository ${data.full_name} created successfully!`,
          repoUrl: data.html_url,
        };
      } else {
        const err = await res.json().catch(() => ({}));
        return {
          ok: false,
          message: err.message || `Failed to create repository (HTTP ${res.status}).`,
        };
      }
    } catch (err: any) {
      return { ok: false, message: err?.message || 'Failed to initialize repository.' };
    }
  }

  /**
   * Automatically commits and pushes a client's license JSON file to the GitHub repository.
   */
  public static async pushLicense(
    licenseKey: string,
    licensePayload: any,
    customConfig?: Partial<GithubConfig>
  ): Promise<{
    ok: boolean;
    message: string;
    commitUrl?: string;
    rawUrl?: string;
    fileUrl?: string;
  }> {
    const config = { ...this.getConfig(), ...customConfig };
    const token = config.token.trim();
    const repo = config.repo.trim() || DEFAULT_REPO;

    if (!token) {
      return {
        ok: false,
        message:
          'GitHub Token not configured. Go to Settings -> GitHub Automation to add your token for 1-click publishing.',
      };
    }

    const cleanKey = licenseKey.trim().toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-');
    const filePath = `licenses/${cleanKey}.json`;
    const apiUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;

    try {
      // 1. Check if file already exists to get its SHA (needed for updating)
      let existingSha: string | undefined;
      const getRes = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      });

      if (getRes.ok) {
        const fileInfo = await getRes.json();
        existingSha = fileInfo.sha;
      }

      // 2. Base64 encode the JSON content safely (supports UTF-8 characters)
      const jsonString = JSON.stringify(licensePayload, null, 2);
      const utf8Bytes = new TextEncoder().encode(jsonString);
      let binaryStr = '';
      utf8Bytes.forEach((b) => (binaryStr += String.fromCharCode(b)));
      const base64Content = btoa(binaryStr);

      // 3. Put/Commit file to GitHub
      const isUpdate = Boolean(existingSha);
      const commitMessage = isUpdate
        ? `Update license for ${licensePayload.business_name || cleanKey} (valid until ${licensePayload.valid_until})`
        : `Auto-provision license for ${licensePayload.business_name || cleanKey}`;

      const putRes = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: commitMessage,
          content: base64Content,
          sha: existingSha,
          branch: 'main',
        }),
      });

      if (putRes.ok) {
        const putData = await putRes.json();
        const rawUrl = `https://raw.githubusercontent.com/${repo}/main/${filePath}`;
        const fileUrl = putData.content?.html_url || `https://github.com/${repo}/blob/main/${filePath}`;
        const commitUrl = putData.commit?.html_url;

        return {
          ok: true,
          message: `Successfully pushed to GitHub: ${filePath}`,
          rawUrl,
          fileUrl,
          commitUrl,
        };
      } else {
        const errData = await putRes.json().catch(() => ({}));
        return {
          ok: false,
          message: errData.message || `GitHub API error (HTTP ${putRes.status})`,
        };
      }
    } catch (err: any) {
      return {
        ok: false,
        message: err?.message || 'Network error pushing license to GitHub.',
      };
    }
  }
}
