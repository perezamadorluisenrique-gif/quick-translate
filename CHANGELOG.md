# Changelog

The release workflow uses the section named after the version being released
as the release description, so every version needs one. `npm version <x.y.z>`
renames the `Unreleased` heading below to that version.

## 0.1.0

- Translate the selection into a window with a language picker, Copy, Insert below and Replace selection, or replace it or insert the translation below in one undoable edit.
- Translate a whole note into a new note beside it, without overwriting an earlier translation.
- Front matter, code, maths, comments, links, embeds, tags and list, heading and table syntax stay exactly as written; link labels and the text around them are translated.
- Google Translate (no key, unofficial), DeepL with your own key kept in Obsidian's secret storage, and MyMemory, with an optional retry on MyMemory when a service fails.
