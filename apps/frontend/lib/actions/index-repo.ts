export const callIndexApi = async (repo: string, taskId: string, clearNamespace: boolean = true) => {
    try {
      console.log("Indexing repo", repo);
      console.log("NEXT_PUBLIC_API_URL", process.env.NEXT_PUBLIC_API_URL);
      const response = await fetch(
        `http://${process.env.NEXT_PUBLIC_API_URL}/api/indexing/index`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ repo: repo, taskId: taskId, options: { embed: true, clearNamespace: clearNamespace } }),
        }
      );
      const data = await response.json();
      console.log("Indexing repo", data);
    } catch (error) {
      console.error("Error indexing repo", error);
    }
};

export const gitHubUrlToRepoName = (url: string) => {
  const result = url.split("/").slice(-2).join("/") || "";
  if (result === "") {
    throw new Error("Invalid GitHub URL");
  }
  return result;
};

export default callIndexApi;