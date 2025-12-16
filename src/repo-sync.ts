import { parseYaml } from "obsidian";
import { GitHubTasksSettings } from "./settings";
import { GitHubClient } from "./github";
import { buildUpdatedTaskLine, parseTaskLine, TaskItem } from "./utils";

export interface RepoConfig {
  owner: string;
  repo: string;
  syncEnabled: boolean;
}

export interface RepoSyncOptions {
  owner: string;
  repo: string;
  settings: GitHubTasksSettings;
}

/**
 * Parses the YAML frontmatter of a note to extract GitHub repository configuration.
 * Looks for 'github-repo' (owner/repo) and 'github-sync' (boolean).
 */
export function parseRepoFrontmatter(content: string): RepoConfig | null {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return null;
  }

  try {
    const frontmatter = parseYaml(match[1]);
    
    if (frontmatter && frontmatter["github-repo"]) {
      const repoString = frontmatter["github-repo"];
      
      // Handle simple string "owner/repo"
      if (typeof repoString === 'string') {
        const parts = repoString.split("/");
        if (parts.length === 2 && parts[0] && parts[1]) {
          return {
            owner: parts[0],
            repo: parts[1],
            syncEnabled: frontmatter["github-sync"] !== false // Default to true if not specified
          };
        }
      }
    }
  } catch (e) {
    console.warn("Failed to parse GitHub Tasks frontmatter:", e);
  }

  return null;
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Ensures a managed section exists with the given content.
 * 
 * Strategy:
 * 1. content between markers -> replace
 * 2. header exists but no markers -> append after header
 * 3. neither exists -> append header + markers to end of file
 */
export function ensureManagedSection(
  content: string,
  sectionId: string,
  headerText: string,
  innerContent: string
): string {
  const begin = `<!-- BEGIN_GITHUB_MANAGED:${sectionId} -->`;
  const end = `<!-- END_GITHUB_MANAGED:${sectionId} -->`;
  const fullBlock = `${begin}\n${innerContent}\n${end}`;

  // 1. Try to find existing markers
  const regex = new RegExp(`${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}`);
  if (regex.test(content)) {
    return content.replace(regex, fullBlock);
  }

  // 2. If not found, check if header exists
  // Matches "## Header" (flexible whitespace)
  const headerRegex = new RegExp(`^##\\s+${escapeRegExp(headerText)}\\s*$`, 'm');
  const headerMatch = content.match(headerRegex);

  if (headerMatch) {
    // Append after header
    const insertPos = headerMatch.index! + headerMatch[0].length;
    return content.slice(0, insertPos) + "\n" + fullBlock + content.slice(insertPos);
  }

  // 3. Append to end of file with header
  // Ensure we start on a new line if file isn't empty
  const prefix = content.trim().length > 0 ? "\n\n" : "";
  return content + `${prefix}## ${headerText}\n${fullBlock}`;
}

