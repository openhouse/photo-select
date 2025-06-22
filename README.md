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

Invoke the CLI from the project directory using `npx`:

```bash
npx photo-select [--dir /path/to/images] [--prompt /path/to/prompt.txt] [--model gpt-4.5]
```

You can also install globally with `npm install -g` to run `photo-select` anywhere.

## Usage

```bash
npx photo-select [--dir /path/to/images] [--prompt /path/to/prompt.txt] [--model gpt-4.5]
# or, if installed globally:
photo-select [--dir /path/to/images] [--prompt /path/to/prompt.txt] [--model gpt-4.5]
```

Run `photo-select --help` to see all options.

### Flags

| flag       | default                      | description                                     |
| ---------- | ---------------------------- | ----------------------------------------------- |
| `--dir`    | current directory            | Source directory containing images              |
| `--prompt` | `prompts/default_prompt.txt` | Path to a custom prompt file                    |
| `--model`  | `gpt-4o-mini`                | Any chat‑completion model id you have access to. Can also be set via `$PHOTO_SELECT_MODEL`. |
| `--no-recurse` | `false` | Process only the given directory without descending into `_keep` |

## Supported OpenAI models

The tool uses OpenAI's chat completion models with vision support. Notable options include:

* `gpt-4o` – flagship multimodal model
* `gpt-4o-mini` – smaller, faster, cheaper version (default)
* `gpt-4-turbo` – high context window model
* `gpt-4.5` – optional mid‑tier model
* `gpt-4-vision-preview` – earlier vision model

These names match the model ids provided by the OpenAI Node SDK, as seen in its
[type definitions](node_modules/openai/resources/beta/assistants.d.ts).

### Estimated costs

The cost depends on the number of tokens generated from your images. Roughly
speaking, a single 6240 × 4160 image is about 8,000 input tokens. Processing the
full 315‑photo set therefore uses about 2.5 million input tokens plus roughly
250k output tokens.

Approximate price per run:

| model          | input $/1M | output $/1M | est. cost on 315 photos |
| -------------- | ---------- | ----------- | ---------------------- |
| `gpt-4o-mini`  | $0.15      | $0.60       | ~$0.55 |
| `gpt-4o`       | $2.50      | $10.00      | ~$9 |
| `gpt-4-turbo`  | $10.00     | $30.00      | ~$33 |
| `gpt-4.5`      | $75.00     | $150.00     | ~$225 |
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

## Recursion logic

1. Pick up to 10 random images (all common photo extensions).
2. Send them to ChatGPT with the prompt (filenames included).
3. Parse the reply for `"keep"` or `"set aside"` decisions.
4. Move each file to the corresponding sub‑folder.
5. Re‑run the algorithm on the newly created `_keep` folder (unless `--no-recurse`).
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
