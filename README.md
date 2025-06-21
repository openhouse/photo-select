# photo‑select

A command‑line workflow that **selects 10 random images, asks ChatGPT 4.5 which to “keep” or “set aside,”
moves the files accordingly, and then recurses until a directory is fully triaged.**

---

## Requirements

| Tool               | Purpose                                     | Quick install                                           |
| ------------------ | ------------------------------------------- | ------------------------------------------------------- |
| **nvm**            | Manages Node versions                       | <https://github.com/nvm-sh/nvm#installing-and-updating> |
| **Node 20 LTS**    | Runtime (auto‑selected by nvm via `.nvmrc`) | `nvm install`                                           |
| **OpenAI API key** | Access ChatGPT 4.5                          | add to `.env`                                           |

---

### 1  Set up Node with nvm

```bash
cd photo-select
nvm install   # obeys .nvmrc (Node 20.x)
nvm use
```

### 2  Configure your API key

1. Copy the template:

   ```bash
   cp .env.example .env
   ```

2. Paste your real key in `.env`:

   ```dotenv
   OPENAI_API_KEY=sk-...
   ```

No need to `export` the key in every shell—`dotenv` loads it automatically.

### 3  Install dependencies

```bash
npm install
```

---

## Usage

```bash
photo-select --dir /path/to/images [--prompt /path/to/prompt.txt] [--model gpt-4o]
```

### Flags

| flag       | default                      | description                                     |
| ---------- | ---------------------------- | ----------------------------------------------- |
| `--dir`    | **required**                 | Source directory containing images              |
| `--prompt` | `prompts/default_prompt.txt` | Path to a custom prompt file                    |
| `--model`  | `gpt-4o-mini`                | Any chat‑completion model id you have access to |

The tool creates `_keep` and `_aside` sub‑folders inside every directory it touches.

---

## Recursion logic

1. Pick up to 10 random images (all common photo extensions).
2. Send them to ChatGPT with the prompt (filenames included).
3. Parse the reply for `"keep"` or `"set aside"` decisions.
4. Move each file to the corresponding sub‑folder.
5. Re‑run the algorithm on the newly created `_keep` folder.
6. Stop when a directory has zero unclassified images.

---

## Testing

```bash
npm test
```

The **Vitest** suite covers random selection, safe moves, and response‑parsing.

---

## Development tips

- Use `nvm use` in every new shell (or add a shell hook).
- Need a different Node version temporarily? `nvm exec 18 npm test`.
- `.env` is ignored by git—share `.env.example` instead.

---

## Inspiration

Replaces a manual workflow that relied on Finder tags and the ChatGPT web UI.
Now everything—random choice, conversation, and file moves—happens automatically in the shell.
