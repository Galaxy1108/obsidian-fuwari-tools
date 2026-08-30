import { App, Modal, Notice, Plugin, Setting, TFile, moment } from "obsidian";
import { exec } from "child_process";
import { homedir } from "os";
import {
	DEFAULT_SETTINGS,
	FuwariSettingTab,
	type FuwariSettings,
	type FuwariLike,
} from "./settings";
import { getFrontmatter, isPostFile, isRealPost, isUnder, pinyinSlug, slugify } from "./fm";
import { git, autoCommitMessage } from "./git";
import { MetaModal } from "./meta-modal";
import { registerBlogRender } from "./render";
import { livePreviewExtension } from "./livepreview";

/** A small modal to create a new post: only title + tags + category; the rest is auto-filled. */
class NewPostModal extends Modal {
	private onSubmit: (title: string, tags: string[], category: string) => void;
	private titleInput!: HTMLInputElement;
	private tagsInput!: HTMLInputElement;
	private catInput!: HTMLInputElement;

	constructor(app: App, onSubmit: (title: string, tags: string[], category: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		this.contentEl.createEl("h3", { text: "新建博客文章" });
		new Setting(this.contentEl).setName("标题").addText((t) => {
			this.titleInput = t.inputEl;
			t.setPlaceholder("文章标题");
			setTimeout(() => t.inputEl.focus(), 50);
		});
		new Setting(this.contentEl).setName("标签").setDesc("逗号分隔").addText((t) => {
			this.tagsInput = t.inputEl;
			t.setPlaceholder("技术, 笔记");
		});
		new Setting(this.contentEl).setName("分类").addText((t) => {
			this.catInput = t.inputEl;
			t.setPlaceholder("学习记录");
		});
		const row = this.contentEl.createDiv({ cls: "fuwari-title-actions" });
		const create = row.createEl("button", { text: "创建", cls: "mod-cta" });
		create.addEventListener("click", () => this.submit());
		this.contentEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.submit();
			}
		});
	}

	private submit(): void {
		const title = this.titleInput.value.trim() || "未命名文章";
		const tags = this.tagsInput.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
		const category = this.catInput.value.trim();
		this.close();
		this.onSubmit(title, tags, category);
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
		this.registerEditorExtension([livePreviewExtension]);

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
			name: "更改文件元数据",
			callback: () => this.editMeta(),
		});

		this.addCommand({
			id: "publish-blog",
			name: "一键发布博客",
			callback: () => this.publish(),
		});

		this.addCommand({
			id: "sync-github",
			name: "同步到 GitHub（提交并推送）",
			callback: () => this.pushToGithub(),
		});

		this.addCommand({
			id: "pull-github",
			name: "从 GitHub 拉取",
			callback: () => this.pullFromGithub(),
		});

		this.addRibbonIcon("file-plus", "新建博客文章", () => this.newPost());
		this.addRibbonIcon("pencil", "更改文件元数据", () => this.editMeta());
		this.addRibbonIcon("send", "一键发布博客", () => this.publish());
		this.addRibbonIcon("cloud-upload", "同步到 GitHub", () => this.pushToGithub());
		this.addRibbonIcon("cloud-download", "从 GitHub 拉取", () => this.pullFromGithub());

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
		new NewPostModal(this.app, async (title, tags, category) => {
			let slug = slugify(title);
			let path = `${postsFolder}/${slug}.md`;
			let i = 1;
			while (this.app.vault.getAbstractFileByPath(path)) {
				path = `${postsFolder}/${slug}-${i++}.md`;
			}
			const today = moment().format("YYYY-MM-DD");
			const q = (s: string) => `"${String(s).replace(/"/g, '\\"')}"`;
			const tagsYaml = tags.length ? tags.map(q).join(", ") : "";
			const content = [
				"---",
				`title: ${q(title)}`,
				`slug: ${q(pinyinSlug(title))}`,
				`published: "${today}"`,
				`updated: "${today}"`,
				'description: ""',
				tags.length ? `tags: [${tagsYaml}]` : "tags: []",
				`category: ${q(category)}`,
				'image: ""',
				"draft: true",
				"---",
				"",
			].join("\n");
			try {
				await this.app.vault.create(path, content);
				new Notice("已创建文章（草稿）。如需补摘要/封面，用「编辑当前文章元数据」或侧边 AI 按钮");
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

	/** Working directory for git commands: the configured repo path, else the vault's filesystem root. */
	private gitCwd(): string | null {
		const configured = (this.settings.gitRepoPath || "").trim();
		if (configured) return this.expandHome(configured);
		const adapter = this.app.vault.adapter as { getBasePath?: () => string };
		const base = adapter?.getBasePath?.();
		return base ? base : null;
	}

	private async pushToGithub(): Promise<void> {
		const cwd = this.gitCwd();
		if (!cwd) {
			new Notice("找不到仓库目录（vault 路径）");
			return;
		}
		try {
			const status = await git(cwd, ["status", "--porcelain"]);
			const lines = status.stdout.trim();
			if (!lines) {
				new Notice("没有需要推送的改动");
				return;
			}
			const count = lines.split("\n").length;
			new Notice("正在提交并推送…");
			await git(cwd, ["add", "-A"]);
			await git(cwd, ["commit", "-m", autoCommitMessage()]);
			await git(cwd, ["push", this.settings.gitRemote, this.settings.gitBranch]);
			new Notice(`已推送到 GitHub ✅（${count} 个改动）`);
		} catch (e) {
			new Notice("推送失败: " + (e as Error).message);
		}
	}

	private async pullFromGithub(): Promise<void> {
		const cwd = this.gitCwd();
		if (!cwd) {
			new Notice("找不到仓库目录（vault 路径）");
			return;
		}
		try {
			const status = await git(cwd, ["status", "--porcelain"]);
			if (status.stdout.trim()) {
				new Notice("检测到本地改动，先自动提交…");
				await git(cwd, ["add", "-A"]);
				await git(cwd, ["commit", "-m", autoCommitMessage()]);
			}
			new Notice("正在从 GitHub 拉取…");
			await git(cwd, ["pull", "--rebase", this.settings.gitRemote, this.settings.gitBranch]);
			new Notice("已从 GitHub 拉取 ✅");
			new Notice("若文件列表未刷新：设置 → 文件与链接 → 开启「检测所有文件变更」，或重启 Obsidian。", 8000);
		} catch (e) {
			new Notice("拉取失败: " + (e as Error).message);
		}
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
