# Fuwari Tools

An Obsidian plugin for managing a [Fuwari](https://github.com/saicaca/fuwari) blog: metadata editor, AI-generated summaries, GitHub repo cards, Fuwari `:::` callouts preview, and one-click publishing.

## Features

- **New blog post** — create a post with a complete Fuwari frontmatter and open the metadata editor.
- **Metadata editor** — edit `title` / `published` / `updated` / `description` / `category` / `tags` / `draft` / `image`; pick or upload a cover image from the vault.
- **AI summary** — call any OpenAI-compatible API (e.g. DeepSeek) to generate `description`, optionally tags and category.
- **Auto `updated`** — updates the `updated` frontmatter field when you save a post.
- **GitHub repo cards** — renders `::github{repo="owner/repo"}` as a card with avatar, stars, forks and license.
- **Fuwari callouts** — renders `:::note` / `:::tip` / `:::important` / `:::warning` / `:::caution` as native Obsidian callouts, and `:spoiler[...]` as blur-until-hover.
- **One-click publish** — runs your publish script and shows the result.

## Installation

1. Build the plugin:

   ```bash
   pnpm install
   node esbuild.config.mjs production
   ```

2. Copy the plugin into your vault:

   ```bash
   mkdir -p <vault>/.obsidian/plugins/fuwari-tools
   cp main.js manifest.json styles.css <vault>/.obsidian/plugins/fuwari-tools/
   ```

3. In Obsidian: **Settings → Community plugins → enable Fuwari Tools** (disable restricted mode first).

## Usage

- Use **New blog post** from the ribbon or command palette to create a post, then fill in the metadata in the editor dialog.
- Configure an OpenAI-compatible endpoint (Base URL / model / API key) in the plugin settings to use **AI summary**.
- `::github{repo="..."}` and `:::note ... :::` are rendered automatically in reading view.
- **One-click publish** runs the script configured in settings (default `~/Documents/Projects/Blog/publish.sh`).

## Configuration

See **Settings → Fuwari Tools**:

| Setting | Description |
|---|---|
| posts folder / images folder | Vault-relative paths (default `vault/posts`, `vault/images`) |
| auto update `updated` | Update the `updated` field on save |
| AI | Base URL, model and API key for summaries |
| publish | Script path for one-click publish |

## Development

```bash
pnpm install
./node_modules/.bin/tsc -noEmit   # type check
node esbuild.config.mjs production # build + copy artifacts
```

## License

MIT
