# Quick Translate

Translate the selection or a whole note into another language with no account, keeping links, code and front matter untouched.

Quick Translate is a successor to [Translate](https://github.com/fevol/obsidian-translate), Language Translator and DeepL, none of which has been updated for two years or more.

## What it does

- **Translate selection** shows the translation in a small window: pick another language there and it translates again, then **Copy**, **Insert below** or **Replace selection**. Two more commands skip the window: **Translate selection and replace it** and **Translate selection and insert it below**. In the settings you choose what plain **Translate selection** does. The right-click menu has **Translate selection into [language]** and **Translate selection into…**.
- **Translate note into a new note** writes the translation beside the original as `Note (es).md` (or in a folder you set) and opens it in a new tab. A second run makes `Note (es 2).md`; nothing is overwritten. The file-explorer menu has the same entry, and **Translate note into a new note in…** asks for the language.
- **One edit, one undo.** Replace and insert are a single editor transaction, so one undo takes them back. If the text you selected changes while the translation is on its way, nothing is written.
- **Markdown stays Markdown.** Front matter, code blocks and inline code, maths, comments, wikilinks and embeds, link addresses, bare addresses, tags, footnote references, block ids, list markers, task boxes, heading marks, callout types and table pipes are never sent (each table cell is translated on its own, so a language with another word order cannot move text between columns) and come back exactly as they were. Link labels and the text around everything else are translated. A sentence with a link or code in the middle is sent whole so the translator sees all of it; if the translator mangles the placeholders for the syntax, the pieces are translated one by one instead, which reads worse but never loses a link.
- **Detects the source language** (or fix it in the settings). A note already in the target language is left alone, with a message.
- **Remembers translations** for the session, so repeating a command costs no request.

## Services

| Service | Needs | Notes |
| --- | --- | --- |
| Google Translate (default) | Nothing | An unofficial web address that Google can change or block. If it stops working, pick another service. |
| DeepL | Your own key | Free keys (ending in `:fx`) and Pro keys both work. The key is kept in Obsidian's secret storage, not in `data.json`. |
| MyMemory | Nothing | A free translation memory with a daily limit. Add an email in the settings for a larger one. Quality is uneven on short phrases. |

When the service you picked is down or refuses a request, the **Retry with MyMemory** setting (on by default) sends that text to MyMemory instead and says so. Turn it off to send text only to the service you picked. A wrong DeepL key is never retried elsewhere.

## Settings

Service, language to translate into (it starts as the language Obsidian is shown in), language to translate from, retry with MyMemory, DeepL key, MyMemory email, what **Translate selection** does, the folder for translated notes, and whether to open them. They appear in Obsidian's settings search.

## Network use

Quick Translate talks to the network only when you run a translate command, through Obsidian's own `requestUrl`, and only to the service you picked:

- `translate.googleapis.com`: Google Translate.
- `api-free.deepl.com` or `api.deepl.com`: DeepL, with your key in a header.
- `api.mymemory.translated.net`: MyMemory, and also what the retry setting falls back to.

What is sent is the prose of the selection or note, with the syntax above taken out, plus the language codes. No account, no telemetry, nothing else. These services keep their own logs under their own terms, so do not translate notes you would not send to them. Long notes are sent in many small requests; services may slow or refuse them, and the message says so.

## Not included

No offline translation, no AI models, no document formats other than Markdown, no translation in Reading view, and no automatic translation as you type. Indented code blocks (four spaces) are translated, because Obsidian's nested lists use the same indent. Single `*` and `_` emphasis marks are left to the translator.

## Installation

In Obsidian, open **Settings → Community plugins → Browse** and search for "Quick Translate".

## More plugins by Siulved54

| Plugin | What it does | Source |
| --- | --- | --- |
| [Shared Blocks](https://obsidian.md/plugins?id=shared-blocks) | Write a block of text once and reuse it in any note. Edit the source and every reference re-renders live. | [shared-blocks](https://github.com/perezamadorluisenrique-gif/shared-blocks) |
| [Text Case and Cleanup](https://obsidian.md/plugins?id=text-format) | Change case, make camelCase or slugs, sort lines and remove duplicates, and repair text pasted out of a PDF, without touching code or URLs. | [text-format](https://github.com/perezamadorluisenrique-gif/text-format) |
| [Typography as You Type](https://obsidian.md/plugins?id=typography-as-you-type) | Curly quotes, dashes and ellipses as you type, kept out of code and maths, with Backspace to take one back. | [smart-typography-plugin](https://github.com/perezamadorluisenrique-gif/smart-typography-plugin) |
| [Section Numbering](https://obsidian.md/plugins?id=section-numbering) | Number headings as an outline (1, 1.1, 1.2) and keep every link to them working when they renumber. | [section-numbering](https://github.com/perezamadorluisenrique-gif/section-numbering) |
| [Spreadsheet to Table](https://obsidian.md/plugins?id=spreadsheet-to-table) | Paste cells from Excel or Google Sheets as a Markdown table with a real header, insert CSV files, and copy tables back out. | [spreadsheet-to-table](https://github.com/perezamadorluisenrique-gif/spreadsheet-to-table) |
| [Hybrid Line Numbers](https://obsidian.md/plugins?id=hybrid-line-numbers) | Relative and hybrid line numbers for Vim-style jumps, where a folded section counts as one line. | [hybrid-line-numbers](https://github.com/perezamadorluisenrique-gif/hybrid-line-numbers) |
| [List Item Callouts](https://obsidian.md/plugins?id=list-item-callouts) | Colour a single list item as a callout by starting it with a character such as `&`, `!` or `?`. | [list-item-callouts](https://github.com/perezamadorluisenrique-gif/list-item-callouts) |
| [Folder Counts](https://obsidian.md/plugins?id=folder-counts) | See how many notes or files each folder holds, right in the file explorer, with a vault total and folder exclusions. | [folder-counts](https://github.com/perezamadorluisenrique-gif/folder-counts) |
| [Note Reading Time](https://obsidian.md/plugins?id=note-reading-time) | Reading time of the current note or your selection in the status bar, optionally saved to a property. | [note-reading-time](https://github.com/perezamadorluisenrique-gif/note-reading-time) |
| [Task Rollover](https://obsidian.md/plugins?id=task-rollover) | Roll unfinished tasks from your last daily note into today's when it is created, with a real undo. | [task-rollover](https://github.com/perezamadorluisenrique-gif/task-rollover) |
| [Zoom Into Section](https://obsidian.md/plugins?id=zoom-into-section) | Zoom into a heading or list item to see only it and its contents, with a breadcrumb bar to climb back out. | [zoom-into-section](https://github.com/perezamadorluisenrique-gif/zoom-into-section) |
| [Link Title on Paste](https://obsidian.md/plugins?id=link-title-on-paste) | Paste a web address and get a Markdown link with the page's title, fetched in the background and undone in one step. | [link-title-on-paste](https://github.com/perezamadorluisenrique-gif/link-title-on-paste) |
| [Update Radar](https://obsidian.md/plugins?id=update-radar) | Checks your installed community plugins for updates in the background, shows what changed, and flags the ones that look abandoned. | [community-update-checker](https://github.com/perezamadorluisenrique-gif/community-update-checker) |
| [Dataview to Bases](https://obsidian.md/plugins?id=dataview-to-bases) | Convert Dataview queries into Bases blocks, and see which queries in your vault can be converted. | [dataview-to-bases](https://github.com/perezamadorluisenrique-gif/dataview-to-bases) |
| [Line Editing Commands](https://obsidian.md/plugins?id=line-editing-commands) | Duplicate, join, sort and reverse lines, insert blank lines and jump to a line number, with multi-cursor support. | [line-editing-commands](https://github.com/perezamadorluisenrique-gif/line-editing-commands) |
| [Note Mover Rules](https://obsidian.md/plugins?id=note-mover-rules) | Move notes into folders by ordered rules on tags, properties, titles and paths, with a preview before any bulk move. | [note-mover-rules](https://github.com/perezamadorluisenrique-gif/note-mover-rules) |
| [Tab History](https://obsidian.md/plugins?id=tab-history) | Keeps each tab's back and forward history across restarts, and adds commands to move, maximize and close tabs. | [tab-history](https://github.com/perezamadorluisenrique-gif/tab-history) |
| [URL Cards](https://obsidian.md/plugins?id=url-cards) | Shows web addresses as cards with title, description and image, and reads existing cardlink blocks. | [url-cards](https://github.com/perezamadorluisenrique-gif/url-cards) |
| [Vim Config](https://obsidian.md/plugins?id=vim-config) | Loads a vimrc-style file from your vault so your key mappings and editor commands are ready when vim mode starts. | [vim-config](https://github.com/perezamadorluisenrique-gif/vim-config) |
| [Task Archive](https://obsidian.md/plugins?id=task-archive) | Moves completed tasks, with their sub-items, into an archive section or note. | [task-archive](https://github.com/perezamadorluisenrique-gif/task-archive) |
| [Revisit Later](https://obsidian.md/plugins?id=revisit-later) | Link the current note into a future daily note, with a date typed in plain English, so it comes back when you want to review it. | [revisit-later](https://github.com/perezamadorluisenrique-gif/revisit-later) |
| [Explorer Colors Plus](https://obsidian.md/plugins?id=explorer-colors-plus) | Color files and folders in the file explorer, with a palette, cascading to children, and import from File Color. | [explorer-colors-plus](https://github.com/perezamadorluisenrique-gif/explorer-colors-plus) |
| [Book Lookup](https://obsidian.md/plugins?id=book-lookup) | Create book notes from Open Library or Google Books, with cover images, ISBN search and Book Search compatible templates. | [book-lookup](https://github.com/perezamadorluisenrique-gif/book-lookup) |
| [Web Search Menu](https://obsidian.md/plugins?id=web-search-menu) | Search the web for selected text or the note title from the right-click menu, with engines you define. | [web-search-menu](https://github.com/perezamadorluisenrique-gif/web-search-menu) |
| [Word Lookup](https://obsidian.md/plugins?id=word-lookup) | Look up any word in a sidebar dictionary with definitions, phonetics, synonyms and antonyms, or create a note for it. | [word-lookup](https://github.com/perezamadorluisenrique-gif/word-lookup) |
| [Dice Rolls](https://obsidian.md/plugins?id=dice-rolls) | Inline dice rolls you click to reroll, in Live Preview and Reading view, with full dice notation, a roll dialog and a roll history. Reads Dice Roller notes. | [dice-rolls](https://github.com/perezamadorluisenrique-gif/dice-rolls) |
| [Claude Studio](https://obsidian.md/plugins?id=claude-studio) | Notion-style AI writing, chat and vault tools powered by your local Claude Code CLI. | [claude-studio](https://github.com/perezamadorluisenrique-gif/claude-studio) |

All of them are in the community directory: Settings -> Community plugins ->
Browse, then search for the name.
