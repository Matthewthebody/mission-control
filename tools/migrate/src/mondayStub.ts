export async function mondayGraphQL(query: string, token: string) {
  const response = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token
    },
    body: JSON.stringify({ query })
  });
  return response.json();
}
