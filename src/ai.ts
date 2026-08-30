import { requestUrl } from "obsidian";
import type { FuwariSettings } from "./settings";

export interface AiResult {
	summary: string;
	tags: string[];
	category: string;
}

/** Trim leading frontmatter and clamp to maxChars. */
function cleanBody(content: string, maxChars: number): string {
	const trimmed = content.replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
	return trimmed.slice(0, maxChars);
}

function joinList(items: unknown[]): string[] {
	return items.map((s) => String(s).trim()).filter(Boolean);
}

/**
 * Call an OpenAI-compatible chat completions endpoint to generate a summary
 * (and optionally tags/category) for a post's body.
 */
export async function generateSummary(
	content: string,
	settings: FuwariSettings
): Promise<AiResult> {
	const body = cleanBody(content, settings.aiMaxChars);
	const wantTags = settings.aiGenerateTags;

	let systemPrompt =
		"你是一个博客助手。请阅读给定的文章，输出一句话中文摘要（不超过 150 字），直接输出正文，不要引号、不要「摘要：」前缀。";
	if (wantTags) {
		systemPrompt += " 另外再用 JSON 输出推荐标签与分类：形如 {\"tags\": [\"标签1\",\"标签2\"], \"category\": \"分类\"}，放在摘要之后，用 --- 分隔。";
	}

	const userPrompt = wantTags
		? `文章内容：\n\n${body}\n\n请输出：第一行为中文摘要；然后一行 ---；然后一行 JSON 形如 {"tags":["a","b"],"category":"c"}。`
		: `文章内容：\n\n${body}`;

	const payload = {
		model: settings.aiModel,
		messages: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: userPrompt },
		],
		temperature: 0.3,
		max_tokens: 500,
	};

	const base = settings.aiBaseUrl.replace(/\/+$/, "");
	const resp = await requestUrl({
		url: `${base}/chat/completions`,
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${settings.aiApiKey}`,
		},
		body: JSON.stringify(payload),
	});

	if (resp.status < 200 || resp.status >= 300) {
		throw new Error(`AI API ${resp.status}: ${(resp.text || "").slice(0, 200)}`);
	}

	const data = resp.json as {
		choices?: Array<{ message?: { content?: string } }>;
	};
	const text = data?.choices?.[0]?.message?.content?.trim() || "";

	if (!wantTags) {
		return { summary: text, tags: [], category: "" };
	}

	// Split summary and JSON.
	const lines = text.split(/\r?\n/);
	const sep = lines.findIndex((l) => /^---+$/.test(l.trim()));
	const summary = sep >= 0 ? lines.slice(0, sep).join("\n").trim() : text;
	let tags: string[] = [];
	let category = "";
	if (sep >= 0) {
		const jsonPart = lines.slice(sep + 1).join("\n").trim();
		const m = jsonPart.match(/\{[\s\S]*\}/);
		if (m) {
			try {
				const obj = JSON.parse(m[0]) as { tags?: unknown[]; category?: unknown };
				tags = joinList(obj.tags || []);
				category = String(obj.category || "").trim();
			} catch {
				// ignore malformed JSON
			}
		}
	}

	return { summary, tags, category };
}
