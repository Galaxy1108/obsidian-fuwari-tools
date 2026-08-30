import { App, FuzzyMatch, FuzzySuggestModal, TFile } from "obsidian";
import { isUnder, sanitizeFileName } from "./fm";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"]);

/** List all image files under the given folder. */
export function listImages(app: App, imagesFolder: string): TFile[] {
	return app.vault.getFiles().filter((f) => {
		if (!IMAGE_EXTS.has(f.extension) || !isUnder(f.path, imagesFolder)) return false;
		return true;
	});
}

/** Ensure a folder exists recursively. */
export async function ensureFolder(app: App, folder: string): Promise<void> {
	if (!folder) return;
	if (!app.vault.getAbstractFileByPath(folder)) {
		await app.vault.createFolder(folder);
	}
}

/** A resource URL for a file, safe to use in an <img> src. */
export function resourcePath(app: App, file: TFile): string {
	try {
		return app.vault.getResourcePath(file);
	} catch {
		return "";
	}
}

/**
 * Write uploaded image bytes into the images folder with a unique name,
 * and return the public path `/images/<name>` for use in frontmatter `image`.
 */
export async function importImage(
	app: App,
	imagesFolder: string,
	rawName: string,
	data: ArrayBuffer
): Promise<string> {
	await ensureFolder(app, imagesFolder);
	const safe = sanitizeFileName(rawName);
	let name = safe;
	let i = 1;
	while (app.vault.getAbstractFileByPath(`${imagesFolder}/${name}`)) {
		const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
		const stem = name.slice(0, name.lastIndexOf("."));
		name = `${stem}-${i++}${ext}`;
	}
	await app.vault.createBinary(`${imagesFolder}/${name}`, data);
	return `/images/${name}`;
}

/** A modal that lets the user pick an image from the images folder with a thumbnail. */
export class CoverSuggestModal extends FuzzySuggestModal<TFile> {
	private imagesFolder: string;
	private onPick: (file: TFile) => void;

	constructor(app: App, imagesFolder: string, onPick: (file: TFile) => void) {
		super(app);
		this.imagesFolder = imagesFolder;
		this.onPick = onPick;
		this.setPlaceholder("选择封面图…");
	}

	getItems(): TFile[] {
		return listImages(this.app, this.imagesFolder);
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
		const item = match.item;
		el.createEl("div", { cls: "fuwari-cover-item" }, (d) => {
			const img = d.createEl("img");
			img.src = resourcePath(this.app, item);
			img.addClass("fuwari-cover-thumb");
			const label = d.createEl("span", { text: item.basename });
			label.addClass("fuwari-cover-label");
		});
	}

	onChooseItem(item: TFile): void {
		this.onPick(item);
	}
}
