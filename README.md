# photo‑select

A command‑line workflow that **selects 10 random images, asks ChatGPT which to “keep” or “set aside,”
moves the files accordingly, and then recurses until a directory is fully triaged.**

---

## Requirements

- Node 20+
- An OpenAI API key (via `OPENAI_API_KEY` or the `--api-key` flag)
  ```bash
  export OPENAI_API_KEY="sk‑..."
  ```

* macOS, Linux, or Windows‑WSL (uses only cross‑platform Node APIs)

## Installation

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
chmod +x src/index.js    # fix permission error when running with npx
```

Invoke the CLI from the project directory using `npx`:

```bash
npx photo-select \
  [--dir /path/to/images] \
  [--provider ollama] \
  [--model qwen2.5vl:32b] \
  [--api-key sk-...] \
  [--context /path/to/context.txt]
```

You can also install globally with `npm install -g` to run `photo-select` anywhere.

## Usage

```bash
# run from the project directory
npx photo-select --provider openai --model gpt-4o [other flags]
# or, if installed globally:
photo-select --provider ollama --model qwen2.5vl:32b [other flags]
```

Run `photo-select --help` to see all options.

### photo-select-here.sh

If you keep the repository cloned on your system, the `photo-select-here.sh`
script lets you run the CLI on whatever directory you're currently in without
typing `--dir` each time. Call it with the path to the script:

```bash
/path/to/photo-select/photo-select-here.sh [photo-select flags]
```

The script automatically:

1. Loads `nvm` and uses the Node version defined in `.nvmrc` if available.
2. Runs `npx photo-select` inside the repo.
3. Sets `--dir` to your current working directory unless you specify it
   explicitly.

All CLI flags—including `--api-key`, `--model`, and `--no-recurse`—can be passed
through to the script unchanged.

### Flags

| flag       | default                      | description                                     |
| ---------- | ---------------------------- | ----------------------------------------------- |
| `--dir`    | current directory            | Source directory containing images              |
| `--prompt` | `prompts/default_prompt.txt` | Path to a custom prompt file                    |
| `--provider` | `openai` | `openai` or `ollama` |
| `--model`  | *(auto)* | Model id for the chosen provider. Defaults to `gpt-4o` or `qwen2.5vl:32b`. |
| `--api-key` | *(unset)*                  | OpenAI API key. Overrides `$OPENAI_API_KEY`. |
| `--ollama-base-url` | `http://localhost:11434` | Ollama host URL |
| `--curators` | *(unset)* | Comma-separated list of curator names used in the group transcript |
| `--context` | *(unset)* | Text file with exhibition context for the curators |
| `--no-recurse` | `false` | Process only the given directory without descending into `_keep` |
| `--parallel` | `1` | Number of batches to process simultaneously |
| `--field-notes` | `false` | Enable notebook updates via field-notes workflow |

When enabled, the tool initializes a git repository in the target directory if one is absent and commits each notebook update using the model's commit message.
During the second pass the prompt includes the two prior versions of each notebook and the commit log for that level so curators can craft a self-contained update.

See [docs/field-notes.md](docs/field-notes.md) for a description of how the
notebook system works.

### Increasing memory

The Node.js heap defaults to about 4 GB. Large runs with `--parallel` greater than 1
may exhaust that limit. Set `PHOTO_SELECT_MAX_OLD_SPACE_MB` to allocate more memory:

```bash
PHOTO_SELECT_MAX_OLD_SPACE_MB=8192 \
  /path/to/photo-select/photo-select-here.sh --parallel 10 --api-key sk-...
```

The value is passed directly to `--max-old-space-size`, so adjust it to match your
available RAM.

### Choosing `--parallel`

Running multiple batches at once hides API latency but can exhaust system resources. See
[`docs/parallel-playbook.md`](docs/parallel-playbook.md) for a practical guide on
tuning this flag. In short, start around twice your physical core count and adjust
until network waits dominate without hitting OpenAI rate limits.

### Streaming responses

To avoid connection timeouts with large image batches, the CLI streams tokens
from OpenAI as soon as they are available. Progress bars advance to a
"stream" stage while data arrives. Streaming keeps the HTTPS socket alive and
reduces the chance of retry loops on slow requests.

### Custom timeout

Long vision batches can occasionally exceed the default 5‑minute HTTP timeout.
The client now waits up to **20 minutes** by default. Set `PHOTO_SELECT_TIMEOUT_MS`
to override this value if your environment needs a different window.

### People metadata (optional)

