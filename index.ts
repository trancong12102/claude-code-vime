#!/usr/bin/env bun
import { $ } from "bun";
import { readlink, readdir, stat } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";

const BACKUP_PREFIX = ".backup.";
const PATCH_MARKER = "/* Vietnamese IME fix */";

// Colors for terminal output
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function findClaudeCli(): Promise<string> {
  // Try to find claude command
  const result = await $`which claude`.quiet().nothrow();
  if (result.exitCode !== 0) {
    throw new Error("Claude CLI not found. Make sure 'claude' is installed and in PATH.");
  }

  let claudePath = result.stdout.toString().trim();

  // Resolve symlinks
  try {
    const linkTarget = await readlink(claudePath);
    // Handle relative symlinks
    if (!linkTarget.startsWith("/")) {
      claudePath = resolve(dirname(claudePath), linkTarget);
    } else {
      claudePath = linkTarget;
    }
  } catch {
    // Not a symlink, use as-is
  }

  // Verify file exists
  const file = Bun.file(claudePath);
  if (!(await file.exists())) {
    throw new Error(`Claude CLI file not found at: ${claudePath}`);
  }

  return claudePath;
}

async function getVersion(cliPath: string): Promise<string | null> {
  const content = await Bun.file(cliPath).text();
  const match = content.match(/\/\/ Version: ([\d.]+)/);
  return match?.[1] ?? null;
}

async function isPatched(cliPath: string): Promise<boolean> {
  const content = await Bun.file(cliPath).text();
  return content.includes(PATCH_MARKER);
}

async function findBackups(cliPath: string): Promise<string[]> {
  const dir = dirname(cliPath);
  const baseName = cliPath.split("/").pop()!;
  
  try {
    const files = await readdir(dir);
    return files
      .filter((f) => f.startsWith(baseName + BACKUP_PREFIX))
      .sort()
      .reverse(); // newest first
  } catch {
    return [];
  }
}

async function backup(cliPath: string): Promise<string> {
  const timestamp = Date.now();
  const backupPath = `${cliPath}${BACKUP_PREFIX}${timestamp}`;
  
  const content = await Bun.file(cliPath).text();
  await Bun.write(backupPath, content);
  
  return backupPath;
}

async function restore(cliPath: string): Promise<void> {
  const backups = await findBackups(cliPath);
  
  const latest = backups[0];
  if (!latest) {
    throw new Error("No backup found to restore.");
  }

  const latestBackup = join(dirname(cliPath), latest);
  const content = await Bun.file(latestBackup).text();
  await Bun.write(cliPath, content);
  
  console.log(green("✓") + ` Restored from: ${latest}`);
}

