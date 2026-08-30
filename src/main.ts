import { App, Modal, Notice, Plugin, Setting, TFile, moment } from "obsidian";
import { exec } from "child_process";
import { homedir } from "os";
import {
	DEFAULT_SETTINGS,
	FuwariSettingTab,
	type FuwariSettings,
	type FuwariLike,
} from "./settings";
import { getFrontmatter, isPostFile, isRealPost, isUnder, slugify } from "./fm";
import { MetaModal } from "./meta-modal";
import { registerBlogRender } from "./render";

/** A small modal to ask for the new post title. */
class TitleModal extends Modal {
	private onSubmit: (title: string) => void;
	private input!: HTMLInputElement;

	constructor(app: App, onSubmit: (title: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: "新建博客文章" });
		new Setting(this.contentEl).setName("标题").addText((t) => {
			this.input = t.inputEl;
			t.setPlaceholder("文章标题");
			setTimeout(() => t.inputEl.focus(), 50);
		});
		const row = this.contentEl.createDiv({ cls: "fuwari-title-actions" });
		const create = row.createEl("button", { text: "创建", cls: "mod-cta" });
		create.addEventListener("click", () => {
			const title = this.input.value.trim() || "未命名文章";
			this.close();
			this.onSubmit(title);
		});
		this.input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				this.close();
				this.onSubmit(this.input.value.trim() || "未命名文章");
			}
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export default class FuwariToolsPlugin extends Plugin implements FuwariLike {
	settings!: FuwariSettings;
	private processing = new Set<string>();
	private warnThrottle = new Map<string, number>();

	async onload(): Promise<void> {
		await this.loadSettings();

		registerBlogRender(this);

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile) this.onFileModified(file);
			})
		);

		this.addCommand({
			id: "new-blog-post",
			name: "新建博客文章",
			callback: () => this.newPost(),
		});

		this.addCommand({
			id: "edit-blog-meta",
			name: "编辑当前文章的元数据",
			callback: () => this.editMeta(),
		});

		this.addCommand({
			id: "publish-blog",
			name: "一键发布博客",
			callback: () => this.publish(),
		});

		this.addRibbonIcon("file-plus", "新建博客文章", () => this.newPost());
		this.addRibbonIcon("pencil", "编辑当前文章元数据", () => this.editMeta());
		this.addRibbonIcon("send", "一键发布博客", () => this.publish());

		this.addSettingTab(new FuwariSettingTab(this.app, this));
	}

	onunload(): void {
		this.processing.clear();
		this.warnThrottle.clear();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private expandHome(p: string): string {
		return p.replace(/^~(?=\/|$)/, homedir());
	}

	private async newPost(): Promise<void> {
		const postsFolder = this.settings.postsFolder.replace(/\/+$/, "");
		if (!this.app.vault.getAbstractFileByPath(postsFolder)) {
			await this.app.vault.createFolder(postsFolder);
		}
		new TitleModal(this.app, async (title) => {
			let slug = slugify(title);
			let path = `${postsFolder}/${slug}.md`;
			let i = 1;
			while (this.app.vault.getAbstractFileByPath(path)) {
				path = `${postsFolder}/${slug}-${i++}.md`;
			}
			const today = moment().format("YYYY-MM-DD");
			const content = [
				"---",
				`title: "${String(title).replace(/"/g, '\\"')}"`,
				`published: "${today}"`,
				'description: ""',
				"tags: []",
				'category: ""',
				'image: ""',
				"draft: true",
				"---",
				"",
			].join("\n");
			try {
				const file = await this.app.vault.create(path, content);
				new Notice("已创建文章，请补充元数据");
				new MetaModal(this.app, file, this).open();
			} catch (e) {
				new Notice("创建失败: " + (e as Error).message);
			}
		}).open();
	}

	private editMeta(): void {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("没有打开的文章");
			return;
		}
		if (file.extension !== "md" || !isUnder(file.path, this.settings.postsFolder)) {
			new Notice("请打开 posts 目录下的文章");
			return;
		}
		new MetaModal(this.app, file, this).open();
	}

	private async publish(): Promise<void> {
		if (!this.settings.publishEnabled) {
			new Notice("发布功能未启用");
			return;
		}
		const script = this.expandHome(this.settings.publishScriptPath);
		new Notice("开始发布…");
		exec(`/bin/bash "${script}"`, (error, stdout, stderr) => {
			const out = (stdout || "") + (stderr || "");
			if (error) {
				new Notice("发布失败: " + error.message);
				return;
			}
			if (/VERIFY-HTTP\s+200/.test(out)) {
				new Notice("发布成功 ✅ 已上线");
			} else if (/SWAP-DONE/.test(out)) {
				new Notice("发布完成（检查线上状态）");
			} else {
				new Notice("发布结束，请查看线上");
			}
		});
	}

	private onFileModified(file: TFile): void {
		if (!isPostFile(file, this.settings.postsFolder)) return;
		const fm = getFrontmatter(this.app, file);
		if (!fm) return;
		if (fm.title == null && fm.published == null) return;

		const today = moment().format("YYYY-MM-DD");
		const currentUpdated = fm.updated ? moment(fm.updated).format("YYYY-MM-DD") : "";

		// Auto-update `updated`.
		if (this.settings.autoUpdateUpdated && currentUpdated !== today && !this.processing.has(file.path)) {
			const isDraft = fm.draft === true;
			if (!isDraft || this.settings.updateDrafts) {
				this.processing.add(file.path);
				this.app.fileManager
					.processFrontMatter(file, (nfm) => {
						nfm.updated = today;
					})
					.catch(() => {})
					.finally(() => this.processing.delete(file.path));
			}
		}

		// Light validation warning for published posts missing required fields.
		if (this.settings.warnOnSave && fm.draft !== true) {
			const missing: string[] = [];
			if (!fm.published) missing.push("published");
			if (!fm.description) missing.push("description");
			if (missing.length) {
				const now = Date.now();
				const last = this.warnThrottle.get(file.path) || 0;
				if (now - last > 180000) {
					this.warnThrottle.set(file.path, now);
					new Notice(`${file.basename}: 缺少 ${missing.join("、")}`, 5000);
				}
			}
		}
	}
}
