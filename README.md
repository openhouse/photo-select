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

The Ollama provider uses the official `ollama` JavaScript library. Images are
sent by file path so no base64 encoding step is required.

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

### demote-thumb.js

Run `node scripts/demote-thumb.js <file> <image>` to convert an embedded
thumbnail to a plain link inside a Markdown file. The tool also appends
`~ Demoted: <image>` to the `Δ‑Summary` block, creating it if missing.

This helps you stay within the three‑thumbnail budget when curating notes.

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
| `--verbosity` | `high` | Verbosity for GPT-5 models (`low`, `medium`, `high`) |
| `--reasoning-effort` | `high` | Reasoning effort for GPT-5 models (`minimal`, `low`, `medium`, `high`) |
| `--no-recurse` | `false` | Process only the given directory without descending into `_keep` |
| `--parallel` | *(deprecated)* | Maps to `--workers` and prints a warning |
| `--field-notes` | `false` | Enable notebook updates via field-notes workflow |
| `--verbose` | `false` | Print extra logs and save prompts/responses |
| `--workers` | *(unset)* | Max number of worker processes; each starts a new batch as soon as it finishes |

When `--field-notes` is enabled, the tool initializes a git repository in the target directory if one is absent and commits each notebook update using the model's commit message. During the second pass the prompt includes the two prior versions of each notebook and the commit log for that level so curators can craft a self-contained update.

See [docs/field-notes.md](docs/field-notes.md) for a description of how the notebook system works.

### Increasing memory

The Node.js heap defaults to about 4 GB. Large runs with `--parallel` or `--workers` greater than 1
may exhaust that limit. Set `PHOTO_SELECT_MAX_OLD_SPACE_MB` to allocate more memory:

```bash
PHOTO_SELECT_MAX_OLD_SPACE_MB=8192 \
  /path/to/photo-select/photo-select-here.sh --workers 10 --api-key sk-...
```

The value is passed directly to `--max-old-space-size`, so adjust it to match your
available RAM.

### Concurrency: `--workers` (recommended)

Use `--workers N` to process batches concurrently. The old `--parallel` flag is deprecated and is automatically mapped to `--workers`. A deprecation warning is printed if you use it.

### Streaming responses

To avoid connection timeouts with large image batches, the CLI streams tokens
from OpenAI as soon as they are available. Progress bars advance to a
"stream" stage while data arrives. Streaming keeps the HTTPS socket alive and
reduces the chance of retry loops on slow requests.

### Console summary & minutes files

By default, the console shows a colourised summary. Minutes are saved as **JSON**; TXT transcripts are optional.

| variable | default | description |
| --- | --- | --- |
| `PHOTO_SELECT_PRETTY` | `1` | `0` to print raw LLM reply |
| `PHOTO_SELECT_PRETTY_MINUTES` | `all (TTY) / 20 (CI)` | `all`/`0` for no cap, or a number |
| `PHOTO_SELECT_TRANSCRIPT_TXT` | `0` | `1` to also write `minutes-*.txt` (human‑readable) |

**Primary artifact:** `minutes-<uuid>.json`
```json
{ "minutes": [{ "speaker": "Name", "text": "..." }],
  "decisions": [{ "filename": "file.jpg", "decision": "keep|aside", "reason": "" }] }
```

### Custom timeout

Long vision batches can occasionally exceed the default 3‑minute HTTP timeout.
Set `PHOTO_SELECT_TIMEOUT_MS` or `OLLAMA_HTTP_TIMEOUT` to widen this window.
For GPT‑5 workloads, `PHOTO_SELECT_TIMEOUT_MS=600000` (10 min) has been reliable.
`OLLAMA_HTTP_TIMEOUT` mirrors the official Ollama SDK and is respected when using
the bundled provider.

### Structured outputs and JSON mode

Both providers generate a JSON schema for each request so vision models return
typed responses. The environment variables `PHOTO_SELECT_OLLAMA_FORMAT` and
`PHOTO_SELECT_OPENAI_FORMAT` can override this behaviour and are parsed as JSON
when the value begins with `{`. Use an empty string to omit the parameter. The
legacy `"json"` flag is still available for Ollama but is unreliable with
images; schema-based structured outputs work with vision models.

```bash
export PHOTO_SELECT_OLLAMA_FORMAT='{"type":"object","properties":{...}}'
# or disable the parameter entirely
export PHOTO_SELECT_OLLAMA_FORMAT=""
```

Set `PHOTO_SELECT_OLLAMA_NUM_PREDICT` to control the length of Ollama replies.
By default it roughly matches the 4,096-token output limit of many OpenAI models.

`PHOTO_SELECT_TIMEOUT_MS` also governs how long the CLI waits for a response from
either provider. The default is 3 minutes. Pass `--verbose` or set
`PHOTO_SELECT_VERBOSE=1` to print additional debugging output when requests fail.

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

