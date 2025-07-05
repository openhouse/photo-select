#!/usr/bin/env bash
##############################################################################
# generate-overview.sh
#
# Generates a text-based overview of the 'ranked-choice' project and saves
# the result to 'project-overview.txt'. It includes:
#   1. A directory structure overview (via 'tree' or 'ls -R')
#   2. A single-pass approach to display textual contents of files:
#      - PDFs extracted as text, using pdftotext or OCR fallback.
#      - Plain text or JSON/XML files shown in full (with an exception
#        for 'generatedOutputs.json', which is summarized).
#      - Binary files noted but not shown in raw form.
#   3. Skips certain known directories and file patterns:
#      - .git, node_modules, dist, project-overview*, etc.
#   4. Concludes with a basic system report and optional Ollama models listing.
#
# This version uses GNU coreutils' gshuf to randomly sample objects from
# JSON arrays when processing 'generatedOutputs.json'.
#
# Usage:
#   ./scripts/generate-overview.sh
#
# Requirements:
#   - tree (optional, for nicer directory listing)
#   - pdftotext (Poppler) or Xpdf (for PDF text extraction)
#   - tesseract (optional, for OCR fallback if PDF has no embedded text)
#   - ollama (optional, to list installed local models)
#   - jq (for JSON processing)
#   - GNU coreutils (for gshuf, which may be installed via Homebrew coreutils)
#
# WARNING:
#   This script can expose sensitive data in 'project-overview.txt'.
#   Handle the resulting file with care!
##############################################################################

OUTPUT_FILE="project-overview.txt"

# Direct all script output into 'project-overview.txt'
exec > "$OUTPUT_FILE" 2>&1

echo "# Project Overview"
echo "Generated on: $(date)"
echo ""
echo "This script produces a comprehensive snapshot of all files in the ranked-choice project."
echo "Sensitive data could be exposed, so protect 'project-overview.txt' accordingly."
echo "---"
echo ""

##############################################################################
# 1) Directory Structure Overview
##############################################################################
echo "## 1. Directory Structure"
echo ""
if command -v tree >/dev/null 2>&1; then
  echo "Below is the tree of files/folders (excluding .git, node_modules, dist, project-overview*):"
  echo '```'
  tree -a -I ".git|.cache|node_modules|dist|project-overview*" .
  echo '```'
else
  echo "Below is the 'ls -R' style listing of files/folders (excluding .git, node_modules, dist, project-overview*)."
  echo "Install 'tree' for a more visual directory listing."
  echo '```'
  find . \
    -path "*/.git" -prune -o \
    -path "*/.cache" -prune -o \
    -path "*/node_modules" -prune -o \
    -path "*/dist" -prune -o \
    -name "project-overview*" -prune -o \
    -print
  echo '```'
fi

echo ""
echo "---"
echo ""

##############################################################################
# Function to summarize generatedOutputs.json
# - Prints stats on modelName, stage, promptUsed, timestamp range, and a random sample.
##############################################################################
summarize_generated_outputs() {
  local filePath="$1"

  echo "### Summaries for $filePath"
  echo ""

  if ! command -v jq >/dev/null 2>&1; then
    echo "(jq not installed. Cannot provide advanced summary. Only file note.)"
    return
  fi

  # Check file size and object count
  local fileSize
  fileSize=$(stat -c%s "$filePath" 2>/dev/null || stat -f%z "$filePath" 2>/dev/null)
  echo "File size (bytes): $fileSize"

  local totalCount
  totalCount=$(jq '. | length' "$filePath" 2>/dev/null)
  echo "Total JSON objects in $filePath: $totalCount"
  echo ""

  if [ "$totalCount" -eq 0 ] || [ "$totalCount" = "null" ]; then
    echo "(File is empty or not valid JSON.)"
    return
  fi

  # modelName distribution
  echo "#### modelName distribution (sorted by count desc):"
  jq 'group_by(.modelName)
      | map({modelName: .[0].modelName, count: length})
      | sort_by(.count)
      | reverse' "$filePath"
  echo ""

  # stage distribution
  echo "#### stage distribution (sorted by count desc):"
  jq 'group_by(.stage)
      | map({stage: .[0].stage, count: length})
      | sort_by(.count)
      | reverse' "$filePath"
  echo ""

  ## promptUsed distribution
  #echo "#### promptUsed distribution (sorted by count desc):"
  #jq 'group_by(.promptUsed)
  #    | map({promptUsed: .[0].promptUsed, count: length})
  #    | sort_by(.count)
  #    | reverse' "$filePath"
  #echo ""

  # timestamp min/max
  echo "#### timestamp range:"
  local minTimestamp
  local maxTimestamp
  minTimestamp=$(jq 'min_by(.timestamp) | .timestamp' "$filePath")
  maxTimestamp=$(jq 'max_by(.timestamp) | .timestamp' "$filePath")
  echo "Min timestamp: $minTimestamp"
  echo "Max timestamp: $maxTimestamp"
  echo ""

  # Sample size
  local sampleSize=1
  if [ "$totalCount" -lt "$sampleSize" ]; then
    sampleSize="$totalCount"
  fi

  echo "#### Sample $sampleSize object(s) from $filePath:"
  if command -v gshuf >/dev/null 2>&1; then
    # Use gshuf to randomize: output each element on one line, then shuffle, then reassemble into an array.
    jq -c '.[]' "$filePath" | gshuf -n "$sampleSize" | jq -s '.'
  else
    echo "(gshuf not found, falling back to last $sampleSize items.)"
    jq --arg c "$sampleSize" '. | (.[-($c|tonumber):])' "$filePath"
  fi
  echo ""
}

