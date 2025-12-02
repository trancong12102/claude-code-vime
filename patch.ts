
import { $ } from "bun";
import fs from "fs";
import path from "path";

console.log("🔍 Finding Claude Code installation...");

try {
    // Find where claude command is located
    const claudePath = (await $`which claude`.text()).trim();

    if (!claudePath) {
        console.error("❌ Error: 'claude' command not found in PATH");
        console.error("Please make sure Claude Code is installed");
        process.exit(1);
    }

    console.log(`✓ Found claude at: ${claudePath}`);

    // Resolve the symlink to get the actual cli.js path
    let cliJsPath = claudePath;
    try {
        const stats = fs.lstatSync(claudePath);
        if (stats.isSymbolicLink()) {
            const linkTarget = fs.readlinkSync(claudePath);
            if (path.isAbsolute(linkTarget)) {
                cliJsPath = linkTarget;
            } else {
                cliJsPath = path.resolve(path.dirname(claudePath), linkTarget);
            }
            
            // In case the symlink points to another symlink or the final target
            // We might want to verify if it ends with cli.js or needs further resolution
            // But typically 'which claude' -> symlink -> ... -> cli.js
            // If path ends in bin/claude, it likely links to lib/node_modules/.../cli.js
        }
    } catch (e) {
        console.error("Error resolving symlink:", e);
    }

    // Sometimes the symlink points to a bin wrapper, not directly cli.js
    // But based on your environment: .../bin/claude -> ../lib/node_modules/@anthropic-ai/claude-code/cli.js
    // The readlink logic above should handle relative paths correctly.

    console.log(`✓ Target file path: ${cliJsPath}`);

    if (!fs.existsSync(cliJsPath)) {
        console.error(`❌ Error: cli.js not found at ${cliJsPath}`);
        process.exit(1);
    }

    // Create backup
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
    const backupPath = `${cliJsPath}.backup-${timestamp}`;
    console.log(`📁 Creating backup at: ${backupPath}`);
    fs.copyFileSync(cliJsPath, backupPath);

    // Read content
    let content = fs.readFileSync(cliJsPath, "utf8");
    console.log("🔧 Applying Vietnamese IME fix (Bun version)...\n");

    // Check if fix is already applied
    if (content.includes("Vietnamese IME detection")) {
        console.log("✅ Fix already applied!");
        process.exit(0);
    }

    // ---------------------------------------------------------
    // PART 1: Disable the built-in DEL interceptor
    // ---------------------------------------------------------
    const interceptorPattern = /if\(!(\w+)\.backspace&&!(\w+)\.delete&&(\w+)\.includes\("[\x7f]"\)\)\{/g;
    const interceptorMatches = [...content.matchAll(interceptorPattern)];

    if (interceptorMatches.length > 0) {
        console.log("Found built-in interceptor pattern, disabling it...");
        const iMatch = interceptorMatches[0]!;
        const iFullMatch = iMatch[0];
        const iIndex = content.indexOf(iFullMatch);

        const disabledInterceptor = iFullMatch.replace("if(", "if(false&&");
        content =
            content.substring(0, iIndex) +
            disabledInterceptor +
            content.substring(iIndex + iFullMatch.length);
        console.log("✅ Disabled built-in DEL interceptor");
    } else {
        console.log("⚠️ Could not find built-in DEL interceptor (check version?)");
    }

    // ---------------------------------------------------------
    // PART 2: Inject Vietnamese IME handler
    // ---------------------------------------------------------
    const searchPattern = /return (\w+)\.insert\((\w+)\((\w+)\)\.replace\(\/\\r\/g,/g;
    const matches = [...content.matchAll(searchPattern)];

    if (matches.length === 0) {
        console.error("❌ Could not find any input processing patterns");
        process.exit(1);
    }

    // Usually the last match is the one in the input handler
    const lastMatch = matches[matches.length - 1]!;
    const stateVar = lastMatch[1];
    const wrapperFunc = lastMatch[2];
    const inputVar = lastMatch[3];

    console.log(`📍 Found input processing pattern:`);
    console.log(`  • State/cursor variable: ${stateVar}`);
    console.log(`  • Input variable: ${inputVar}`);

    const fullMatchStr = lastMatch[0];
    const index = content.lastIndexOf(fullMatchStr);

    if (index === -1) {
        console.error("❌ Could not locate pattern in content");
        process.exit(1);
    }

    const vietnameseIMECode = `
// Vietnamese IME detection: Check if ${inputVar} contains DEL chars (0x7f)
if(${inputVar}&&${inputVar}.length>0&&(${inputVar}.charCodeAt(0)===0x7F||${inputVar}.charCodeAt(0)===127)){
    // Count DEL chars and extract actual text
    let delCount=0,actualText="";
    for(let i=0;i<${inputVar}.length;i++){
        if(${inputVar}.charCodeAt(i)===0x7F||${inputVar}.charCodeAt(i)===127)delCount++;
        else{actualText=${inputVar}.substring(i);break;}
    }
    // Apply the replacement
    let tempO=${stateVar};
    for(let i=0;i<delCount;i++)tempO=tempO.backspace();
    tempO=tempO.insert(actualText);
    return tempO;
}`;

    const newContent =
        content.substring(0, index) +
        vietnameseIMECode +
        content.substring(index);

    fs.writeFileSync(cliJsPath, newContent);

    console.log("\n✅ Vietnamese input fix successfully applied!");
    console.log("🎯 Please restart Claude Code for changes to take effect");

} catch (error) {
    console.error("\n❌ An error occurred:", error);
    process.exit(1);
}
