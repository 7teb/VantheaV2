export const git_init_request_text = [
  "Put this project on GitHub as a new repository.",
  "First call ask_user once with these three questions, then end your turn and wait for the answers. Create, commit or push nothing before they arrive.",
  "1. The repository name, with the project folder name as the first option.",
  "2. Private or public, with Private as the first option. Say in the question that a public repository shows every committed file to everyone.",
  "3. Whether to invite collaborators, with Nobody as the first option. Say that GitHub usernames can be typed into the free-text field.",
  "When the answers arrive:",
  "- Run gh auth status. If the GitHub CLI is missing or not signed in, stop and tell the user to install it from https://cli.github.com and run gh auth login in a terminal themselves, because the login is interactive.",
  "- If a remote named origin already exists, stop and ask the user before you change it.",
  "- If the folder is not a git repository yet, run git init. Before the first commit, check what would be committed and make sure .gitignore keeps out build output, dependency folders, logs and secrets such as .env files and keys; add what is missing, then commit with a short initial message. If the repository already has commits, push them as they are and only mention uncommitted changes, do not commit them.",
  "- Create and push the repository with gh repo create <name> --private (or --public) --source . --remote origin --push.",
  "- Invite each named collaborator with gh api --method PUT repos/<owner>/<name>/collaborators/<username>. GitHub sends each one an invitation they have to accept.",
  "Finish with the repository URL, its visibility, what was committed and pushed, and the invitations you sent.",
].join("\n");