##############################################################################
# 2) Single-Pass: Full Content Dump of Files
##############################################################################
echo "## 2. Full Content Dump"
echo "This section provides a textual representation of each file, skipping certain directories and file patterns."
echo "PDF files are extracted as text if possible; binary files are noted but not shown in raw form."
echo ""

# Directories to skip anywhere in the repo
SKIP_DIRS=(.git node_modules dist .vscode .cache)

# File patterns to skip
SKIP_FILES=("*.lock" "yarn.lock" "package-lock.json" ".env" "project-overview*")

FIND_CMD=(find .)

# Exclude skip directories (anywhere in the path)
for dir in "${SKIP_DIRS[@]}"; do
  FIND_CMD+=( -path "*/$dir" -prune -o )
done

# Only proceed with -type f after pruning directories
FIND_CMD+=( -type f )

# Exclude skip files
for pattern in "${SKIP_FILES[@]}"; do
  FIND_CMD+=( \( -iname "$pattern" \) -prune -o )
done

FIND_CMD+=( -print )

mapfile -t ALL_FILES < <("${FIND_CMD[@]}" 2>/dev/null)

if [ ${#ALL_FILES[@]} -eq 0 ]; then
  echo "No files found based on skip rules."
else
  for file in "${ALL_FILES[@]}"; do
    # If it's the special file generatedOutputs.json, handle differently
    if [[ "$(basename "$file")" == "generatedOutputs.json" ]]; then
      echo "### File: $file"
      echo '```'
      echo "(Instead of a raw dump, providing summary & sample...)"
      echo '```'
      echo ""
      summarize_generated_outputs "$file"
      continue
    fi

    # If it's the special file evaluationResults.json, handle differently
    if [[ "$(basename "$file")" == "evaluationResults.json" ]]; then
      echo "### File: $file"
      echo '```'
      echo "(Instead of a raw dump, providing summary & sample...)"
      echo '```'
      echo ""
      summarize_generated_outputs "$file"
      continue
    fi


    echo "### File: $file"
    echo '```'
    MIME_TYPE=$(file --mime-type -b "$file" 2>/dev/null)

    case "$MIME_TYPE" in
      application/pdf)
        # Attempt PDF text extraction with pdftotext
        if command -v pdftotext >/dev/null 2>&1; then
          PDF_CONTENT=$(pdftotext "$file" - 2>/dev/null)
          if [ -n "$PDF_CONTENT" ]; then
            echo "$PDF_CONTENT"
          else
            # Possibly scanned PDF, try OCR fallback if tesseract is available
            echo "(No embedded text found. Attempting OCR with tesseract...)"
            if command -v tesseract >/dev/null 2>&1; then
              TEMP_TXT=$(mktemp /tmp/ocr.XXXXXX)
              tesseract "$file" "$TEMP_TXT" 2>/dev/null
              if [ -f "${TEMP_TXT}.txt" ]; then
                cat "${TEMP_TXT}.txt"
                rm -f "${TEMP_TXT}.txt"
              else
                echo "(Tesseract failed or produced no output.)"
              fi
            else
              echo "(Tesseract not installed, cannot OCR scanned PDFs.)"
            fi
          fi
        else
          echo "(pdftotext not installed, skipping direct PDF text extraction...)"
        fi
        ;;
      text/*|application/xml|application/json)
        # For normal JSON files, etc., just dump them
        # (But we've already handled generatedOutputs.json separately)
        cat "$file"
        ;;
      *)
        echo "(File type is $MIME_TYPE — skipping raw dump.)"
        ;;
    esac
    echo '```'
    echo ""
  done
fi

echo ""
echo "---"
echo ""

##############################################################################
# 3) Basic System Report
##############################################################################
echo "## 3. Basic System Report"
echo ""
echo "Below is a snapshot of the system’s OS, architecture, date, uptime, disk usage, and memory usage."
echo ""

echo "### OS & Architecture"
echo '```'
if command -v uname >/dev/null 2>&1; then
  uname -a
else
  echo "(Command 'uname' not found.)"
fi
echo '```'
echo ""

echo "### Detailed OS Version"
echo '```'
if [ "$(uname)" = "Darwin" ]; then
  if command -v sw_vers >/dev/null 2>&1; then
    sw_vers
  else
    echo "(sw_vers not available on this macOS system.)"
  fi
elif [ -f /etc/os-release ]; then
  cat /etc/os-release
elif command -v lsb_release >/dev/null 2>&1; then
  lsb_release -a
else
  echo "(No /etc/os-release or 'lsb_release' command found.)"
fi
echo '```'
echo ""

echo "### Current Date & Uptime"
echo '```'
date
if command -v uptime >/dev/null 2>&1; then
  uptime
else
  echo "(Command 'uptime' not found.)"
fi
echo '```'
echo ""

echo "### Disk Usage"
echo '```'
df -h
echo '```'
echo ""

echo "### Memory Usage"
echo '```'
if command -v free >/dev/null 2>&1; then
  free -mh
else
  echo "(Command 'free' not found on this system.)"
fi
echo '```'
echo ""

echo "### Installed RAM"
echo '```'
if [ "$(uname)" = "Darwin" ]; then
  # On macOS, gather memory info with system_profiler
  if command -v system_profiler >/dev/null 2>&1; then
    system_profiler SPMemoryDataType
  else
    echo "(system_profiler not found on this macOS system.)"
  fi
else
  # On Linux, try dmidecode if available
  if command -v dmidecode >/dev/null 2>&1; then
    sudo dmidecode -t memory | grep -i "Size"
  else
    echo "(dmidecode not found, skipping installed memory info.)"
  fi
fi
echo '```'
echo ""

##############################################################################
# 4) Additional ML-Focused System Details
##############################################################################
echo "## 4. Additional ML-Focused System Details"
echo ""

echo "### GPU and CUDA Information"
echo '```'
if command -v nvidia-smi >/dev/null 2>&1; then
  echo "[nvidia-smi]"
  nvidia-smi
else
  echo "(nvidia-smi not found or no NVIDIA GPU installed.)"
fi

if [ "$(uname)" = "Darwin" ]; then
  echo ""
  echo "[system_profiler SPDisplaysDataType]"
  system_profiler SPDisplaysDataType
fi
echo '```'
echo ""

echo "### Python Environment & Packages"
echo '```'
if command -v python3 >/dev/null 2>&1; then
  echo "[python3 -V]"
  python3 -V
  echo ""
  echo "[pip3 freeze]"
  pip3 freeze
else
  echo "(No python3 found. Skipping Python environment details.)"
fi

if command -v conda >/dev/null 2>&1; then
  echo ""
  echo "[conda info --envs]"
  conda info --envs
  echo ""
  echo "[conda list --show-channel-urls]"
  conda list --show-channel-urls
fi
echo '```'
echo ""

echo "### System Compiler & Libraries"
echo '```'
if command -v gcc >/dev/null 2>&1; then
  echo "[gcc --version]"
  gcc --version
fi

if command -v g++ >/dev/null 2>&1; then
  echo ""
  echo "[g++ --version]"
  g++ --version
fi

if command -v clang >/dev/null 2>&1; then
  echo ""
  echo "[clang --version]"
  clang --version
fi

if command -v pkg-config >/dev/null 2>&1; then
  echo ""
  echo "[pkg-config --modversion opencv]"
  pkg-config --modversion opencv || echo "OpenCV not found via pkg-config."
fi
echo '```'
echo ""

echo "### Docker / Container Info"
echo '```'
if command -v docker >/dev/null 2>&1; then
  echo "[docker --version]"
  docker --version
  echo ""
  echo "[docker images]"
  docker images
  echo ""
  echo "[docker ps -a]"
  docker ps -a
else
  echo "(docker command not found. Skipping Docker info.)"
fi
echo '```'
echo ""

echo "### Relevant Environment Variables"
echo '```'
# Print environment but filter out potentially sensitive ones
env | grep -Ei '^(PATH|PYTHONPATH|LD_LIBRARY_PATH|CUDA_VISIBLE_DEVICES|CONDA_.*|VIRTUAL_ENV)='
echo '```'
echo ""

##############################################################################
# 5) Ollama Models (if available)
##############################################################################
echo "### Ollama Models"
echo '```'
if command -v ollama >/dev/null 2>&1; then
  # Show installed models or any relevant status
  ollama list
else
  echo "(Command 'ollama' not found. No Ollama models to list.)"
fi
echo '```'
echo ""

echo "Overview generation complete. The file '$OUTPUT_FILE' has been created."