Set `PHOTO_FILTER_API_BASE` to the base URL of your [photo‑filter](https://github.com/openhouse/photo-filter) service to include face‑tag data in the prompt. The CLI assumes the service is available at `http://localhost:3000` when the variable is unset and logs a warning if requests fail. For each image it fetches `/api/photos/by-filename/<filename>/persons` and sends a JSON blob like `{ "filename": "DSCF1234.jpg", "people": ["Alice", "Bob"] }` before the image itself. Results are cached per filename for the duration of the run.

Example:

```bash
PHOTO_FILTER_API_BASE=http://localhost:3000 \
/path/to/photo-select/photo-select-here.sh --api-key sk-... --model o3 \
  --curators "Ingeborg Gerdes, Alexandra Munroe, Mandy Steinback, Kendell Harbin, Erin Zona, Madeline Gallucci, Deborah Treisman" \
  --context /path/to/info.md
```

## Supported OpenAI models

The CLI calls the Chat Completions API and automatically switches to `/v1/responses` if a model only supports that endpoint. Any vision-capable chat model listed on OpenAI's [models](https://platform.openai.com/docs/models) page should work, including:


* **GPT‑4.1 family** – `gpt-4.1`, `gpt-4.1-mini`, and `gpt-4.1-nano`
* **GPT‑4o family** – `gpt-4o` (default), `gpt-4o-mini`, `gpt-4o-audio-preview`,
  `gpt-4o-mini-audio-preview`, `gpt-4o-realtime-preview`,
  `gpt-4o-mini-realtime-preview`, `gpt-4o-search-preview`, and
  `gpt-4o-mini-search-preview`
* **o‑series reasoning models** – `o4-mini`, `o3`, `o3-pro` *(responses API)*,
  `o3-mini`, `o1`, `o1-pro`, and the deprecated `o1-mini`
* **Other vision models** – `gpt-4-turbo`, `gpt-4.5-preview` *(deprecated)*. The
  `gpt-4-vision-preview` model has been removed.

Example output of `openai api models.list`:

```text
gpt-4.1-nano
gpt-4.1-nano-2025-04-14
gpt-4.5-preview
gpt-4.5-preview-2025-02-27
gpt-4o
gpt-4o-2024-05-13
gpt-4o-2024-08-06
gpt-4o-2024-11-20
gpt-4o-audio-preview
gpt-4o-audio-preview-2024-10-01
gpt-4o-audio-preview-2024-12-17
gpt-4o-audio-preview-2025-06-03
gpt-4o-mini
gpt-4o-mini-2024-07-18
gpt-4o-mini-audio-preview
gpt-4o-mini-audio-preview-2024-12-17
gpt-4o-mini-realtime-preview
gpt-4o-mini-realtime-preview-2024-12-17
gpt-4o-mini-search-preview
gpt-4o-mini-search-preview-2025-03-11
gpt-4o-realtime-preview
gpt-4o-realtime-preview-2024-10-01
gpt-4o-realtime-preview-2024-12-17
gpt-4o-realtime-preview-2025-06-03
gpt-4o-search-preview
gpt-4o-search-preview-2025-03-11
o1
o1-2024-12-17
o1-mini
o1-mini-2024-09-12
o1-pro
o1-pro-2025-03-19
o3
o3-2025-04-16
o3-mini
o3-mini-2025-01-31
o3-pro
o3-pro-2025-06-10
o4-mini
o4-mini-2025-04-16
```
These names match the model ids provided by the OpenAI Node SDK, as seen in its
[type definitions](node_modules/openai/resources/beta/assistants.d.ts).

Models in the `o` series use the new `max_completion_tokens` parameter instead of
the deprecated `max_tokens`. When the CLI falls back to the Responses API, that
option is called `max_output_tokens`. Both are handled automatically based on
the model you specify.

## Supported Ollama models (local)

Running with `--provider ollama` lets you triage images entirely offline.
The following vision models are known to work:

- `llama3.2-vision:11b`
- `llama3.2-vision:90b`
- `qwen2.5vl:32b`
- `qwen2.5vl:72b`
- `mistral-small3.1-vision`
- `llava:34b` *(research only)*
- `moondream:1.8b`

Specify one with `--provider ollama --model <tag>`.

### Estimated costs

The cost depends on the number of tokens generated from your images. Roughly
speaking, a single 6240 × 4160 image is about 8,000 input tokens. Processing the
full 315‑photo set therefore uses about 2.5 million input tokens plus roughly
250k output tokens.

Approximate price per run:

| model          | input $/1M | output $/1M | est. cost on 315 photos |
| -------------- | ---------- | ----------- | ---------------------- |
| `gpt-4.1`      | $2.00      | $8.00       | ~$7 |
| `gpt-4.1-mini` | $0.40      | $1.60       | ~$1.4 |
| `gpt-4.1-nano` | $0.10      | $0.40       | ~$0.35 |
| `o4-mini`      | $1.10      | $4.40       | ~$3.85 |
| `o3`           | $2.00      | $8.00       | ~$7 |
| `o3-pro`       | $20.00     | $80.00      | ~$70 |
| `o3-mini`      | $1.10      | $4.40       | ~$3.85 |
| `o1`           | $15.00     | $60.00      | ~$52.5 |
| `o1-pro`       | $150.00    | $600.00     | ~$525 |
| `gpt-4o`       | $2.50      | $10.00      | ~$9 |
| `gpt-4o-mini`  | $0.15      | $0.60       | ~$0.55 |
| `gpt-4-turbo`  | $10.00     | $30.00      | ~$33 |
| `gpt-4.5-preview`      | $75.00     | $150.00     | ~$225 |
| `gpt-4`        | $30.00     | $60.00      | ~$90 |

These figures are approximate and based on current
[OpenAI pricing](https://openai.com/pricing). Actual costs will vary with output
length and any image resizing.

### Measuring model quality

There is no public benchmark for photo triage, so the best approach is to
create a small validation set—say 30–50 images—with your own "keep" vs. "aside"
labels. Run the CLI on this set with different models (using `--model` or
`PHOTO_SELECT_MODEL`) and save the results. Comparing those decisions to your
labels lets you compute precision, recall, and F1‑score for each model. Repeating
the process on multiple batches will highlight which model gives the most
consistent choices.

The tool creates `_keep` and `_aside` sub‑folders inside every directory it touches.

### Example: A/B testing models

You can duplicate a directory of images and run the script on each copy with
different `--model` values. Each run writes its own `_keep` and `_aside` folders
so you can compare the results side by side.

```bash
# prepare two identical folders
mkdir trial-gpt-4o trial-gpt-4.5-preview
cp /path/to/source/*.jpg trial-gpt-4o/
cp /path/to/source/*.jpg trial-gpt-4.5-preview/

# run with GPT‑4o
/path/to/photo-select/photo-select-here.sh --model gpt-4o --dir trial-gpt-4o --api-key sk-... --context /path/to/context.txt

# run with GPT‑4.5-preview
/path/to/photo-select/photo-select-here.sh --model gpt-4.5-preview --dir trial-gpt-4.5-preview --api-key sk-... --context /path/to/context.txt
```

If you see repeated `OpenAI error (404)` messages, your API key may not have
access to that model or the id is misspelled. Check `openai models:list` to
confirm which ids are enabled for your account. Models that require the
`/v1/responses` endpoint—such as `o1-pro` or `o3-pro`—are automatically routed
through that API, so no extra flags are needed.


## Recursion logic

1. Pick up to 10 random images (all common photo extensions).
2. Send them to ChatGPT with the prompt (filenames included).
3. ChatGPT replies with meeting minutes summarising a short discussion among the curators, followed by a JSON object indicating which files to keep or set aside and why.
4. Parse that JSON to determine which files were explicitly labeled `keep` or `aside` and capture any notes about each image.
5. Move those files to the corresponding sub‑folders and write a text file containing the notes next to each image. Files omitted from the decision block remain in place for the next batch so the model can review them again. Meeting minutes are saved as `minutes-<timestamp>.txt` in the directory.
6. Re‑run the algorithm on the newly created `_keep` folder (unless `--no-recurse`).
   If every photo at a level is kept or every photo is set aside, recursion stops early.
7. On the first pass of each level a `_level-XXX` folder is created next to `_keep` and `_aside` containing a snapshot of the images originally present. If any files fail to copy after three retries (common on network drives), their paths are recorded in `failed-archives.txt` inside that folder.
8. Stop when a directory has zero unclassified images.

### JSON mode

The OpenAI request uses `response_format: { type: "json_object" }` so the
assistant replies with strict JSON. This avoids needing to strip Markdown
fences and guarantees parseable output.
The CLI allows up to 4096 tokens in each reply (see `MAX_RESPONSE_TOKENS` in
`src/chatClient.js`) so the minutes and JSON decision block are returned in
full.

## Caching

Responses from OpenAI are cached under a `.cache` directory using a hash of the
prompt, model, and file metadata. Subsequent runs with the same inputs reuse the
saved reply instead of hitting the API.

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

Built to replace a manual workflow that relied on Finder tags and the ChatGPT web UI.
Now everything—random choice, conversation, and file moves—happens automatically in the shell.
