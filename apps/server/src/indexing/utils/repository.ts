
function isValidRepo(repo: string) {
  // Luh calm regex (NOT GPT'ed)
  return /^.+\/.+$/.test(repo);
}
function getNamespaceFromRepo(repo: string) {
  if (!isValidRepo(repo)) {
    throw new Error(`Invalid repo format: ${repo}`);
  }
  return repo.replace("/", "-");
}

function getOwnerFromRepo(repo: string): { owner: string; repo: string } {
  if (!isValidRepo(repo)) {
    throw new Error(`Invalid repo format: ${repo}`);
  }

  const parts = repo.split("/");
  const owner = parts[0];
  const repoName = parts[1];

  if (!owner || !repoName) {
    throw new Error(`Invalid repo format: ${repo}`);
  }

  return {
    owner,
    repo: repoName,
  };
}

export { getNamespaceFromRepo, getOwnerFromRepo, isValidRepo };
