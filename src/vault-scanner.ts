import { App, TFile } from "obsidian";

export interface RepoNote {
  file: TFile;
  owner: string;
  repo: string;
}

export class VaultScanner {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Scans the vault for notes with 'github-repo' frontmatter.
   * @param folders Optional list of folder paths to limit the scan to.
   * @param excludeArchived Whether to exclude notes in folders named "Archive" or "Archives".
   */
  async scan(folders: string[] = [], excludeArchived: boolean = true): Promise<RepoNote[]> {
    const files = this.app.vault.getMarkdownFiles();
    const repoNotes: RepoNote[] = [];

    for (const file of files) {
      // Folder filtering
      if (folders.length > 0) {
        let inAllowedFolder = false;
        for (const folder of folders) {
          if (file.path.startsWith(folder)) {
            inAllowedFolder = true;
            break;
          }
        }
        if (!inAllowedFolder) continue;
      }

      // Archive exclusion
      if (excludeArchived) {
        const pathParts = file.path.split("/");
        // Check if any part of the path is "Archive" or "Archives" (case insensitive)
        const isArchived = pathParts.some(
          (part) =>
            part.toLowerCase() === "archive" || part.toLowerCase() === "archives"
        );
        if (isArchived) continue;
      }

      // Check frontmatter
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.frontmatter && cache.frontmatter["github-repo"]) {
        const repoString = cache.frontmatter["github-repo"];
        
        // Ensure it's a valid string "owner/repo"
        if (typeof repoString === "string") {
          const parts = repoString.split("/");
          if (parts.length === 2 && parts[0] && parts[1]) {
            repoNotes.push({
              file: file,
              owner: parts[0],
              repo: parts[1],
            });
          }
        }
      }
    }

    return repoNotes;
  }
}
