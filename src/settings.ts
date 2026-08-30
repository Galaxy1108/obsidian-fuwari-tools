import { App, PluginSettingTab, Setting } from "obsidian";

export interface FuwariSettings {
	postsFolder: string;
	imagesFolder: string;
	autoUpdateUpdated: boolean;
	updateDrafts: boolean;
	warnOnSave: boolean;
	autoFillPublished: boolean;
	aiEnabled: boolean;
	aiBaseUrl: string;
	aiModel: string;
	aiApiKey: string;
	aiMaxChars: number;
	aiGenerateTags: boolean;
	publishEnabled: boolean;
	publishScriptPath: string;
}

export const DEFAULT_SETTINGS: FuwariSettings = {
	postsFolder: "vault/posts",
	imagesFolder: "vault/images",
	autoUpdateUpdated: true,
	updateDrafts: false,
	warnOnSave: true,
	autoFillPublished: false,
	aiEnabled: false,
	aiBaseUrl: "https://api.deepseek.com/v1",
	aiModel: "deepseek-chat",
	aiApiKey: "",
	aiMaxChars: 2000,
	aiGenerateTags: false,
	publishEnabled: true,
	publishScriptPath: "~/Documents/Projects/Blog/publish.sh",
};

/** Minimal plugin surface the UI needs, to avoid importing the Plugin class directly. */
export interface FuwariLike {
	settings: FuwariSettings;
	loadSettings(): Promise<void>;
	saveSettings(): Promise<void>;
}

export class FuwariSettingTab extends PluginSettingTab {
	plugin: FuwariLike;

	constructor(app: App, plugin: FuwariLike) {
		super(app, plugin as never);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("文章目录").setDesc("vault 内相对路径").addText((t) =>
			t.setPlaceholder("vault/posts").setValue(this.plugin.settings.postsFolder).onChange(async (v) => {
				this.plugin.settings.postsFolder = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl).setName("图片目录").setDesc("封面/插图存放目录").addText((t) =>
			t.setPlaceholder("vault/images").setValue(this.plugin.settings.imagesFolder).onChange(async (v) => {
				this.plugin.settings.imagesFolder = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl).setName("保存时自动更新 updated").addToggle((t) =>
			t.setValue(this.plugin.settings.autoUpdateUpdated).onChange(async (v) => {
				this.plugin.settings.autoUpdateUpdated = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl).setName("也更新草稿（draft:true）").addToggle((t) =>
			t.setValue(this.plugin.settings.updateDrafts).onChange(async (v) => {
				this.plugin.settings.updateDrafts = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl).setName("保存时提醒缺必填字段").addToggle((t) =>
			t.setValue(this.plugin.settings.warnOnSave).onChange(async (v) => {
				this.plugin.settings.warnOnSave = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl).setName("自动补 published").setDesc("已发布文章缺日期时保存补当天").addToggle((t) =>
			t.setValue(this.plugin.settings.autoFillPublished).onChange(async (v) => {
				this.plugin.settings.autoFillPublished = v;
				await this.plugin.saveSettings();
			}));

		containerEl.createEl("h3", { text: "AI 摘要" });

		new Setting(containerEl).setName("启用 AI 生成摘要").addToggle((t) =>
			t.setValue(this.plugin.settings.aiEnabled).onChange(async (v) => {
				this.plugin.settings.aiEnabled = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl).setName("Base URL").setDesc("OpenAI 兼容端点，如 DeepSeek").addText((t) =>
			t.setPlaceholder("https://api.deepseek.com/v1").setValue(this.plugin.settings.aiBaseUrl).onChange(async (v) => {
				this.plugin.settings.aiBaseUrl = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl).setName("模型").addText((t) =>
			t.setPlaceholder("deepseek-chat").setValue(this.plugin.settings.aiModel).onChange(async (v) => {
				this.plugin.settings.aiModel = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl).setName("API Key").setDesc("仅保存在本地 data.json").addText((t) => {
			t.setPlaceholder("sk-...").setValue(this.plugin.settings.aiApiKey).onChange(async (v) => {
				this.plugin.settings.aiApiKey = v;
				await this.plugin.saveSettings();
			});
			t.inputEl.type = "password";
		});

		new Setting(containerEl).setName("发送正文字符数上限").addText((t) =>
			t.setValue(String(this.plugin.settings.aiMaxChars)).onChange(async (v) => {
				const n = parseInt(v, 10);
				this.plugin.settings.aiMaxChars = isNaN(n) || n < 100 ? 2000 : n;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl).setName("AI 顺带生成 tags/category").addToggle((t) =>
			t.setValue(this.plugin.settings.aiGenerateTags).onChange(async (v) => {
				this.plugin.settings.aiGenerateTags = v;
				await this.plugin.saveSettings();
			}));

		containerEl.createEl("h3", { text: "发布" });

		new Setting(containerEl).setName("启用一键发布").addToggle((t) =>
			t.setValue(this.plugin.settings.publishEnabled).onChange(async (v) => {
				this.plugin.settings.publishEnabled = v;
				await this.plugin.saveSettings();
			}));

		new Setting(containerEl).setName("发布脚本路径").addText((t) =>
			t.setPlaceholder("~/Documents/Projects/Blog/publish.sh").setValue(this.plugin.settings.publishScriptPath).onChange(async (v) => {
				this.plugin.settings.publishScriptPath = v;
				await this.plugin.saveSettings();
			}));
	}
}
