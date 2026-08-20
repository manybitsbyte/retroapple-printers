/*
 * roms.js - Aggregated character-generator ROM banks
 *
 * Re-exports every font bank in the package under one namespace, so hosts can
 * `import { roms } from "@manybitsbyte/retroapple-printers"` and reach a glyph
 * table without knowing which file it lives in.
 *
 * A bank maps a character code to an array of dot columns, left to right. A
 * column is a vertical bitmask: bit 0 is the top wire. Nine-wire banks run to
 * bit 8 (the descender wire, so values exceed 0xFF); the ImageWriter II NLQ
 * banks run to bit 17 across an 18-row cell. Proportional banks carry a
 * variable column count per glyph, and the trailing blank column is the
 * built-in inter-character spacer — it is part of the advance, not padding.
 *
 * Each bank has locale siblings (…_DE, _FR, _IT, _ES, _SE, _UK, _DK) that
 * replace the ten alternate-language code points selected by DIP switch, plus a
 * _LOCALE_MAP and a _LOCALES list. Models resolve those internally via
 * getDraftChar(code, locale) and friends; they are exported here for tools that
 * need to enumerate or edit them.
 *
 * Written by
 *  Mike Daley <michael_daley@icloud.com>
 *  Shawn Bullock <https://github.com/manybitsbyte>
 *
 * Copyright (c) 2026 Shawn Bullock
 * Copyright (c) 2026 Mike Daley
 * SPDX-License-Identifier: MIT
 */

export * from "./imagewriter-ii-rom-draft.js";
export * from "./imagewriter-ii-rom-nlq-fixed.js";
export * from "./imagewriter-ii-rom-nlq-prop.js";
export * from "./imagewriter-ii-rom-standard-fixed.js";
export * from "./imagewriter-ii-rom-standard-prop.js";
export * from "./imagewriter-i-rom-standard-fixed.js";
export * from "./imagewriter-i-rom-standard-prop.js";
export * from "./apple-dmp-rom.js";
export * from "./epson-fx80-rom.js";