async function patch(cliPath: string): Promise<void> {
  // Check if already patched
  if (await isPatched(cliPath)) {
    console.log(yellow("!") + " Already patched. Use 'restore' to revert first.");
    return;
  }

  // Create backup
  const backupPath = await backup(cliPath);
  console.log(green("✓") + ` Backup created: ${backupPath.split("/").pop()}`);

  // Read content
  let content = await Bun.file(cliPath).text();

  // The bug pattern looks like:
  // if(!KA.backspace&&!KA.delete&&qA.includes("\x7f")){
  //   let X1=(qA.match(/\x7f/g)||[]).length,WA=N;
  //   for(let EA=0;EA<X1;EA++)WA=WA.backspace();
  //   if(!N.equals(WA)){if(N.text!==WA.text)Q(WA.text);w(WA.offset)}
  //   _sA();
  //   return   <-- BUG: returns without inserting remaining text
  // }
  //
  // Fix: Insert remaining text BEFORE updating state, then update state with final cursor

  // Find the exact pattern and replace the entire block
  // Match: includes check -> count DEL -> backspace loop -> state update -> return
  // Note: DEL char (0x7f) appears as literal byte in the minified code
  const DEL = String.fromCharCode(0x7f);
  const bugPattern = new RegExp(
    String.raw`(if\(!([\w$]+)\.backspace&&!\2\.delete&&([\w$]+)\.includes\(["'\x60](?:\\x7f|` + DEL + String.raw`)["'\x60]\)\)\{let ([\w$]+)=\(\3\.match\(/\\x7f/g\)\|\|\[\]\)\.length,([\w$]+)=([\w$]+);for\(let ([\w$]+)=0;\7<\4;\7\+\+\)\5=\5\.backspace\(\);)(if\(!\6\.equals\(\5\)\)\{if\(\6\.text!==\5\.text\)([\w$]+)\(\5\.text\);([\w$]+)\(\5\.offset\)\})([\w$]+\(\);?)(return;?\})`
  );

  let matched = false;
  const match = content.match(bugPattern);

  if (match) {
    console.log(green("✓") + " Found Vietnamese input bug pattern");
    
    const [
      fullMatch,
      beforeStateUpdate,  // if(!KA.backspace... for loop
      _keyVar,            // KA
      inputVar,           // qA
      countVar,           // X1
      cursorVar,          // WA
      originalCursor,     // N
      _loopVar,           // EA
      stateUpdateBlock,   // if(!N.equals(WA)){...}
      textUpdateFn,       // Q
      offsetUpdateFn,     // w
      clearFn,            // _sA()
      returnStmt,         // return}
    ] = match;

    // Build the fixed version:
    // Process each character: DEL (0x7f) or BS (0x08) = backspace, others = insert
    // This handles interleaved DEL/BS and text correctly
    // OpenKey on macOS sends backspace events that may be translated to either 0x7f or 0x08
    const fixedBlock = `if(!${_keyVar}.backspace&&!${_keyVar}.delete&&(${inputVar}.includes("\\x7f")||${inputVar}.includes("\\x08"))){${PATCH_MARKER}
let ${cursorVar}=${originalCursor};for(let _i=0;_i<${inputVar}.length;_i++){let _c=${inputVar}.charCodeAt(_i);if(_c===127||_c===8)${cursorVar}=${cursorVar}.backspace();else ${cursorVar}=${cursorVar}.insert(${inputVar}[_i])}if(!${originalCursor}.equals(${cursorVar})){if(${originalCursor}.text!==${cursorVar}.text)${textUpdateFn}(${cursorVar}.text);${offsetUpdateFn}(${cursorVar}.offset)}${clearFn}${returnStmt}`;

    content = content.replace(fullMatch, fixedBlock);
    matched = true;
  }

  // Fallback: simpler pattern matching - capture full block including clear function and return
  if (!matched) {
    // Match the full block: if(!HA.backspace&&!HA.delete&&UA.includes("\x7f")){...jrA();return}
    // Use a pattern that captures up to the clear function call and return statement
    const simplePattern = new RegExp(
      String.raw`if\(!([\w$]+)\.backspace&&!\1\.delete&&([\w$]+)\.includes\(["'\x60](?:\\x7f|` + DEL + String.raw`)["'\x60]\)\)\{[^}]+\.backspace\(\)[^}]+\}([\w$]+)\(\);return\}`,
      'g'
    );
    
    for (const m of content.matchAll(simplePattern)) {
      const fullMatch = m[0];
      const keyVar = m[1];
      const inputVar = m[2];
      const clearFn = m[3]; // e.g., jrA
      if (!keyVar || !inputVar || !clearFn) continue;
      
      // Extract variables from the block content
      // Pattern: let X1=(UA.match(/\x7f/g)||[]).length,WA=L;for(let $A=0;$A<X1;$A++)WA=WA.backspace();
      const cursorMatch = fullMatch.match(/,(\w+)=(\w+);for/);
      if (!cursorMatch?.[1] || !cursorMatch?.[2]) continue;
      const cursorVar = cursorMatch[1];
      const originalCursor = cursorMatch[2];
      
      // Extract state update functions from: if(!L.equals(WA)){if(L.text!==WA.text)Q(WA.text);q(WA.offset)}
      const textFnMatch = fullMatch.match(/(\w+)\(\w+\.text\)/);
      const offsetFnMatch = fullMatch.match(/(\w+)\(\w+\.offset\)/);
      if (!textFnMatch?.[1] || !offsetFnMatch?.[1]) continue;
      
      const textUpdateFn = textFnMatch[1];
      const offsetUpdateFn = offsetFnMatch[1];

      console.log(green("✓") + " Found Vietnamese input bug pattern (fallback)");
      console.log(dim(`  Variables: input=${inputVar}, cursor=${cursorVar}, original=${originalCursor}, clear=${clearFn}`));

      // Build fixed block - process char by char, handle both DEL (0x7f) and BS (0x08)
      const fixedBlock = `if(!${keyVar}.backspace&&!${keyVar}.delete&&(${inputVar}.includes("\\x7f")||${inputVar}.includes("\\x08"))){${PATCH_MARKER}
let ${cursorVar}=${originalCursor};for(let _i=0;_i<${inputVar}.length;_i++){let _c=${inputVar}.charCodeAt(_i);if(_c===127||_c===8)${cursorVar}=${cursorVar}.backspace();else ${cursorVar}=${cursorVar}.insert(${inputVar}[_i])}if(!${originalCursor}.equals(${cursorVar})){if(${originalCursor}.text!==${cursorVar}.text)${textUpdateFn}(${cursorVar}.text);${offsetUpdateFn}(${cursorVar}.offset)}${clearFn}();return}`;

      content = content.replace(fullMatch, fixedBlock);
      matched = true;
      break;
    }
  }

  // Last resort: direct string search and replace
  if (!matched) {
    // Find the specific string pattern - DEL char (0x7f) may be literal or escaped
    const delChar = String.fromCharCode(0x7f);
    const searchStr = `.includes("${delChar}")`;
    const idx = content.indexOf(searchStr);
    
    if (idx !== -1) {
      // Find the block boundaries
      const blockStart = content.lastIndexOf("if(!", idx);
      const returnIdx = content.indexOf("return", idx);
      const blockEnd = content.indexOf("}", returnIdx) + 1;
      
      if (blockStart !== -1 && returnIdx !== -1 && blockEnd > returnIdx) {
        const block = content.slice(blockStart, blockEnd);
        
        // Extract variable names from the block
        const inputMatch = block.match(/([\w$]+)\.includes\(/);
        const cursorMatch = block.match(/,([\w$]+)=([\w$]+);for/);
        const textFnMatch = block.match(/([\w$]+)\([\w$]+\.text\)/);
        const offsetFnMatch = block.match(/([\w$]+)\([\w$]+\.offset\)/);
        
        if (inputMatch && cursorMatch && textFnMatch && offsetFnMatch) {
          const inputVar = inputMatch[1];
          const cursorVar = cursorMatch[1];
          const originalCursor = cursorMatch[2];
          const textFn = textFnMatch[1];
          const offsetFn = offsetFnMatch[1];
          
          // Extract key variable (e.g., KA)
          const keyMatch = block.match(/if\(!([\w$]+)\.backspace/);
          const keyVar = keyMatch ? keyMatch[1] : "KA";
          
          // Extract clear function call (e.g., jrA() or _sA())
          const clearMatch = block.match(/\}([\w$]+)\(\);?return/);
          const clearFn = clearMatch ? `${clearMatch[1]}()` : "";
          
          console.log(green("✓") + " Found Vietnamese input bug pattern (direct search)");
          
          // Build completely new block - process char by char, handle both DEL (0x7f) and BS (0x08)
          const newBlock = `if(!${keyVar}.backspace&&!${keyVar}.delete&&(${inputVar}.includes("\\x7f")||${inputVar}.includes("\\x08"))){${PATCH_MARKER}
let ${cursorVar}=${originalCursor};for(let _i=0;_i<${inputVar}.length;_i++){let _c=${inputVar}.charCodeAt(_i);if(_c===127||_c===8)${cursorVar}=${cursorVar}.backspace();else ${cursorVar}=${cursorVar}.insert(${inputVar}[_i])}if(!${originalCursor}.equals(${cursorVar})){if(${originalCursor}.text!==${cursorVar}.text)${textFn}(${cursorVar}.text);${offsetFn}(${cursorVar}.offset)}${clearFn ? clearFn + ";" : ""}return}`;
          
          content = content.replace(block, newBlock);
          matched = true;
        }
      }
    }
  }

  if (!matched) {
    console.log(red("✗") + " Could not find the Vietnamese input bug pattern.");
    console.log(dim("  The CLI version might have different code structure."));
    console.log(dim("  Backup was created, no changes made to cli.js"));
    return;
  }

  // Write patched content
  await Bun.write(cliPath, content);
  console.log(green("✓") + " Patch applied successfully!");
  console.log(dim("  Restart Claude Code to apply changes."));
}

async function status(cliPath: string): Promise<void> {
  const version = await getVersion(cliPath);
  const patched = await isPatched(cliPath);
  const backups = await findBackups(cliPath);
  const stats = await stat(cliPath);
  
  console.log("\nClaude Code Vietnamese Input Patcher");
  console.log("─".repeat(40));
  console.log(`CLI Path:  ${dim(cliPath)}`);
  console.log(`Version:   ${version || "unknown"}`);
  console.log(`Patched:   ${patched ? green("Yes") : yellow("No")}`);
  console.log(`Modified:  ${new Date(stats.mtime).toLocaleString()}`);
  console.log(`Backups:   ${backups.length > 0 ? backups.join(", ") : dim("none")}`);
  console.log();
}

function showHelp(): void {
  console.log(`
Claude Code Vietnamese Input Patcher
=====================================

Fix Vietnamese typing with Telex/VNI input methods that use DEL characters.

Usage:
  bun index.ts <command>

Commands:
  patch    Apply the Vietnamese input fix
  restore  Restore from the latest backup
  status   Show current status and version info
  help     Show this help message

Examples:
  bun index.ts patch     # Apply fix
  bun index.ts restore   # Revert to backup
  bun index.ts status    # Check status
`);
}

// Main
async function main() {
  const command = process.argv[2];

  try {
    const cliPath = await findClaudeCli();
    console.log(green("✓") + ` Found Claude CLI: ${dim(cliPath)}`);

    switch (command) {
      case "patch":
        await patch(cliPath);
        break;
      case "restore":
        await restore(cliPath);
        break;
      case "status":
        await status(cliPath);
        break;
      case "help":
      case "--help":
      case "-h":
        showHelp();
        break;
      default:
        if (command) {
          console.log(red("✗") + ` Unknown command: ${command}`);
        }
        showHelp();
    }
  } catch (error) {
    console.error(red("✗") + ` ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

main();
