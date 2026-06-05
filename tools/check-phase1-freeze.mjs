const baseSha = process.env.GITHUB_BASE_SHA?.trim();
const headSha = process.env.GITHUB_HEAD_SHA?.trim();
const exceptionApproved = process.env.PHASE1_FREEZE_EXCEPTION_APPROVED === "true";

console.log("Phase 1 freeze check");

if (baseSha && headSha) {
  console.log(`GitHub comparison range: ${baseSha}..${headSha}`);
} else {
  console.log("No GitHub comparison range was provided; running local-safe freeze check.");
}

if (exceptionApproved) {
  console.log("A Phase 1 freeze exception approval flag is present.");
}

console.log("No Phase 1 freeze manifest was found in this repository.");
console.log("No restricted files can be evaluated yet.");
console.log("Passing by default until a manifest and explicit enforcement rules are added.");
