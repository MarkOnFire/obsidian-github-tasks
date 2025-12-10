# Design Document: Per-Note Repository Tracking Enhancement

**Generated:** 2025-12-10
**Author:** Claude Code (with human collaboration)
**Status:** Draft - Awaiting Review

---

## Executive Summary

This document proposes enhancing the `obsidian-github-tasks` plugin to support **per-note repository tracking**—allowing users to associate a GitHub repository with any Obsidian note and automatically maintain synced sections showing open issues/PRs and recent activity summaries.

### Motivation: PARA Method Integration

This enhancement is designed to support the **PARA organizational method** (Projects, Areas, Resources, Archives), where each Project note serves as a single source of truth for active work. By syncing GitHub data directly into project notes, users can:

- **Consolidate context**: Informal notes, GitHub issues, and activity summaries live together
- **Reduce context-switching**: No need to check GitHub separately during project work
- **Maintain actionability**: PARA emphasizes organizing by *what you're doing*, not *what things are*—GitHub tasks flow into the note where you're already working

As Tiago Forte puts it: "Your system has to give you time, not take time." This plugin should be zero-friction once configured.

### Current State
The existing plugin syncs all GitHub issues and PRs *assigned to the authenticated user* into a single dedicated note. This works well for personal task management but doesn't integrate with project-specific notes.

### Proposed Enhancement
Add a new mode where users can:
1. Add a repository parameter to any note (via frontmatter or inline syntax)
2. Have the plugin automatically maintain sections within that note showing:
   - Open issues and PRs for that repository
   - Recent activity summary (commits, merged PRs, closed issues)
3. Continue using the original single-note mode (backward compatibility)

### Feasibility Assessment: **Highly Feasible**

The existing codebase is well-architected and provides strong foundations:
- Clean separation between GitHub API, sync logic, and task formatting
- Extensible settings system
- Modular sync logic that can be adapted for per-note context

---

## Table of Contents

