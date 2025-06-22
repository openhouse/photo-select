# photo‑select

A command‑line workflow that **selects 10 random images, asks ChatGPT 4.5 which to “keep” or “set aside,”
moves the files accordingly, and then recurses until a directory is fully triaged.**

## Requirements

- Node 20+
- An OpenAI API key (`OPENAI_API_KEY`)
  ```bash
  export OPENAI_API_KEY="sk‑..."
  ```

* macOS, Linux, or Windows‑WSL (uses only cross‑platform Node APIs)

## Installation

```bash
git clone <repo>
cd photo-select
npm install
```

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

## Recursion logic

1. Pick up to 10 random images (all common photo extensions).
2. Send them to ChatGPT with the prompt (filenames included).
3. Parse the reply for `"keep"` or `"set aside"` decisions.
4. Move each file to the corresponding sub‑folder.
5. Re‑run the algorithm on the newly created `_keep` folder.
6. Stop when a directory has zero unclassified images.

## Caching

Responses from OpenAI are cached under a `.cache` directory using a hash of the
prompt, model, and file metadata. Subsequent runs with the same inputs reuse the
saved reply instead of hitting the API.

## Testing

```bash
npm test
```

Vitest covers random selection, safe moves, and response‑parsing.

## Inspiration

Built to replace a manual workflow that relied on Finder tags and the ChatGPT web UI.
Now everything—random choice, conversation, and file moves—happens automatically in the shell.
