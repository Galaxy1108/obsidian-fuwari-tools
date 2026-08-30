import { App, Modal, Notice, Setting, TFile, moment } from "obsidian";
import type { FuwariLike } from "./settings";
import { getFrontmatter } from "./fm";
import { CoverSuggestModal, importImage, resourcePath } from "./cover";
import { generateSummary } from "./ai";

function dateVal(v: unknown): string {
	if (v == null || v === "") return "";
	if (typeof v === "string") return v;
	if (v instanceof Date) return moment(v).format("YYYY-MM-DD");
	if (typeof v === "object" && v !== null) {
		const d = v as { year?: number; day?: number; month?: number };
		if (d.year && d.day && d.month) {
			return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
		}
	}
	return String(v);
}

function splitTags(input: string): string[] {
	return input
		.split(/[,\n]/)
		.map((s) => s.trim())
		.filter(Boolean);
}

interface FormState {
	title: string;
	published: string;
	updated: string;
	description: string;
	category: string;
	tags: string;
	draft: boolean;
	image: string;
}

export class MetaModal extends Modal {
	private file: TFile;
	private plugin: FuwariLike;
	private form!: FormState;
	private tagsEl!: HTMLInputElement;
	private descEl!: HTMLTextAreaElement;
	private coverImg!: HTMLImageElement;
	private statusEl!: HTMLElement;

	constructor(app: App, file: TFile, plugin: FuwariLike) {
		super(app);
		this.file = file;
		this.plugin = plugin;
	}

	async onOpen(): Promise<void> {
		const fm = getFrontmatter(this.app, this.file) || {};
		this.form = {
			title: (fm.title as string) || this.file.basename,
			published: dateVal(fm.published),
			updated: dateVal(fm.updated),
			description: (fm.description as string) || "",
			category: (fm.category as string) || "",
			tags: Array.isArray(fm.tags) ? (fm.tags as string[]).join(", ") : String(fm.tags || ""),
			draft: fm.draft === true,
			image: (fm.image as string) || "",
		};

		const { contentEl } = this;
		contentEl.createEl("h2", { text: `文章元数据 — ${this.file.basename}` });

		const add = (name: string, desc: string) => new Setting(contentEl).setName(name).setDesc(desc);

		add("标题", "文章标题（文件名保留为 slug）").addText((t) =>
			t.setValue(this.form.title).onChange((v) => (this.form.title = v)));

		add("发布日期 published", "必填，YYYY-MM-DD").addText((t) =>
			t.setPlaceholder("2026-08-30").setValue(this.form.published).onChange((v) => (this.form.published = v)));

		add("更新日期 updated", "保存时自动维护").addText((t) =>
			t.setPlaceholder("2026-08-30").setValue(this.form.updated).onChange((v) => (this.form.updated = v)));

		add("摘要 description", "首页列表显示").addTextArea((t) => {
			this.descEl = t.inputEl;
			t.setPlaceholder("一句话摘要").setValue(this.form.description).onChange((v) => (this.form.description = v));
		});

		add("分类 category", "单个字符串").addText((t) =>
			t.setValue(this.form.category).onChange((v) => (this.form.category = v)));

		add("标签 tags", "逗号分隔").addText((t) => {
			this.tagsEl = t.inputEl;
			t.setValue(this.form.tags).onChange((v) => (this.form.tags = v));
		});

		add("草稿 draft", "true 则不会发布到线上").addToggle((t) =>
			t.setValue(this.form.draft).onChange((v) => (this.form.draft = v)));

		// Cover
		const coverSetting = add("封面 image", "从 images 目录选取，或上传").addButton((b) =>
			b.setButtonText("选取").onClick(() => this.pickCover()));
		coverSetting.addButton((b) => b.setButtonText("上传").onClick(() => this.uploadCover()));
		coverSetting.addButton((b) => b.setButtonText("移除").onClick(() => {
			this.form.image = "";
			this.updateCoverPreview();
		}));

		const wrap = contentEl.createDiv({ cls: "fuwari-cover-preview" });
		this.coverImg = wrap.createEl("img", { cls: "fuwari-cover-preview-img" });
		this.updateCoverPreview();

		const statusWrap = contentEl.createDiv({ cls: "fuwari-status" });
		statusWrap.createEl("span", { text: "" });
		this.statusEl = statusWrap;
		this.statusEl.style.display = "none";

		// AI summary
		new Setting(contentEl).setName("AI 生成摘要").setDesc("调用配置的 OpenAI 兼容接口").addButton((b) =>
			b
				.setButtonText("生成摘要")
				.setCta()
				.onClick(async () => {
					await this.runAi();
				}));

		// Footer buttons
		const footer = contentEl.createDiv({ cls: "fuwari-modal-footer" });
		const saveBtn = footer.createEl("button", { text: "保存", cls: "mod-cta" });
		saveBtn.addEventListener("click", () => this.save());
		const cancelBtn = footer.createEl("button", { text: "取消" });
		cancelBtn.addEventListener("click", () => this.close());

		// Paste image handler
		this.contentEl.addEventListener("paste", (evt) => {
			const item = Array.from(evt.clipboardData?.items || []).find((i) => i.type.startsWith("image/"));
			if (item) {
				const file = item.getAsFile();
				if (file) {
					evt.preventDefault();
					this.setStatus("正在保存粘贴的封面…");
					void (async () => {
						try {
							const buf = await file.arrayBuffer();
							const p = await importImage(this.app, this.plugin.settings.imagesFolder, "pasted.png", buf);
							this.form.image = p;
							this.updateCoverPreview();
							this.setStatus("✅ 封面已以粘贴图片更新", "ok");
							new Notice("封面已以粘贴图片更新");
						} catch (e) {
							const msg = (e as Error).message;
							this.setStatus("粘贴失败: " + msg, "err");
							new Notice("粘贴失败: " + msg);
						}
					})();
				}
			}
		});
	}