export async function syncRepoNote(
  content: string,
  github: GitHubClient,
  options: RepoSyncOptions
): Promise<string> {
  const { owner, repo, settings } = options;
  let newContent = content;

  // --- 1. Sync Open Issues ---
  try {
    const issues = await github.getRepoOpenIssues(owner, repo);

    // Parse existing tasks from content to preserve user edits/tags
    const existingTasksMap = new Map<number, TaskItem>();
    content.split("\n").forEach((line, index) => {
      const task = parseTaskLine(line, index);
      if (task) {
        existingTasksMap.set(task.id, task);
      }
    });

    const issueLines = issues.map((issue) => {
      const taskItem: TaskItem = {
        state: issue.state,
        title: issue.title,
        html_url: issue.html_url,
        repository_url: issue.repository_url,
        id: issue.id,
        number: issue.number,
        tags: settings.taskTag ? [settings.taskTag.replace("#", "")] : [],
        labels: issue.labels,
        created_at: issue.created_at,
        closed_at: issue.closed_at,
      };
      return buildUpdatedTaskLine(
        taskItem,
        "issue",
        settings,
        existingTasksMap.get(issue.id)
      );
    });

    newContent = ensureManagedSection(
      newContent,
      "issues",
      "GitHub: Open Issues",
      issueLines.join("\n") || "_No open issues_"
    );
  } catch (e) {
    console.error(`Failed to sync issues for ${owner}/${repo}:`, e);
  }

  // --- 2. Sync Open PRs ---
  try {
    const prs = await github.getRepoOpenPRs(owner, repo);

    // Refresh existing tasks map from updated content
    const existingTasksMap = new Map<number, TaskItem>();
    newContent.split("\n").forEach((line, index) => {
      const task = parseTaskLine(line, index);
      if (task) {
        existingTasksMap.set(task.id, task);
      }
    });

    const prLines = prs.map((pr) => {
      const taskItem: TaskItem = {
        state: pr.state,
        title: pr.title,
        html_url: pr.html_url,
        // PR structure for repository URL is nested in 'base'
        repository_url: pr.base.repo.url, 
        id: pr.id,
        number: pr.number,
        tags: settings.taskTag ? [settings.taskTag.replace("#", "")] : [],
        labels: pr.labels,
        created_at: pr.created_at,
        closed_at: pr.closed_at,
      };
      return buildUpdatedTaskLine(
        taskItem,
        "pr",
        settings,
        existingTasksMap.get(pr.id)
      );
    });

    newContent = ensureManagedSection(
      newContent,
      "prs",
      "GitHub: Open Pull Requests",
      prLines.join("\n") || "_No open pull requests_"
    );
  } catch (e) {
    console.error(`Failed to sync PRs for ${owner}/${repo}:`, e);
  }

  // --- 3. Activity Summary ---
  if (settings.activitySummaryEnabled) {
    try {
      const summary = await buildActivitySummary(
        github,
        owner,
        repo,
        settings
      );
      newContent = ensureManagedSection(
        newContent,
        "activity",
        "GitHub: Recent Activity",
        summary
      );
    } catch (e) {
      console.error(`Failed to sync activity for ${owner}/${repo}:`, e);
    }
  }

  return newContent;
}

async function buildActivitySummary(
  github: GitHubClient,
  owner: string,
  repo: string,
  settings: GitHubTasksSettings
): Promise<string> {
  const days = settings.activitySummaryDays || 7;
  const sinceDate = new Date();
  sinceDate.setDate(sinceDate.getDate() - days);

  const lines: string[] = [`**Last ${days} days:**`];
  let hasActivity = false;

  if (settings.activityTypes.mergedPRs) {
    const prs = await github.getRepoRecentMergedPRs(owner, repo, sinceDate);
    if (prs.length > 0) {
      hasActivity = true;
      lines.push(`\n**Merged Pull Requests:**`);
      prs.forEach((pr) => {
        const author = pr.user ? `@${pr.user.login}` : "unknown";
        lines.push(`- 🔀 [${pr.title}](${pr.html_url}) by ${author}`);
      });
    }
  }

  if (settings.activityTypes.closedIssues) {
    const issues = await github.getRepoRecentClosedIssues(
      owner,
      repo,
      sinceDate
    );
    if (issues.length > 0) {
      hasActivity = true;
      lines.push(`\n**Closed Issues:**`);
      issues.forEach((issue) => {
        lines.push(`- ✅ [${issue.title}](${issue.html_url})`);
      });
    }
  }

  if (settings.activityTypes.releases) {
    const releases = await github.getRepoReleases(owner, repo);
    // Filter by date locally as listReleases doesn't support 'since'
    const recentReleases = releases.filter(
      (r: any) => new Date(r.published_at) >= sinceDate
    );

    if (recentReleases.length > 0) {
      hasActivity = true;
      lines.push(`\n**Releases:**`);
      recentReleases.forEach((release: any) => {
        lines.push(
          `- 🏷️ [${release.name || release.tag_name}](${release.html_url})`
        );
      });
    }
  }

  if (settings.activityTypes.commits) {
    const commits = await github.getRepoRecentCommits(
      owner,
      repo,
      sinceDate
    );
    if (commits.length > 0) {
      hasActivity = true;
      lines.push(`\n**Recent Commits:**`);
      // Limit to 5
      commits.slice(0, 5).forEach((commit: any) => {
        const message = commit.commit.message.split("\n")[0];
        const author = commit.author
          ? `@${commit.author.login}`
          : commit.commit.author.name || "unknown";
        lines.push(`- 📝 [${message}](${commit.html_url}) by ${author}`);
      });
      if (commits.length > 5) {
        lines.push(`- ...and ${commits.length - 5} more`);
      }
    }
  }

  if (!hasActivity) {
    return `_No recent activity in the last ${days} days._`;
  }

  return lines.join("\n");
}
