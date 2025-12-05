# Vietnamese Input Patcher for Claude Code

Fix Vietnamese typing in Claude Code CLI for IMEs using backspace technique (OpenKey, Unikey).

## Install

```bash
bun install
```

## Usage

```bash
# Apply patch
bun index.ts patch

# Restore original
bun index.ts restore

# Check status
bun index.ts status
```

Restart Claude Code after patching.

## How it works

Vietnamese IMEs send backspace characters (0x7f/0x08) followed by new Unicode text. Claude Code's Ink-based input handler processes backspaces but doesn't insert the remaining text. This patcher fixes that by processing each character individually.

See [TECHNICAL.md](TECHNICAL.md) for details.
