#!/usr/bin/env bash
set -euo pipefail

repo_dir=".repos/effect"
repo_url="https://github.com/Effect-TS/effect-smol"

if [ -d "$repo_dir/.git" ]; then
	exit 0
fi

mkdir -p "$(dirname "$repo_dir")"
git clone --depth 1 "$repo_url" "$repo_dir"
