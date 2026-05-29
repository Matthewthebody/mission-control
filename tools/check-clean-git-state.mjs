import { evaluateReleaseDiscipline } from "./release-discipline-state.mjs";

try {
  const status = evaluateReleaseDiscipline();

  if (status.git.is_clean) {
    console.log("Release clean-git check: worktree is clean.");
    process.exit(0);
  }

  console.error("Release clean-git check failed.");
  console.error("Release verification requires a clean commit candidate with no staged, unstaged, or untracked changes.");
  console.error("");
  if (status.git.error) {
    console.error(status.git.error);
  } else {
    console.error(status.git.dirty_paths.join("\n"));
  }
  process.exit(1);
} catch (error) {
  console.error("Release clean-git check could not read repository status.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
