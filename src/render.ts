import { Component, MarkdownRenderer, Plugin } from "obsidian";

/**
 * Render Fuwari-specific syntax in Obsidian's reading/preview view.
 * Admonitions are rendered as NATIVE Obsidian callouts via MarkdownRenderer,
 * so their structure, colors and icons are exactly Obsidian's own.
 */
export function registerBlogRender(plugin: Plugin): void {
	plugin.registerMarkdownPostProcessor(async (el, ctx) => {
		try {
			processSpoilers(el);
			processGithubCards(el);
			await processAdmonitions(plugin, el, ctx.sourcePath);
		} catch (e) {
			// Never break the note rendering on a processor error.
			console.error("[fuwari-tools] post-processor error:", e);
		}
	});
}

/** Render `:spoiler[hidden text]` as a blur-until-hover span. */
function processSpoilers(el: HTMLElement): void {
	for (const p of Array.from(el.querySelectorAll("p"))) {
		if (!p.innerHTML.includes(":spoiler[")) continue;
		p.innerHTML = p.innerHTML.replace(/:spoiler\[([^\]]*)\]/g, '<span class="fuwari-spoiler">$1</span>');
	}
}

// ---------- GitHub cards ----------

function processGithubCards(el: HTMLElement): void {
	const paragraphs = Array.from(el.querySelectorAll("p"));
	for (const p of paragraphs) {
		// Skip cards inside code (fenced/pre or inline `code`) — `::github` there is literal.
		if (p.closest("pre, code") || p.querySelector("code")) continue;
		const text = p.textContent || "";
		const re = /::\s*github\s*\{\s*repo\s*=\s*"([^"]+)"\s*\}/g;
		const found = Array.from(text.matchAll(re));
		if (!found.length) continue;
		if (text.replace(re, "").trim() !== "") continue;
		const fragment = p.ownerDocument.createDocumentFragment();
		for (const m of found) {
			const repo = m[1];
			const card = buildGithubCard(repo);
			fragment.appendChild(card);
			void hydrateGithubCard(card, repo);
		}
		p.replaceWith(fragment);
	}
}

const OCTO_SVG =
	'<svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>';

export function buildGithubCard(repo: string): HTMLElement {
	const card = document.createElement("div");
	card.addClass("fuwari-github-card");

	const head = card.createDiv({ cls: "fuwari-github-head" });
	const left = head.createDiv({ cls: "fuwari-github-head-left" });
	const avatar = left.createEl("img", { cls: "fuwari-github-avatar" });
	avatar.setAttr("alt", "");
	avatar.style.visibility = "hidden";
	left.createSpan({ cls: "fuwari-github-name", text: repo });

	const mark = head.createSpan({ cls: "fuwari-github-mark" });
	mark.innerHTML = OCTO_SVG;
	mark.setAttr("aria-hidden", "true");

	card.createDiv({ cls: "fuwari-github-desc", text: "加载中…" });
	card.createDiv({ cls: "fuwari-github-meta" });
	card.createEl("a", {
		cls: "fuwari-github-link",
		href: `https://github.com/${repo}`,
		text: `github.com/${repo}`,
	}).setAttr("target", "_blank");

	return card;
}

