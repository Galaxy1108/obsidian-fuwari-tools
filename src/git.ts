import { execFile } from "child_process";

export interface GitRun {
	stdout: string;
	stderr: string;
}

/**
 * Run `git <args>` in `cwd`.
 * Resolves with stdout/stderr on success; rejects with a friendly Error on failure.
 * Uses execFile (no shell) so paths with spaces / special chars are safe.
 */
export function git(cwd: string, args: string[]): Promise<GitRun> {
	return new Promise((resolve, reject) => {
		execFile("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) {
				const code = (error as { code?: string }).code;
				const msg = (stderr || stdout || error.message || "").trim();
				const hint =
					code === "ENOENT"
						? "未找到 git。请安装 git 并确保它能被 Obsidian 调用（加入 PATH 后重启 Obsidian）。"
						: msg;
				reject(new Error(hint));
				return;
			}
			resolve({ stdout: stdout || "", stderr: stderr || "" });
		});
	});
}

/** Auto-generated commit message for blog content sync. */
export function autoCommitMessage(now: Date = new Date()): string {
	const pad = (n: number): string => String(n).padStart(2, "0");
	const d = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	const t = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
	return `chore(blog): 博客同步 @ ${d} ${t}`;
}
