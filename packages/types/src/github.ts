export interface GitHubIssue {
  id: string;
  title: string;
  body: string | null;
  state: "open" | "closed";
  user: {
    login: string;
    avatar_url: string;
  } | null;
  labels: {
    id: number;
    name: string;
    color: string;
  }[];
  assignees: {
    login: string;
    avatar_url: string;
  }[];
  created_at: string;
  updated_at: string;
  html_url: string;
}