	private setStatus(text: string, kind?: string): void {
		this.statusEl.style.display = "block";
		this.statusEl.setText(text);
		this.statusEl.removeClass("ok");
		this.statusEl.removeClass("err");
		if (kind === "ok") this.statusEl.addClass("ok");
		else if (kind === "err") this.statusEl.addClass("err");
	}

	private updateCoverPreview(): void {
		const path = this.form.image;
		let src = "";
		if (path) {
			// Resolve "/images/foo.png" (public) back to a vault file for a resource URL.
			const imagesFolder = this.plugin.settings.imagesFolder.replace(/\/+$/, "");
			const base = path.replace(/^\//, "");
			const name = base.startsWith("images/") ? base.slice(7) : base;
			const file = this.app.vault.getAbstractFileByPath(`${imagesFolder}/${name}`);
			if (file instanceof TFile) src = resourcePath(this.app, file);
		}
		this.coverImg.style.display = src ? "block" : "none";
		this.coverImg.src = src;
	}

	private pickCover(): void {
		new CoverSuggestModal(this.app, this.plugin.settings.imagesFolder, (file) => {
			this.form.image = `/images/${file.name}`;
			this.updateCoverPreview();
		}).open();
	}

	private uploadCover(): void {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/*";
		input.onchange = async () => {
			const f = input.files?.[0];
			if (!f) return;
			this.setStatus("正在上传封面…");
			try {
				const buf = await f.arrayBuffer();
				const p = await importImage(this.app, this.plugin.settings.imagesFolder, f.name, buf);
				this.form.image = p;
				this.updateCoverPreview();
				this.setStatus("✅ 封面已上传", "ok");
				new Notice("封面已上传");
			} catch (e) {
				const msg = (e as Error).message;
				this.setStatus("上传失败: " + msg, "err");
				new Notice("上传失败: " + msg);
			}
		};
		input.click();
	}

	private async runAi(): Promise<void> {
		if (!this.plugin.settings.aiEnabled || !this.plugin.settings.aiApiKey) {
			new Notice("请先在设置中启用 AI 并填写 API Key");
			return;
		}
		let content: string;
		try {
			content = await this.app.vault.read(this.file);
		} catch (e) {
			new Notice("读取文章失败: " + (e as Error).message);
			return;
		}
		this.setStatus("正在生成摘要…");
		try {
			const result = await generateSummary(content, this.plugin.settings);
			this.form.description = result.summary;
			this.descEl.value = result.summary;
			if (this.plugin.settings.aiGenerateTags) {
				if (result.tags.length) {
					this.form.tags = result.tags.join(", ");
					this.tagsEl.value = this.form.tags;
				}
				if (result.category) {
					this.form.category = result.category;
				}
			}
			this.setStatus("✅ 摘要已生成，可编辑后保存", "ok");
			new Notice("摘要已生成，可编辑后保存");
		} catch (e) {
			const msg = (e as Error).message;
			this.setStatus("AI 生成失败: " + msg, "err");
			new Notice("AI 生成失败: " + msg);
		}
	}

	private async save(): Promise<void> {
		const f = this.form;
		await this.app.fileManager.processFrontMatter(this.file, (fm) => {
			fm.title = f.title;
			if (f.published) fm.published = f.published;
			if (f.updated) fm.updated = f.updated;
			fm.description = f.description;
			fm.category = f.category;
			fm.tags = splitTags(f.tags);
			fm.draft = f.draft;
			if (f.image) fm.image = f.image;
			else delete fm.image;
			if (this.plugin.settings.autoFillPublished && !fm.published && fm.draft === false) {
				fm.published = moment().format("YYYY-MM-DD");
			}
		});
		this.close();
		new Notice("已保存");
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
