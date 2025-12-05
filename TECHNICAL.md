# Vietnamese Input Fix for Claude Code

## Problem

Claude Code CLI uses Ink for terminal UI. Vietnamese IMEs (OpenKey, Unikey) send backspace characters (0x7f or 0x08) followed by new Unicode text. The original code handles backspaces but does not insert the remaining text.

## Bug Location

File: `cli.js` (resolve symlink from `which claude`)

Find pattern:
```
.backspace&&!{VAR}.delete&&{VAR}.includes("\x7f")
```

## Original Buggy Code Structure

```javascript
if(!{KEY}.backspace&&!{KEY}.delete&&{INPUT}.includes("\x7f")){
  let {COUNT}=({INPUT}.match(/\x7f/g)||[]).length,{CURSOR}={ORIG};
  for(let {I}=0;{I}<{COUNT};{I}++){CURSOR}={CURSOR}.backspace();
  if(!{ORIG}.equals({CURSOR})){if({ORIG}.text!=={CURSOR}.text){TEXT_FN}({CURSOR}.text);{OFFSET_FN}({CURSOR}.offset)}
  {CLEAR_FN};
  return  // BUG: missing text insertion
}
```

Variable names are minified and change per version. Common names observed:
- KEY: `KA`
- INPUT: `qA`
- COUNT: `X1`
- CURSOR: `WA`
- ORIG: `N`
- TEXT_FN: `Q`
- OFFSET_FN: `w`
- CLEAR_FN: `_sA()`

## Fixed Code Structure

```javascript
if(!{KEY}.backspace&&!{KEY}.delete&&({INPUT}.includes("\x7f")||{INPUT}.includes("\x08"))){
  /* Vietnamese IME fix */
  let {CURSOR}={ORIG};
  for(let _i=0;_i<{INPUT}.length;_i++){
    let _c={INPUT}.charCodeAt(_i);
    if(_c===127||_c===8){CURSOR}={CURSOR}.backspace();
    else {CURSOR}={CURSOR}.insert({INPUT}[_i])
  }
  if(!{ORIG}.equals({CURSOR})){if({ORIG}.text!=={CURSOR}.text){TEXT_FN}({CURSOR}.text);{OFFSET_FN}({CURSOR}.offset)}
  {CLEAR_FN};
  return
}
```

## Fix Logic

1. Check for both 0x7f (DEL) and 0x08 (BS)
2. Iterate each character in input
3. If charCode is 127 or 8: call backspace()
4. Else: call insert(char)
5. Update state with final cursor

## Search Commands

```bash
# Find CLI path
which claude | xargs readlink

# Find bug pattern
grep -o '.backspace&&.*backspace()' /path/to/cli.js

# Get context
grep -B5 -A10 'includes.*\\x7f' /path/to/cli.js
```

## Regex Pattern

```javascript
const DEL = String.fromCharCode(0x7f);
const pattern = new RegExp(
  String.raw`if\(!(\w+)\.backspace&&!\1\.delete&&(\w+)\.includes\(["'\x60](?:\\x7f|` + DEL + 
  String.raw`)["'\x60]\)\)\{[^}]+\.backspace\(\)[^}]+return;?\}`
);
```

## Patch Marker

```javascript
/* Vietnamese IME fix */
```

Use this to detect if already patched:
```javascript
content.includes("Vietnamese IME fix")
```

## Update Steps for New Versions

1. Run `bun index.ts restore` to get unpatched code
2. Run grep commands above to find new pattern
3. Extract variable names from matched code
4. Update regex patterns in `index.ts`
5. Test with `bun index.ts patch`
6. Verify with `grep "Vietnamese IME fix" /path/to/cli.js`

## Version History

| Version | Status |
|---------|--------|
| 2.0.59 | Working |
