import { App, TFile } from "obsidian";
import { pinyin } from "pinyin-pro";

/** True when `p` is inside the folder `folder` (vault-relative), using "/" separators. */
export function isUnder(p: string, folder: string): boolean {
	const f = folder.replace(/\/+$/, "");
	return p === f || p.startsWith(f + "/");
}

/** True if the file is a markdown post under the configured posts folder. */
export function isPostFile(file: TFile, postsFolder: string): boolean {
	return file.extension === "md" && isUnder(file.path, postsFolder);
}

/** Read the cached frontmatter object for a file, if any. */
export function getFrontmatter(app: App, file: TFile): Record<string, unknown> | null {
	const cache = app.metadataCache.getFileCache(file);
	return cache?.frontmatter ?? null;
}

/** True if the file looks like a real blog post (has title or published). */
export function isRealPost(app: App, file: TFile): boolean {
	const fm = getFrontmatter(app, file);
	if (!fm) return false;
	return fm.title != null || fm.published != null;
}

/** Derive a filesystem-friendly filename from a title, keeping CJK/Unicode; falls back to a timestamp-based slug only if the result is empty. */
export function slugify(title: string): string {
	// Use the title directly as the filename (keep CJK / Unicode).
	// Only strip what Windows/filesystem/git reject, and normalize whitespace.
	let s = title.trim();
	s = s.replace(/\\/g, "/");
	s = s
		.replace(/[\/:*?"<>|]/g, " ")
		.replace(/\s+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/^\.+|[.\s]+$/g, "");
	// Keep filenames sane-length (avoid exceeding path limits).
	if (s.length > 80) s = s.slice(0, 80).replace(/-+$/g, "");
	if (!s) {
		const t = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		s = `post-${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`;
	}
	return s;
}

/**
 * Build a clean ASCII URL slug from a title by transliterating Chinese to pinyin.
 * Used for the frontmatter `slug:` field so the blog gets a clean URL while the
 * Obsidian filename stays Chinese. Falls back to a timestamp slug if the result is empty.
 */
export function pinyinSlug(title: string): string {
	const py = pinyin(title, { toneType: "none", nonZh: "consecutive", separator: "-" });
	let s = py
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
	if (s.length > 80) s = s.slice(0, 80).replace(/-+$/g, "");
	if (!s) {
		const t = new Date();
		const pad = (n: number) => String(n).padStart(2, "0");
		s = `post-${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`;
	}
	return s;
}

/** Sanitize an uploaded image filename and return a safe basename with extension. */
export function sanitizeFileName(name: string): string {
	const base = name.replace(/[^\w.\-]/g, "").replace(/^\.+/, "");
	return base || `image-${Date.now()}.png`;
}
