import {
  Plugin,
  App,
  PluginManifest,
  TFile,
  Notice,
  normalizePath,
} from "obsidian";

import { GitHubClient } from "@/github";
import { syncTasks } from "@/sync";
import { VaultScanner } from "@/vault-scanner";
import { syncRepoNote } from "@/repo-sync";

import {
  GitHubTasksSettings,
  DEFAULT_SETTINGS,
  GitHubTasksSettingsTab,
} from "@/settings";

export class GitHubTasksPlugin extends Plugin {
  settings: GitHubTasksSettings;
  refreshInterval: number | undefined;
  vaultScanner: VaultScanner;

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
    this.settings = DEFAULT_SETTINGS;
  }

  async onload() {
    await this.loadSettings();
    this.vaultScanner = new VaultScanner(this.app);

    this.addSettingTab(new GitHubTasksSettingsTab(this.app, this));
    this.addCommand({
      id: "refresh",
      name: "Refresh",
      callback: () => this.refreshTasks(),
    });
    this.addCommand({
      id: "clear-completed",
      name: "Clear completed",
      callback: () => this.clearCompletedTasks(),
    });
    this.addCommand({
      id: "sync-repo-notes",
      name: "Sync all repository notes",
      callback: () => this.syncAllRepoNotes(),
    });
    this.startAutoRefresh();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.startAutoRefresh();
  }

  startAutoRefresh() {
    if (this.refreshInterval) {
      window.clearInterval(this.refreshInterval);
    }

    if (this.settings.autoRefreshInterval > 0) {
      this.registerInterval(
        (this.refreshInterval = window.setInterval(
          () => this.refreshTasks(),
          this.settings.autoRefreshInterval * 60 * 1000,
        )),
      );
    }
  }

  async refreshTasks() {
    if (!this.settings.githubToken) {
      new Notice(
        "GitHub personal access token not found. Please define it in GitHub Tasks settings.",
      );
      return;
    }
    const github = new GitHubClient(this.settings.githubToken);
    
    // 1. Sync the main tasks note (original functionality)
    const file = this.app.vault.getAbstractFileByPath(
      normalizePath(this.settings.githubTasksNote) + ".md",
    );
    if (file instanceof TFile) {
      const content = await this.app.vault.read(file);
      const newContent = await syncTasks(content, github, this.settings);
      await this.app.vault.modify(file, newContent || "");
    } else {
      // Only warn if explicitly configured but missing, silent fail otherwise?
      // Original code warned.
      // We'll keep original behavior but maybe user only wants per-note sync now?
      // If githubTasksNote is default "GitHub Tasks" and doesn't exist, and user uses per-note...
      // Let's preserve original warning for now.
      console.warn("Tasks note not found: ", this.settings.githubTasksNote);
    }

    // 2. Sync per-note repositories
    if (this.settings.enablePerNoteSync) {
      await this.syncAllRepoNotes(true); // Silent mode for auto-refresh/combined refresh
    }
  }

  async syncAllRepoNotes(silent = false) {
    if (!this.settings.enablePerNoteSync) {
      if (!silent) new Notice("Per-note sync is disabled in settings.");
      return;
    }

    if (!this.settings.githubToken) {
      if (!silent) new Notice("GitHub token missing.");
      return;
    }

    if (!silent) new Notice("Syncing repository notes...");

    const github = new GitHubClient(this.settings.githubToken);
    
    try {
      const repoNotes = await this.vaultScanner.scan(
        this.settings.perNoteScanFolders,
        this.settings.excludeArchivedNotes
      );

      let updatedCount = 0;
      
      for (const repoNote of repoNotes) {
        try {
          const content = await this.app.vault.read(repoNote.file);
          const newContent = await syncRepoNote(content, github, {
            owner: repoNote.owner,
            repo: repoNote.repo,
            settings: this.settings,
          });

          if (newContent !== content) {
            await this.app.vault.modify(repoNote.file, newContent);
            updatedCount++;
          }
        } catch (e) {
          console.error(`Failed to sync note ${repoNote.file.path}:`, e);
        }
      }

      if (!silent && updatedCount > 0) {
        new Notice(`Synced ${updatedCount} repository notes.`);
      } else if (!silent && repoNotes.length === 0) {
        new Notice("No repository notes found.");
      }
    } catch (e) {
      console.error("Error during per-note sync:", e);
      if (!silent) new Notice("Error syncing repository notes.");
    }
  }

  async clearCompletedTasks() {
    if (!this.settings.githubToken) {
      new Notice(
        "GitHub personal access token not found. Please define it in GitHub Tasks settings.",
      );
      return;
    }
    const github = new GitHubClient(this.settings.githubToken);
    const file = this.app.vault.getAbstractFileByPath(
      normalizePath(this.settings.githubTasksNote) + ".md",
    );
    if (!(file instanceof TFile)) {
      new Notice(
        "Tasks note not found. Make sure the note defined in GitHub Tasks settings exists.",
      );
      console.error("Tasks note not found: ", this.settings.githubTasksNote);
      return;
    }
    const content = await this.app.vault.read(file);

    const settingsWithAutoClear = {
      ...this.settings,
      autoClearCompleted: true,
    };

    const newContent = await syncTasks(content, github, settingsWithAutoClear);
    await this.app.vault.modify(file, newContent || "");
    new Notice("Completed GitHub tasks cleared");
  }
}

export default GitHubTasksPlugin;