export async function hydrateGithubCard(card: HTMLElement, repo: string): Promise<void> {
	const desc = card.querySelector<HTMLElement>(".fuwari-github-desc");
	const meta = card.querySelector<HTMLElement>(".fuwari-github-meta");
	const avatar = card.querySelector<HTMLElement>("img.fuwari-github-avatar");
	const name = card.querySelector<HTMLElement>(".fuwari-github-name");
	try {
		const resp = await fetch(`https://api.github.com/repos/${repo}`);
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		const data = (await resp.json()) as {
			description?: string;
			stargazers_count?: number;
			forks_count?: number;
			language?: string | null;
			license?: { spdx_id?: string; name?: string } | null;
			owner?: { avatar_url?: string };
		};
		if (desc) desc.setText(data.description || "（无描述）");
		if (name) {
			const idx = repo.indexOf("/");
			if (idx > 0) {
				const owner = repo.slice(0, idx);
				const short = repo.slice(idx + 1);
				name.innerHTML = `<span class="fuwari-github-owner">${escapeHtml(owner)}</span> <span class="fuwari-github-repo">/ ${escapeHtml(short)}</span>`;
			}
		}
		if (avatar && data.owner?.avatar_url) {
			avatar.setAttribute("src", data.owner.avatar_url);
			(avatar as HTMLElement).style.visibility = "visible";
		}
		if (meta) {
			const stars = data.stargazers_count ?? 0;
			const forks = data.forks_count ?? 0;
			const lic = data.license?.spdx_id || data.license?.name || "";
			meta.innerHTML =
				`<span class="fuwari-github-stat">${STAR_SVG} ${stars}</span>` +
				`<span class="fuwari-github-stat">${FORK_SVG} ${forks}</span>` +
				(lic ? `<span class="fuwari-github-stat">${LICENSE_SVG} ${escapeHtml(lic)}</span>` : "");
		}
	} catch {
		if (desc) desc.setText(repo + "（GitHub API 暂时无法加载）");
	}
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const STAR_SVG =
	'<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"/></svg>';
const FORK_SVG =
	'<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/></svg>';
const LICENSE_SVG =
	'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>';

// ---------- Admonitions: rendered as a SINGLE native callout by Obsidian (colors/icons preserved) ----------

function capitalise(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Best-effort conversion of a DOM block to markdown lines (plain, loses some inline formatting). */
function blockToMarkdown(b: HTMLElement): string[] {
	const text = (b.textContent || "").replace(/\s+/g, " ").trim();
	if (!text) return [];
	switch (b.tagName) {
		case "H1":
			return ["# " + text];
		case "H2":
			return ["## " + text];
		case "H3":
			return ["### " + text];
		case "UL":
			return Array.from(b.children).map((li) => "- " + ((li.textContent || "").trim()));
		case "OL":
			return Array.from(b.children).map((li, idx) => `${idx + 1}. ` + (li.textContent || "").trim());
		case "PRE":
			return ["```", (b.textContent || "").trim(), "```"].filter(Boolean);
		default:
			return [text];
	}
}

/** Render a full `> [!type] Title` + content as one native Obsidian callout. */
async function renderFullCallout(
	plugin: Plugin,
	type: string,
	title: string,
	bodyLines: string[],
	sourcePath: string
): Promise<HTMLElement> {
	const md: string[] = [`> [!${type}] ${title}`];
	if (bodyLines.length) {
		md.push(">");
		for (const line of bodyLines) {
			for (const l of line.split("\n")) md.push("> " + l);
		}
	}
	const container = document.createElement("div");
	await MarkdownRenderer.render(plugin.app, md.join("\n"), container, sourcePath, new Component());
	return container.querySelector<HTMLElement>(".callout") || container;
}

async function processAdmonitions(plugin: Plugin, el: HTMLElement, sourcePath: string): Promise<void> {
	const children = Array.from(el.children);
	let i = 0;
	while (i < children.length) {
		const c = children[i];
		if (!(c instanceof HTMLElement) || c.tagName !== "P") {
			i++;
			continue;
		}
		const text = (c.textContent || "").trim();

		// Case A: opening marker on its own; content lives in the following siblings.
		const open = /^:::\s*([a-zA-Z]+)(?:\[([^\]]*)\])?(?:\s+(.*))?$/.exec(text);
		if (open && text === open[0].trim()) {
			const bodyLines: string[] = [];
			let j = i + 1;
			let closed = false;
			for (; j < children.length; j++) {
				const n = children[j];
				if (n instanceof HTMLElement && n.tagName === "P" && /^:::\s*$/.test((n.textContent || "").trim())) {
					closed = true;
					break;
				}
				if (n instanceof HTMLElement) bodyLines.push(...blockToMarkdown(n));
			}
			const callout = await renderFullCallout(
				plugin,
				open[1].toLowerCase(),
				(open[2] || "").trim() || (open[3] || "").trim() || capitalise(open[1].toLowerCase()),
				bodyLines,
				sourcePath
			);
			if (closed && j < children.length) children[j].remove();
			c.replaceWith(callout);
			i = j + 1;
			continue;
		}

		// Case B: merged single paragraph ":::type ...content... :::".
		const merged = splitMerged(text);
		if (merged) {
			const callout = await renderFullCallout(plugin, merged.type, merged.title, [merged.body], sourcePath);
			c.replaceWith(callout);
			i++;
			continue;
		}

		i++;
	}
}

/** Split a merged (no-blank-line) admonition paragraph, returning body as plain text. */
function splitMerged(text: string): { type: string; title: string; body: string } | null {
	const m = /^:::\s*([a-zA-Z]+)(?:\[([^\]]*)\])?(?:\s+(.*))?[\s\S]*?\s*:::\s*$/.exec(text);
	if (!m) return null;
	const type = m[1].toLowerCase();
	return { type, title: (m[2] || "").trim() || capitalise(type), body: (m[3] || "").trim() };
}
