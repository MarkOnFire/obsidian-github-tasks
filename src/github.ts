import { Octokit } from "@octokit/rest";
import { requestUrl } from "obsidian";

export class GitHubClient {
  octokit: Octokit;
  private username: string;

  constructor(token: string) {
    this.octokit = new Octokit({
      auth: token,
      request: {
        fetch: this.customFetch.bind(this),
      },
    });
    this.username = "";
    this.initializeUsername();
  }

  // Custom fetch implementation using Obsidian's requestUrl to avoid CORS issues
  private async customFetch(
    url: string,
    options: RequestInit = {},
  ): Promise<Response> {
    // Convert headers to plain object
    const headers: Record<string, string> = {};
    if (options.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((value, key) => {
          headers[key] = value;
        });
      } else {
        Object.assign(headers, options.headers);
      }
    }

    try {
      const response = await requestUrl({
        url,
        method: options.method || "GET",
        headers,
        body: options.body as string,
        throw: false,
      });

      // Return minimal Response-like object
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        headers: new Headers(response.headers as Record<string, string>),
        json: async () => response.json,
        text: async () => response.text,
      } as Response;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`GitHub API request failed: ${errorMessage}`);
    }
  }

  private async initializeUsername() {
    try {
      const { data: user } = await this.octokit.users.getAuthenticated();
      this.username = user.login;
    } catch (error) {
      console.error("Failed to get authenticated user:", error);
    }
  }

  async getAssignedIssues() {
    let allIssues = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const { data } = await this.octokit.request("GET /issues", {
        filter: "assigned",
        state: "all",
        sort: "updated",
        direction: "desc",
        per_page: 100,
        page: page,
      });

      allIssues.push(...data);
      hasMore = data.length === 100; // If we got 100, there might be more
      page++;

      // Safety break to avoid infinite loops
      if (page > 10) break;
    }

    console.log("Total issues after pagination:", allIssues.length);
    return allIssues;
  }

  async getAssignedPRs() {
    if (!this.username) {
      await this.initializeUsername();
    }

    const { data } = await this.octokit.search.issuesAndPullRequests({
      q: `is:pr assignee:${this.username}`,
      per_page: 100,
    });
    return data.items;
  }

  async getReviewRequestedPRs() {
    if (!this.username) {
      await this.initializeUsername();
    }

    const { data } = await this.octokit.search.issuesAndPullRequests({
      q: `is:pr review-requested:${this.username}`,
      per_page: 100,
    });
    return data.items;
  }

  async getOpenedPRs() {
    const { data } = await this.octokit.search.issuesAndPullRequests({
      q: "is:pr author:@me",
      per_page: 100,
    });
    return data.items;
  }

  async getAuthoredIssues() {
    const { data } = await this.octokit.search.issuesAndPullRequests({
      q: "is:issue author:@me",
      per_page: 100,
    });
    return data.items;
  }

  // --- New Repository-Specific Methods ---

  async getRepoOpenIssues(owner: string, repo: string) {
    const { data } = await this.octokit.issues.listForRepo({
      owner,
      repo,
      state: "open",
      sort: "updated",
      direction: "desc",
      per_page: 100,
    });
    // Filter out PRs, as listForRepo returns both issues and PRs
    return data.filter((issue) => !issue.pull_request);
  }

  async getRepoOpenPRs(owner: string, repo: string) {
    const { data } = await this.octokit.pulls.list({
      owner,
      repo,
      state: "open",
      sort: "updated",
      direction: "desc",
      per_page: 100,
    });
    return data;
  }

  async getRepoRecentCommits(owner: string, repo: string, since?: Date) {
    const params: any = {
      owner,
      repo,
      per_page: 20,
    };
    if (since) {
      params.since = since.toISOString();
    }
    const { data } = await this.octokit.repos.listCommits(params);
    return data;
  }

  async getRepoRecentMergedPRs(owner: string, repo: string, since?: Date) {
    let q = `repo:${owner}/${repo} is:pr is:merged`;
    if (since) {
      q += ` merged:>=${since.toISOString().split("T")[0]}`;
    }
    const { data } = await this.octokit.search.issuesAndPullRequests({
      q,
      sort: "updated",
      order: "desc",
      per_page: 20,
    });
    return data.items;
  }

  async getRepoRecentClosedIssues(owner: string, repo: string, since?: Date) {
    let q = `repo:${owner}/${repo} is:issue is:closed`;
    if (since) {
      q += ` closed:>=${since.toISOString().split("T")[0]}`;
    }
    const { data } = await this.octokit.search.issuesAndPullRequests({
      q,
      sort: "updated",
      order: "desc",
      per_page: 20,
    });
    return data.items;
  }

  async getRepoReleases(owner: string, repo: string, limit: number = 5) {
    const { data } = await this.octokit.repos.listReleases({
      owner,
      repo,
      per_page: limit,
    });
    return data;
  }
}