* **GPT‑5 family** – `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, and `gpt-5-chat-latest`
* **GPT‑4.1 family** – `gpt-4.1`, `gpt-4.1-mini`, and `gpt-4.1-nano`
* **GPT‑4o family** – `gpt-4o` (default), `gpt-4o-mini`, `gpt-4o-audio-preview`,
  `gpt-4o-mini-audio-preview`, `gpt-4o-realtime-preview`,
  `gpt-4o-mini-realtime-preview`, `gpt-4o-search-preview`, and
  `gpt-4o-mini-search-preview`
* **o‑series reasoning models** – `o4-mini`, `o4-mini-deep-research`, `o3`,
  `o3-deep-research`, `o3-pro` *(responses API)*, `o3-mini`, `o1`, `o1-pro`,
  and `o1-mini`
* **Legacy vision models** – `gpt-4-turbo`, `gpt-4.5-preview` *(deprecated)*.
  The `gpt-4-vision-preview` model has been removed.

Example output of `openai api models.list`:

```text
gpt-5
gpt-5-mini
gpt-5-nano
gpt-4.1
gpt-4.1-mini
gpt-4o
gpt-4o-mini
gpt-4o-realtime-preview
gpt-4o-search-preview
o1
o1-mini
o1-pro
o3
o3-mini
o3-pro
o4-mini
o4-mini-deep-research
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

| model                | input $/1M | output $/1M | est. cost on 315 photos |
| -------------------- | ---------- | ----------- | ---------------------- |
| `gpt-5`              | $1.25      | $10.00      | ~$5.62 |
| `gpt-5-mini`         | $0.25      | $2.00       | ~$1.12 |
| `gpt-5-nano`         | $0.05      | $0.40       | ~$0.23 |
| `gpt-4.1`            | $2.00      | $8.00       | ~$7.00 |
| `gpt-4.1-mini`       | $0.40      | $1.60       | ~$1.40 |
| `gpt-4.1-nano`       | $0.10      | $0.40       | ~$0.35 |
| `gpt-4o`             | $2.50      | $10.00      | ~$8.75 |
| `gpt-4o-mini`        | $0.15      | $0.60       | ~$0.53 |
| `o4-mini`            | $1.10      | $4.40       | ~$3.85 |
| `o4-mini-deep-research` | $2.00   | $8.00       | ~$7.00 |
| `o3`                 | $2.00      | $8.00       | ~$7.00 |
| `o3-pro`             | $20.00     | $80.00      | ~$70.00 |
| `o3-mini`            | $1.10      | $4.40       | ~$3.85 |
| `o3-deep-research`   | $10.00     | $40.00      | ~$35.00 |
| `o1`                 | $15.00     | $60.00      | ~$52.50 |
| `o1-pro`             | $150.00    | $600.00     | ~$525.00 |
| `o1-mini`            | $1.10      | $4.40       | ~$3.85 |

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
mkdir trial-gpt-4o trial-gpt-5
cp /path/to/source/*.jpg trial-gpt-4o/
cp /path/to/source/*.jpg trial-gpt-5/

# run with GPT‑4o
/path/to/photo-select/photo-select-here.sh --model gpt-4o --dir trial-gpt-4o --api-key sk-... --context /path/to/context.txt

# run with GPT‑5
/path/to/photo-select/photo-select-here.sh --model gpt-5 --dir trial-gpt-5 --api-key sk-... --context /path/to/context.txt
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
5. Move those files to the corresponding sub‑folders and write a text file containing the notes next to each image. Files omitted from the decision block remain in place for the next batch so the model can review them again. Meeting minutes are saved as `minutes-<uuid>.json` (and `minutes-<uuid>.txt` when `PHOTO_SELECT_TRANSCRIPT_TXT=1`).
6. Re‑run the algorithm on the newly created `_keep` folder (unless `--no-recurse`).
   If every photo at a level is kept or every photo is set aside, recursion stops early.
7. On the first pass of each level a `_level-XXX` folder is created next to `_keep` and `_aside` containing a snapshot of the images originally present. If any files fail to copy after three retries (common on network drives), their paths are recorded in `failed-archives.txt` inside that folder.
8. Stop when a directory has zero unclassified images.

### Structured outputs (OpenAI)

OpenAI requests now include a JSON schema so the API returns typed responses.
Set `PHOTO_SELECT_OPENAI_FORMAT` to override this or provide an empty string to
skip the format parameter entirely on chat.completions.

```bash
export PHOTO_SELECT_OPENAI_FORMAT='{"type":"json_object","schema":{...}}'
export PHOTO_SELECT_OPENAI_FORMAT=""  # disable the parameter
```

For chat.completions the request uses
`response_format: { type: "json_object" }`.
For the Responses API (gpt-5 models) the schema is supplied under
`text.format` with top-level `name`, `schema`, and `strict: true`.
In both cases the assistant replies with strict JSON, avoiding the need to
strip Markdown fences.
The CLI allows up to 32000 tokens in each reply (see `MAX_RESPONSE_TOKENS` in
`src/chatClient.js`) so the minutes and JSON decision block are returned in
full.

## Caching

Responses from OpenAI are cached under a `.cache` directory using a hash of the
prompt, model, and file metadata. Subsequent runs with the same inputs reuse the
saved reply instead of hitting the API. The tool never caches model responses
that contain zero decisions (0 keeps + 0 asides). Such entries are skipped on
write and evicted on read. If a batch still produces no decisions, the run is
retried (finalize mode when 10 or fewer images remain). After two consecutive
no-decision replies, the batch is marked `NEEDS_REVIEW` and processing
continues.

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
