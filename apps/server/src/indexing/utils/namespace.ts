export function getNamespaceFromRepo(repo: string) {
    return repo.replace("/", "-");
}