1. [Current Architecture Analysis](#current-architecture-analysis)
2. [Proposed Enhancements](#proposed-enhancements)
3. [Technical Design](#technical-design)
4. [Sprint Plan (Orchestrator/Agent Framework)](#sprint-plan)
5. [Backward Compatibility](#backward-compatibility)
6. [Contribution Strategy](#contribution-strategy)
7. [Risk Assessment](#risk-assessment)

---

## Current Architecture Analysis

### Module Responsibilities

| Module | Purpose | Extension Points |
|--------|---------|------------------|
| `main.ts` | Plugin lifecycle, commands, auto-refresh | Add new commands, multi-note processing |
| `settings.ts` | Configuration UI, persistence | Add per-note tracking settings |
| `github.ts` | GitHub API client (Octokit wrapper) | Add repository-specific queries |
| `sync.ts` | Core sync logic (GitHub → Obsidian) | Extend for repository context |
| `utils.ts` | Task parsing, formatting | Add activity summary formatting |

### Key Design Patterns

1. **CORS Handling**: Custom fetch wrapper using Obsidian's `requestUrl()`—critical for any GitHub API additions
2. **Task Identification**: `^gh-#######` anchors enable reliable sync tracking—must be preserved
3. **Section-Based Organization**: Sync operates on markdown sections with `## ` headers
4. **One-Way Sync**: GitHub → Obsidian only (simplifies state management)

### Data Flow

```
User Trigger (Manual/Auto)
    ↓
main.ts: refreshTasks()
    ↓
github.ts: GitHubClient → API calls
    ↓
sync.ts: syncTasks() merges data with note content
    ↓
utils.ts: formats task lines
    ↓
main.ts: writes to vault
```

### What Works Well

- **Clean modularity**: Each module has single responsibility
- **Robust task tracking**: `^gh-ID` anchors survive user edits
- **Flexible formatting**: Supports both Tasks and Dataview formats
- **Extensible settings**: Easy to add new configuration options

### Gaps for Per-Note Feature

1. No mechanism to discover notes with repository parameters
2. GitHub API calls are user-centric, not repository-centric
3. No activity summary generation capability
4. Sync hardcoded to single target note

---

## Proposed Enhancements

### Feature 1: Repository Parameter Recognition

**User Story**: As a user, I want to add a GitHub repository to any note and have the plugin recognize it.

**Syntax Options**:

```yaml
# Option A: YAML Frontmatter (Recommended)
---
github-repo: owner/repo
github-sync: true  # optional, defaults to true if repo specified
---

# Option B: Inline Tag
<!-- github-repo: owner/repo -->

# Option C: Dataview-style Field
[github-repo:: owner/repo]
```

**Recommendation**: YAML frontmatter (Option A) because:
- Standard Obsidian pattern
- Clear separation from content
- Easy to parse reliably
- Works well with other plugins

### Feature 2: Per-Note Sections

**User Story**: As a user, I want automatically maintained sections showing repository activity.

**Proposed Section Structure**:

```markdown
---
github-repo: owner/repo
---

# My Project Notes

[User's informal notes here are preserved]

## GitHub: Open Issues
<!-- managed by plugin, do not edit between markers -->
- [ ] [Issue title](url) #label1 #label2 ^gh-123456
- [ ] [Another issue](url) ^gh-789012
<!-- end github section -->

## GitHub: Open Pull Requests
<!-- managed by plugin -->
- [ ] [PR: Feature branch](url) ^gh-345678
<!-- end github section -->

## GitHub: Recent Activity
<!-- managed by plugin -->
**Last 7 days:**
- 🔀 Merged: [PR title](url) by @author
- ✅ Closed: [Issue title](url)
- 📝 3 commits to main branch
- 🏷️ Released v1.2.0
<!-- end github section -->
```

### Feature 3: Activity Summary

**User Story**: As a user, I want a summary of recent repository activity alongside open items.

**Data Sources** (GitHub API):
- Recent commits (list commits endpoint)
- Merged PRs (search `is:pr is:merged`)
- Closed issues (search `is:issue is:closed`)
- Releases (list releases endpoint)

**Configurability**:
- Time window (default: 7 days)
- Activity types to include
- Maximum items per category

### Feature 4: Multi-Note Discovery

**User Story**: As a user, I want the plugin to automatically find all notes with repository parameters.

**Implementation Approach**:
1. Scan vault for notes with `github-repo` frontmatter
2. Cache discovered notes for performance
3. Refresh cache on vault modification or manual trigger
4. Process each discovered note during sync

---

## Technical Design

### New Settings

```typescript
interface GitHubTasksSettings {
  // Existing settings preserved...

  // New settings for per-note mode
  enablePerNoteSync: boolean;           // Toggle feature on/off
  perNoteScanFolders: string[];         // Limit scanning (e.g., ["1 - Projects"])
  excludeArchivedNotes: boolean;        // Skip notes in Archive folders (PARA-aware)
  activitySummaryEnabled: boolean;      // Include activity section
  activitySummaryDays: number;          // Lookback period (default: 7)
  activityTypes: {                      // What to include in summary
    commits: boolean;
    mergedPRs: boolean;
    closedIssues: boolean;
    releases: boolean;
  };
}
```

### PARA-Aware Scanning

To support the PARA method efficiently:

1. **Folder filtering**: Users can limit scanning to `1 - Projects` (or their equivalent)
2. **Archive exclusion**: Notes in `4 - Archives` are skipped by default—completed projects don't need live syncing
3. **Graceful degradation**: If a project note moves to Archives, the GitHub sections remain as a final snapshot but stop updating

This aligns with PARA's principle that Archives are "inactive items preserved for future reference"—the GitHub data becomes part of that historical record.

### New GitHub Client Methods

```typescript
class GitHubClient {
  // Existing methods preserved...

  // New repository-specific methods
  async getRepoOpenIssues(owner: string, repo: string): Promise<Issue[]>;
  async getRepoOpenPRs(owner: string, repo: string): Promise<PullRequest[]>;
  async getRepoRecentCommits(owner: string, repo: string, since: Date): Promise<Commit[]>;
  async getRepoRecentMergedPRs(owner: string, repo: string, since: Date): Promise<PullRequest[]>;
  async getRepoRecentClosedIssues(owner: string, repo: string, since: Date): Promise<Issue[]>;
  async getRepoReleases(owner: string, repo: string, limit: number): Promise<Release[]>;
}
```

### New Sync Module: `src/repo-sync.ts`

```typescript
interface RepoSyncOptions {
  owner: string;
  repo: string;
  settings: GitHubTasksSettings;
}

// Parse note frontmatter to extract repo config
function parseRepoFrontmatter(content: string): RepoConfig | null;

// Find or create managed sections in note
function findManagedSections(content: string): ManagedSections;

// Sync a single note with its configured repository
async function syncRepoNote(
  content: string,
  github: GitHubClient,
  options: RepoSyncOptions
): Promise<string>;

// Build activity summary markdown
function buildActivitySummary(
  commits: Commit[],
  mergedPRs: PullRequest[],
  closedIssues: Issue[],
  releases: Release[],
  settings: GitHubTasksSettings
): string;
```

### Vault Scanning: `src/vault-scanner.ts`

```typescript
interface RepoNote {
  path: string;
  owner: string;
  repo: string;
}

// Scan vault for notes with github-repo frontmatter
async function scanVaultForRepoNotes(
  vault: Vault,
  folders?: string[]
): Promise<RepoNote[]>;

// Cache management
class RepoNoteCache {
  private notes: Map<string, RepoNote>;

  async refresh(vault: Vault): Promise<void>;
  getAll(): RepoNote[];
  invalidate(path: string): void;
}
```

### Modified Main Plugin

```typescript
class GitHubTasksPlugin extends Plugin {
  // Existing functionality preserved...

  private repoNoteCache: RepoNoteCache;

  async onload() {
    // Existing setup...

    // Initialize per-note sync if enabled
    if (this.settings.enablePerNoteSync) {
      this.repoNoteCache = new RepoNoteCache();
      await this.repoNoteCache.refresh(this.app.vault);

      // Register vault modification listener
      this.registerEvent(
        this.app.vault.on('modify', (file) => {
          this.repoNoteCache.invalidate(file.path);
        })
      );
    }

    // Add new command for per-note sync
    this.addCommand({
      id: 'sync-repo-notes',
      name: 'Sync all repository notes',
      callback: () => this.syncAllRepoNotes()
    });
  }

  async syncAllRepoNotes() {
    const repoNotes = this.repoNoteCache.getAll();
    for (const repoNote of repoNotes) {
      await this.syncSingleRepoNote(repoNote);
    }
  }
}
```

### Section Markers

To safely update managed sections without clobbering user content:

```markdown
## GitHub: Open Issues
<!-- BEGIN_GITHUB_MANAGED:issues -->
[Plugin-managed content here]
<!-- END_GITHUB_MANAGED:issues -->
```

This allows the plugin to:
1. Locate exact boundaries of managed content
2. Replace only managed content during sync
3. Preserve user edits outside markers
4. Handle missing sections (create them)

---

## Sprint Plan

Following your orchestrator/agent framework from `long_running_agents_summary.md`:

### Phase 0: Initializer Agent Setup

**Objective**: Create project artifacts for long-running development

**Deliverables**:
1. `feature_list.json` - Comprehensive feature breakdown
2. `claude-progress.txt` - Session tracking log
3. `init.sh` - Development environment bootstrap

```json
// feature_list.json
{
  "features": [
    {
      "id": "F001",
      "name": "Settings infrastructure",
      "description": "Add new settings for per-note mode",
      "status": "pending",
      "passes": false,
      "dependencies": []
    },
    {
      "id": "F002",
      "name": "GitHub client extensions",
      "description": "Add repository-specific API methods",
      "status": "pending",
      "passes": false,
      "dependencies": []
    },
    {
      "id": "F003",
      "name": "Frontmatter parsing",
      "description": "Parse github-repo from note frontmatter",
      "status": "pending",
      "passes": false,
      "dependencies": []
    },
    {
      "id": "F004",
      "name": "Vault scanner",
      "description": "Scan vault for notes with repo config",
      "status": "pending",
      "passes": false,
      "dependencies": ["F003"]
    },
    {
      "id": "F005",
      "name": "Section management",
      "description": "Find/create managed sections with markers",
      "status": "pending",
      "passes": false,
      "dependencies": ["F003"]
    },
    {
      "id": "F006",
      "name": "Issue/PR sync for repo",
      "description": "Sync open issues and PRs to note sections",
      "status": "pending",
      "passes": false,
      "dependencies": ["F002", "F005"]
    },
    {
      "id": "F007",
      "name": "Activity summary",
      "description": "Generate recent activity summary section",
      "status": "pending",
      "passes": false,
      "dependencies": ["F002", "F005"]
    },
    {
      "id": "F008",
      "name": "Multi-note orchestration",
      "description": "Process all repo notes during sync",
      "status": "pending",
      "passes": false,
      "dependencies": ["F004", "F006", "F007"]
    },
    {
      "id": "F009",
      "name": "Settings UI",
      "description": "Add UI controls for new settings",
      "status": "pending",
      "passes": false,
      "dependencies": ["F001"]
    },
    {
      "id": "F010",
      "name": "Integration testing",
      "description": "End-to-end testing of full workflow",
      "status": "pending",
      "passes": false,
      "dependencies": ["F008", "F009"]
    }
  ]
}
```

### Phase 1: Foundation (Sessions 1-2)

**Coding Agent Focus**: Settings and GitHub API extensions

| Session | Features | Estimated Effort |
|---------|----------|------------------|
| 1 | F001 (Settings), F002 (GitHub client) | Medium |
| 2 | F003 (Frontmatter), F009 (Settings UI) | Medium |

**Guardrails**:
- Existing functionality must continue working
- All new settings have sensible defaults
- GitHub API methods follow existing CORS patterns

### Phase 2: Core Sync Logic (Sessions 3-4)

**Coding Agent Focus**: Note parsing and section management

| Session | Features | Estimated Effort |
|---------|----------|------------------|
| 3 | F004 (Vault scanner), F005 (Sections) | Medium |
| 4 | F006 (Issue/PR sync) | High |

**Guardrails**:
- Section markers must be robust to user editing
- Scanner must handle vault with many notes efficiently
- Preserve existing `^gh-ID` tracking pattern

### Phase 3: Activity Summary (Session 5)

**Coding Agent Focus**: Activity data fetching and formatting

| Session | Features | Estimated Effort |
|---------|----------|------------------|
| 5 | F007 (Activity summary) | Medium |

**Guardrails**:
- Activity summary must be readable and scannable
- Time window must be configurable
- Handle repositories with no recent activity gracefully

### Phase 4: Integration (Sessions 6-7)

**Coding Agent Focus**: Orchestration and testing

| Session | Features | Estimated Effort |
|---------|----------|------------------|
| 6 | F008 (Multi-note orchestration) | Medium |
| 7 | F010 (Integration testing) | High |

**Guardrails**:
- Sync command must handle both modes (single note + per-note)
- Error in one note must not break sync for others
- Performance must be acceptable with 10+ repo notes

### Phase 5: QA Agent (Session 8)

**Specialized Agent Focus**: Quality assurance

**Tasks**:
1. Test backward compatibility with existing single-note mode
2. Test edge cases (missing repos, private repos, rate limits)
3. Verify performance with realistic vault sizes
4. Documentation review and updates

---

## Backward Compatibility

### Principle: Additive Enhancement

The enhancement must be **purely additive**—users who don't enable per-note mode should see zero changes to existing behavior.

### Compatibility Guarantees

| Existing Feature | Compatibility |
|-----------------|---------------|
| Single-note sync | ✅ Unchanged |
| Task format (emoji/dataview) | ✅ Unchanged |
| Auto-refresh | ✅ Works for both modes |
| Task tracking (`^gh-ID`) | ✅ Same pattern used |
| Settings persistence | ✅ Merged with defaults |

### Migration Path

For users wanting to transition:
1. Enable per-note mode in settings
2. Add `github-repo` frontmatter to desired notes
3. Original single-note continues working in parallel

---

## Contribution Strategy

### Upstream Contribution Approach

1. **Phase 1**: Complete implementation on fork
2. **Phase 2**: Open issue on original repo describing enhancement
3. **Phase 3**: Submit PR with:
   - Clear description of changes
   - Backward compatibility explanation
   - Example usage and screenshots
   - Test coverage notes

### Code Quality Standards for Contribution

- Follow existing code style exactly
- No breaking changes to public interfaces
- Comprehensive JSDoc comments
- Update README with new features
- Update CHANGELOG if present

### Potential Maintainer Concerns

| Concern | Mitigation |
|---------|------------|
| Complexity increase | Feature is toggleable and isolated |
| Maintenance burden | Well-documented, follows existing patterns |
| Scope creep | Clear boundaries, no dependency additions |
| Performance | Lazy scanning, cached note discovery |

---

## Risk Assessment

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| GitHub API rate limits | Medium | Medium | Implement batching, caching |
| Performance with large vaults | Medium | Low | Lazy scanning, folder filters |
| Section marker parsing failures | Low | Medium | Robust regex, fallback behavior |
| Breaking existing sync | Low | High | Comprehensive testing, feature flag |

### User Experience Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Confusion about two modes | Medium | Low | Clear documentation, sensible defaults |
| Accidental content loss | Low | High | Clear section markers, backups |
| Complex configuration | Low | Medium | Good defaults, progressive disclosure |

---

## Appendix: File Structure After Enhancement

```
src/
├── main.ts              # Modified: add per-note orchestration
├── settings.ts          # Modified: add new settings
├── github.ts            # Modified: add repo-specific methods
├── sync.ts              # Unchanged: original single-note sync
├── utils.ts             # Modified: add activity formatting
├── repo-sync.ts         # NEW: per-note sync logic
├── vault-scanner.ts     # NEW: vault scanning and caching
└── types.ts             # NEW: shared type definitions
```

---

## Next Steps

1. **Review this design document** - Confirm approach aligns with your vision
2. **Create harness artifacts** - `feature_list.json`, `claude-progress.txt`, `init.sh`
3. **Begin Phase 1** - Settings infrastructure and GitHub API extensions
4. **Iterate with feedback** - Each session ends with progress update

---

*This document follows the orchestrator/agent framework from your knowledge base. Ready to proceed when you are.*
