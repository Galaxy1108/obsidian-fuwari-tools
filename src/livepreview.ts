import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { buildGithubCard, hydrateGithubCard } from "./render";

const CALLOUT_ICON_PATHS: Record<string, string> = {
	note: '<path d="M12 16v-4"/><path d="M12 8h.01"/><circle cx="12" cy="12" r="10"/>',
	tip: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
	important: '<path d="M6 3h12l4 6-10 13L2 9Z"/>',
	warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
	caution: '<path d="M12 16h.01"/><path d="M12 8h.01"/><path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/>',
};

function calloutIconSvg(type: string): string {
	const body = CALLOUT_ICON_PATHS[type] || CALLOUT_ICON_PATHS.note;
	return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

function capitalise(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------- widgets ----------

class GithubCardWidget extends WidgetType {
	constructor(private repo: string) {
		super();
	}

	eq(other: GithubCardWidget): boolean {
		return other.repo === this.repo;
	}

	estimateHeight(): number {
		return 120;
	}

	toDOM(): HTMLElement {
		// Same card as reading view.
		const card = buildGithubCard(this.repo);
		void hydrateGithubCard(card, this.repo);
		return card;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

class SpoilerWidget extends WidgetType {
	constructor(private text: string) {
		super();
	}

	eq(other: SpoilerWidget): boolean {
		return other.text === this.text;
	}

	toDOM(): HTMLElement {
		const el = document.createElement("span");
		el.addClass("fuwari-lp-spoiler");
		el.setText(this.text);
		return el;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

class CalloutWidget extends WidgetType {
	constructor(
		private type: string,
		private title: string,
		private content: string
	) {
		super();
	}

	eq(other: CalloutWidget): boolean {
		return other.type === this.type && other.title === this.title && other.content === this.content;
	}

	estimateHeight(): number {
		const lines = this.content.split("\n").length;
		const breaks = this.content.split(/\n\s*\n/).length;
		return 40 + (lines + breaks) * 22 + 8;
	}

	toDOM(): HTMLElement {
		const callout = document.createElement("div");
		callout.addClass("fuwari-lp-callout");
		callout.setAttribute("data-callout", this.type);

		const titleDiv = callout.createDiv({ cls: "fuwari-lp-callout-title" });
		const iconEl = titleDiv.createDiv({ cls: "fuwari-lp-callout-icon" });
		iconEl.innerHTML = calloutIconSvg(this.type);
		titleDiv.createDiv({ cls: "fuwari-lp-callout-title-inner", text: this.title });

		const contentDiv = callout.createDiv({ cls: "fuwari-lp-callout-content" });
		for (const para of this.content.split(/\n\s*\n/)) {
			const trimmed = para.trim();
			if (!trimmed) continue;
			const p = contentDiv.createEl("p");
			p.innerHTML = escapeHtml(trimmed).replace(/\n/g, "<br>");
		}
		return callout;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

// ---------- decoration building ----------

function cursorInside(view: EditorView, from: number, to: number): boolean {
	const sel = view.state.selection.main;
	return sel.from >= from && sel.to <= to;
}

/** Find `:::type ... :::` blocks in the document (line-based), skipping fenced code blocks. */
function findCalloutBlocks(
	view: EditorView
): { from: number; to: number; type: string; title: string; content: string }[] {
	const doc = view.state.doc;
	const blocks: { from: number; to: number; type: string; title: string; content: string }[] = [];
	const lineCount = doc.lines;
	let inFence = false;
	for (let ln = 1; ln <= lineCount; ln++) {
		const line = doc.line(ln);
		const text = line.text.trim();

		// Fenced code blocks must not be treated as admonitions.
		if (/^```/.test(text)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;

		const m = /^:::\s*([a-zA-Z]+)(?:\[([^\]]*)\])?(?:\s+(.*))?$/.exec(text);
		if (!m || text !== m[0].trim()) continue;

		const type = m[1].toLowerCase();
		const title = (m[2] || "").trim() || (m[3] || "").trim() || capitalise(type);
		const contentLines: string[] = [];
		let closeLine = -1;
		let innerFence = false;
		for (let ln2 = ln + 1; ln2 <= lineCount; ln2++) {
			const l2 = doc.line(ln2);
			const t2 = l2.text.trim();
			if (/^```/.test(t2)) {
				innerFence = !innerFence;
				contentLines.push(l2.text);
				continue;
			}
			if (innerFence) {
				contentLines.push(l2.text);
				continue;
			}
			if (/^:::\s*$/.test(t2)) {
				closeLine = ln2;
				break;
			}
			contentLines.push(l2.text);
		}
		if (closeLine === -1) continue;

		blocks.push({
			from: line.from,
			to: doc.line(closeLine).to,
			type,
			title,
			content: contentLines.join("\n"),
		});
		ln = closeLine;
	}
	return blocks;
}

/** Compute ranges that are inside code (fenced blocks + inline code) so we don't render there. */
function computeCodeRanges(doc: { lines: number; line(n: number): { from: number; to: number; text: string }; toString(): string }): { from: number; to: number }[] {
	const ranges: { from: number; to: number }[] = [];
	const lineCount = doc.lines;
	let inFence = false;
	let fenceStart = 0;
	for (let ln = 1; ln <= lineCount; ln++) {
		const line = doc.line(ln);
		if (/^```/.test(line.text.trim())) {
			if (!inFence) {
				inFence = true;
				fenceStart = line.from;
			} else {
				ranges.push({ from: fenceStart, to: line.to });
				inFence = false;
			}
		}
	}
	// Inline code spans: `...`
	const text = doc.toString();
	const re = /`+([^`]+)`+/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const contentStart = m.index + (m[0].indexOf(m[1]));
		ranges.push({ from: contentStart, to: contentStart + m[1].length });
	}
	return ranges;
}

function buildDecorations(view: EditorView): DecorationSet {
	try {
		const items: { from: number; to: number; deco: Decoration }[] = [];
		const visible = view.visibleRanges;
		const codeRanges = computeCodeRanges(view.state.doc);
		const inCode = (pos: number) => codeRanges.some((r) => pos >= r.from && pos <= r.to);

		// Multi-line `:::` admonitions: CodeMirror's multi-line `Decoration.replace`
		// block widget does NOT render in Obsidian's live preview — it leaves a `cm-gap`
		// and no callout DOM (confirmed via the editor DOM, even with `block: true`).
		// So we skip them here; callouts render fully in reading view.
		const blocks = findCalloutBlocks(view);

		// Single-line: `::github{...}` and `:spoiler[...]` within visible ranges (skip code).
		const insideBlock = (pos: number) => blocks.some((b) => pos >= b.from && pos <= b.to);
		for (const { from, to } of visible) {
			const text = view.state.doc.sliceString(from, to);

			const githubRe = /::github\s*\{\s*repo\s*=\s*"([^"]+)"\s*\}/g;
			let m: RegExpExecArray | null;
			while ((m = githubRe.exec(text))) {
				const start = from + m.index;
				const end = start + m[0].length;
				if (cursorInside(view, start, end) || insideBlock(start) || inCode(start)) continue;
				items.push({ from: start, to: end, deco: Decoration.replace({ widget: new GithubCardWidget(m[1]) }) });
			}

			const spoilerRe = /:spoiler\[([^\]]*)\]/g;
			while ((m = spoilerRe.exec(text))) {
				const start = from + m.index;
				const end = start + m[0].length;
				if (cursorInside(view, start, end) || insideBlock(start) || inCode(start)) continue;
				items.push({ from: start, to: end, deco: Decoration.replace({ widget: new SpoilerWidget(m[1]) }) });
			}
		}

		items.sort((a, b) => a.from - b.from || a.to - b.to);
		const builder = new RangeSetBuilder<Decoration>();
		for (const it of items) builder.add(it.from, it.to, it.deco);
		return builder.finish();
	} catch (e) {
		// Never crash the editor on a decoration error; degrade to no decorations.
		console.error("[fuwari-tools] live preview decoration error:", e);
		return Decoration.none;
	}
}

class LivePreviewDecoration {
	decorations: DecorationSet;

	constructor(view: EditorView) {
		this.decorations = buildDecorations(view);
	}

	update(update: ViewUpdate): void {
		if (update.docChanged || update.selectionSet || update.viewportChanged) {
			this.decorations = buildDecorations(update.view);
		}
	}
}

/** Register with `plugin.registerEditorExtension([livePreviewExtension])`. */
export const livePreviewExtension = ViewPlugin.fromClass(LivePreviewDecoration, {
	decorations: (v: LivePreviewDecoration) => v.decorations,
});
