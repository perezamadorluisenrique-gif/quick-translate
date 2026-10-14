import { FuzzySuggestModal, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, SecretComponent, Setting, TFile, moment, normalizePath, requestUrl } from 'obsidian';
import type { App, Editor, EditorPosition, SettingDefinitionItem } from 'obsidian';

import { DEFAULT_TARGET, LANGUAGES, SOURCE_LANGUAGES, languageName, matchLocale } from './src/languages.ts';
import { PROVIDERS, TranslateError } from './src/providers.ts';
import type { Http, ProviderId } from './src/providers.ts';
import { Translator, translateDocument } from './src/translator.ts';
import type { ProviderSettings, TranslatedDocument } from './src/translator.ts';

/** The part of moment this plugin uses, typed here: the directory's review has no types for `moment`. */
const appLocale = (): string => (moment as unknown as { locale(): string }).locale();

type SelectionAction = 'popup' | 'replace' | 'below';

const SELECTION_ACTIONS: Record<SelectionAction, string> = {
  popup: 'Show it in a window',
  replace: 'Replace the selection',
  below: 'Insert it below',
};

interface QuickTranslateSettings {
  provider: ProviderId;
  target: string;
  source: string;
  fallback: boolean;
  /** Name of the DeepL key in Obsidian's secret storage. */
  deeplSecret: string;
  email: string;
  selectionAction: SelectionAction;
  folder: string;
  openTranslatedNote: boolean;
}

const DEFAULT_SETTINGS: QuickTranslateSettings = {
  provider: 'google',
  target: DEFAULT_TARGET,
  source: 'auto',
  fallback: true,
  deeplSecret: '',
  email: '',
  selectionAction: 'popup',
  folder: '',
  openTranslatedNote: true,
};

/** Names and descriptions shared by the declarative settings tab and the older `display()`. */
const TEXT = {
  provider: {
    name: 'Translation service',
    desc: 'Google Translate needs no account but uses an unofficial web address that Google can change. DeepL needs your own key. MyMemory needs nothing and allows a limited amount of text a day. Your text is sent to the service you pick.',
  },
  target: { name: 'Translate into', desc: 'The language the translation comes out in. Each command also has a version that asks.' },
  source: { name: 'Translate from', desc: 'Leave on detect unless the service guesses the wrong language.' },
  fallback: {
    name: 'Retry with MyMemory',
    desc: 'When the service you picked is down or refuses a request, send that text to MyMemory instead. Turn off to send text only to the service you picked. A wrong DeepL key is never retried elsewhere.',
  },
  deeplSecret: { name: 'DeepL key', desc: 'Stored in Obsidian’s secret storage, not in this plugin’s settings file. Free keys end in :fx.' },
  email: { name: 'MyMemory email', desc: 'Optional. MyMemory allows more text a day when it knows an address. It is sent with each request.' },
  selectionAction: { name: 'Translate selection', desc: 'What the command does with the translation. The window lets you copy it or choose another language first.' },
  folder: { name: 'Translated notes folder', desc: 'New notes are created here. Empty puts each one beside its original.' },
  openTranslatedNote: { name: 'Open the translated note', desc: 'Open a note in a new tab when it is made.' },
} as const;

/** The text a command works on, and the exact range it sits in. */
interface Selection {
  from: EditorPosition;
  to: EditorPosition;
  /** The range as written, which an edit must find unchanged. */
  raw: string;
}

export default class QuickTranslatePlugin extends Plugin {
  settings: QuickTranslateSettings = { ...DEFAULT_SETTINGS };

  /**
   * Every request goes through here. A property, so the end-to-end tests can replace it and run without a network.
   */
  http: Http = async ({ url, method, headers, body }) => {
    const { 'Content-Type': contentType, ...rest } = headers ?? {};
    const res = await requestUrl({ url, method, headers: rest, body, contentType, throw: false });
    let json: unknown = null;
    try {
      json = res.json;
    } catch {
      // Not JSON (an HTML error page): the status says enough.
    }
    return { status: res.status, json };
  };

  translator = new Translator(
    (request) => this.http(request),
    (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
  );

  /** Notes being translated, so a second command on the same note waits. */
  private busy = new Set<string>();

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new QuickTranslateSettingTab(this.app, this));

    this.addCommand({
      id: 'translate-selection',
      name: 'Translate selection',
      icon: 'languages',
      editorCallback: (editor) => void this.translateSelection(editor, this.settings.target),
    });
    this.addCommand({
      id: 'translate-selection-to',
      name: 'Translate selection into…',
      icon: 'languages',
      editorCallback: (editor) => this.pickLanguage((code) => void this.translateSelection(editor, code)),
    });
    this.addCommand({
      id: 'translate-selection-replace',
      name: 'Translate selection and replace it',
      icon: 'replace',
      editorCallback: (editor) => void this.translateSelection(editor, this.settings.target, 'replace'),
    });
    this.addCommand({
      id: 'translate-selection-below',
      name: 'Translate selection and insert it below',
      icon: 'arrow-down-to-line',
      editorCallback: (editor) => void this.translateSelection(editor, this.settings.target, 'below'),
    });
    this.addCommand({
      id: 'translate-note',
      name: 'Translate note into a new note',
      icon: 'file-output',
      checkCallback: (checking) => this.noteCommand(checking, this.settings.target),
    });
    this.addCommand({
      id: 'translate-note-to',
      name: 'Translate note into a new note in…',
      icon: 'file-output',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) this.pickLanguage((code) => void this.translateNote(file, code));
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        if (!editor.getSelection().trim()) return;
        const target = languageName(this.settings.target);
        menu.addItem((item) =>
          item
            .setTitle(`Translate selection into ${target}`)
            .setIcon('languages')
            .setSection('selection')
            .onClick(() => void this.translateSelection(editor, this.settings.target)),
        );
        menu.addItem((item) =>
          item
            .setTitle('Translate selection into…')
            .setIcon('languages')
            .setSection('selection')
            .onClick(() => this.pickLanguage((code) => void this.translateSelection(editor, code))),
        );
      }),
    );
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== 'md') return;
        menu.addItem((item) =>
          item
            .setTitle(`Translate note into ${languageName(this.settings.target)}`)
            .setIcon('file-output')
            .setSection('action')
            .onClick(() => void this.translateNote(file, this.settings.target)),
        );
      }),
    );
  }

  async loadSettings() {
    const data = (await this.loadData()) as Partial<QuickTranslateSettings> | null;
    // The first run translates into the language Obsidian is shown in.
    const own = matchLocale(appLocale());
    this.settings = { ...DEFAULT_SETTINGS, ...(own ? { target: own } : {}), ...(data ?? {}) };
    if (!(this.settings.provider in PROVIDERS)) this.settings.provider = DEFAULT_SETTINGS.provider;
    if (!(this.settings.target in LANGUAGES)) this.settings.target = DEFAULT_TARGET;
    if (!(this.settings.source in SOURCE_LANGUAGES)) this.settings.source = 'auto';
    if (!(this.settings.selectionAction in SELECTION_ACTIONS)) this.settings.selectionAction = 'popup';
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  providerSettings(): ProviderSettings {
    const { provider, fallback, email, deeplSecret } = this.settings;
    const deeplKey = deeplSecret ? this.app.secretStorage.getSecret(deeplSecret) ?? '' : '';
    return { provider, fallback, email, deeplKey };
  }

  private pickLanguage(onChoose: (code: string) => void) {
    new LanguageModal(this.app, this.settings.target, onChoose).open();
  }

  /** Tells the person what went wrong, in the words of the error when it is one of ours. */
  private fail(error: unknown) {
    if (error instanceof TranslateError) new Notice(error.message);
    else {
      console.error('Quick Translate:', error);
      new Notice('The translation failed.');
    }
  }

  private noteFallback(result: { fellBack?: string }) {
    if (result.fellBack) new Notice(`${result.fellBack} Used MyMemory for this one.`);
  }

  // --- Selections -----------------------------------------------------------------------------------------------

  /** Translates `text` into `target`, as the commands and the window both need. */
  translate(text: string, target: string, progress?: (done: number, total: number) => void): Promise<TranslatedDocument> {
    return translateDocument(this.translator, text, { source: this.settings.source, target }, this.providerSettings(), progress);
  }

  async translateSelection(editor: Editor, target: string, action: SelectionAction = this.settings.selectionAction): Promise<void> {
    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    const raw = editor.getRange(from, to);
    if (!raw.trim()) {
      new Notice('Select the text to translate first.');
      return;
    }
    const selection: Selection = { from, to, raw };
    if (action === 'popup') {
      new TranslationModal(this.app, this, selection, editor, target).open();
      return;
    }
    const wait = new Notice('Translating…', 0);
    try {
      const result = await this.translate(raw, target);
      if (!result.sent) {
        new Notice('There is no text to translate in the selection.');
        return;
      }
      this.noteFallback(result);
      this.apply(editor, selection, result.text, action);
    } catch (error) {
      this.fail(error);
    } finally {
      wait.hide();
    }
  }

  /** Puts a translation into the note, in one transaction, only if the selected text is still there. */
  apply(editor: Editor, selection: Selection, text: string, action: 'replace' | 'below'): boolean {
    if (editor.getRange(selection.from, selection.to) !== selection.raw) {
      new Notice('The text changed while it was being translated. Select it again.');
      return false;
    }
    if (action === 'replace') {
      editor.transaction({ changes: [{ from: selection.from, to: selection.to, text }] });
    } else {
      const end = { line: selection.to.line, ch: editor.getLine(selection.to.line).length };
      editor.transaction({ changes: [{ from: end, to: end, text: `\n\n${text.replace(/\s+$/, '')}` }] });
    }
    return true;
  }

  // --- Notes ------------------------------------------------------------------------------------------------------

  private noteCommand(checking: boolean, target: string): boolean {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') return false;
    if (!checking) void this.translateNote(file, target);
    return true;
  }

  /** The note as the person sees it: unsaved edits of an open note included. */
  private async readNote(file: TFile): Promise<string> {
    const leaf = this.app.workspace.getLeavesOfType('markdown').find((l) => l.view instanceof MarkdownView && l.view.file === file);
    if (leaf && leaf.view instanceof MarkdownView) return leaf.view.editor.getValue();
    return this.app.vault.read(file);
  }

  /** Writes the translation of a note beside it (or in the folder of the settings) and opens it. */
  async translateNote(file: TFile, target: string): Promise<TFile | null> {
    if (this.busy.has(file.path)) {
      new Notice(`“${file.basename}” is already being translated.`);
      return null;
    }
    this.busy.add(file.path);
    const wait = new Notice(`Translating “${file.basename}”…`, 0);
    try {
      const source = await this.readNote(file);
      const result = await this.translate(source, target, (done, total) => wait.setMessage(`Translating “${file.basename}”… ${done} of ${total}`));
      if (!result.sent) {
        new Notice('There is no text to translate in this note.');
        return null;
      }
      if (result.detected === target) {
        new Notice(`This note already seems to be in ${languageName(target)}. Choose another language with “Translate note into a new note in…”.`);
        return null;
      }
      this.noteFallback(result);
      const created = await this.createTranslation(file, target, result.text);
      new Notice(`Translated into ${languageName(target)}: “${created.basename}”.`);
      if (this.settings.openTranslatedNote) await this.app.workspace.getLeaf('tab').openFile(created);
      return created;
    } catch (error) {
      this.fail(error);
      return null;
    } finally {
      wait.hide();
      this.busy.delete(file.path);
    }
  }

  private async createTranslation(file: TFile, target: string, text: string): Promise<TFile> {
    const folder = this.settings.folder.trim() ? normalizePath(this.settings.folder.trim()) : file.parent?.path ?? '';
    const base = folder && folder !== '/' ? `${folder}/` : '';
    if (base && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    let path = normalizePath(`${base}${file.basename} (${target}).md`);
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${base}${file.basename} (${target} ${n}).md`);
    return this.app.vault.create(path, text);
  }
}

/** Pick a language with the keyboard; typing filters the list. */
class LanguageModal extends FuzzySuggestModal<string> {
  private readonly onPick: (code: string) => void;

  constructor(app: App, current: string, onPick: (code: string) => void) {
    super(app);
    this.onPick = onPick;
    this.setPlaceholder(`Translate into… (now ${languageName(current)})`);
  }

  getItems(): string[] {
    return Object.keys(LANGUAGES);
  }

  getItemText(code: string): string {
    return LANGUAGES[code];
  }

  onChooseItem(code: string) {
    this.onPick(code);
  }
}

/** The translation of a selection in a window, with the language to change, and copy, replace and insert below. */
class TranslationModal extends Modal {
  private readonly plugin: QuickTranslatePlugin;
  private readonly range: Selection;
  private readonly source: Editor;
  private language: string;
  private token = 0;
  private result = '';
  private statusEl: HTMLElement | null = null;
  private outEl: HTMLElement | null = null;
  private buttons: HTMLButtonElement[] = [];

  constructor(app: App, plugin: QuickTranslatePlugin, range: Selection, editor: Editor, language: string) {
    super(app);
    this.plugin = plugin;
    this.range = range;
    this.source = editor;
    this.language = language;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('quick-translate-modal');
    this.setTitle('Translation');

    const bar = contentEl.createDiv({ cls: 'quick-translate-bar' });
    this.statusEl = bar.createDiv({ cls: 'quick-translate-status' });
    const select = bar.createEl('select', { cls: 'dropdown', attr: { 'aria-label': 'Translate into' } });
    for (const [code, name] of Object.entries(LANGUAGES)) select.createEl('option', { value: code, text: name });
    select.value = this.language;
    select.addEventListener('change', () => {
      this.language = select.value;
      void this.run();
    });

    this.outEl = contentEl.createDiv({ cls: 'quick-translate-text' });
    contentEl.createDiv({ cls: 'quick-translate-original', text: this.range.raw.trim().slice(0, 400) });

    const row = contentEl.createDiv({ cls: 'modal-button-container' });
    this.buttons = [
      this.button(row, 'Copy', false, () => {
        navigator.clipboard.writeText(this.result).then(
          () => new Notice('Copied.'),
          () => new Notice('Could not copy. Select the text and copy it.'),
        );
      }),
      this.button(row, 'Insert below', false, () => {
        if (this.plugin.apply(this.source, this.range, this.result, 'below')) this.close();
      }),
      this.button(row, 'Replace selection', true, () => {
        if (this.plugin.apply(this.source, this.range, this.result, 'replace')) this.close();
      }),
    ];
    void this.run();
  }

  onClose() {
    this.token++;
    this.contentEl.empty();
  }

  private button(parent: HTMLElement, text: string, cta: boolean, onClick: () => void): HTMLButtonElement {
    const button = parent.createEl('button', { text, cls: cta ? 'mod-cta' : '' });
    button.addEventListener('click', onClick);
    return button;
  }

  private show(status: string, text: string, ready: boolean) {
    this.statusEl?.setText(status);
    this.outEl?.setText(text);
    this.buttons.forEach((b) => (b.disabled = !ready));
  }

  private async run(): Promise<void> {
    const ticket = ++this.token;
    this.result = '';
    this.show(`Translating into ${languageName(this.language)}…`, '', false);
    try {
      const got = await this.plugin.translate(this.range.raw, this.language);
      if (ticket !== this.token) return;
      if (!got.sent) {
        this.show('', 'There is no text to translate in the selection.', false);
        return;
      }
      this.result = got.text;
      const from = got.detected ? `From ${languageName(got.detected)} · ` : '';
      const via = got.fellBack ? ' (MyMemory, the first service failed)' : '';
      this.show(`${from}${PROVIDERS[got.provider].split(' (')[0]}${via}`, got.text, true);
    } catch (error) {
      if (ticket !== this.token) return;
      if (!(error instanceof TranslateError)) console.error('Quick Translate:', error);
      this.show('', error instanceof TranslateError ? error.message : 'The translation failed.', false);
    }
  }
}

type Key = keyof QuickTranslateSettings;

class QuickTranslateSettingTab extends PluginSettingTab {
  private readonly plugin: QuickTranslatePlugin;

  constructor(app: App, plugin: QuickTranslatePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * The settings of Obsidian 1.13 and later: it renders this itself and indexes it for the settings
   * search. Older versions ignore it and call `display()`.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: 'group',
        heading: 'Translation',
        items: [
          { ...TEXT.provider, control: { type: 'dropdown', key: 'provider', options: PROVIDERS, defaultValue: DEFAULT_SETTINGS.provider } },
          { ...TEXT.target, control: { type: 'dropdown', key: 'target', options: LANGUAGES, defaultValue: DEFAULT_SETTINGS.target } },
          { ...TEXT.source, control: { type: 'dropdown', key: 'source', options: SOURCE_LANGUAGES, defaultValue: 'auto' } },
          { ...TEXT.fallback, control: { type: 'toggle', key: 'fallback', defaultValue: true } },
        ],
      },
      {
        type: 'group',
        heading: 'Accounts',
        items: [
          { ...TEXT.deeplSecret, control: { type: 'secret', key: 'deeplSecret' } },
          { ...TEXT.email, control: { type: 'text', key: 'email', placeholder: 'you@example.com' } },
        ],
      },
      {
        type: 'group',
        heading: 'Results',
        items: [
          { ...TEXT.selectionAction, control: { type: 'dropdown', key: 'selectionAction', options: SELECTION_ACTIONS, defaultValue: 'popup' } },
          { ...TEXT.folder, control: { type: 'folder', key: 'folder', placeholder: 'Translations' } },
          { ...TEXT.openTranslatedNote, control: { type: 'toggle', key: 'openTranslatedNote', defaultValue: true } },
        ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    Object.assign(this.plugin.settings, { [key]: value });
    await this.plugin.saveSettings();
  }

  /** The pre-1.13 rendering, from the same text. Obsidian skips it once `getSettingDefinitions()` returns anything. */
  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();
    new Setting(containerEl).setName('Translation').setHeading();
    this.dropdown('provider', TEXT.provider, PROVIDERS);
    this.dropdown('target', TEXT.target, LANGUAGES);
    this.dropdown('source', TEXT.source, SOURCE_LANGUAGES);
    this.toggle('fallback', TEXT.fallback);
    new Setting(containerEl).setName('Accounts').setHeading();
    new Setting(containerEl)
      .setName(TEXT.deeplSecret.name)
      .setDesc(TEXT.deeplSecret.desc)
      .addComponent((el) => new SecretComponent(this.app, el).setValue(s.deeplSecret).onChange((v) => this.setControlValue('deeplSecret', v ?? '')));
    this.text('email', TEXT.email);
    new Setting(containerEl).setName('Results').setHeading();
    this.dropdown('selectionAction', TEXT.selectionAction, SELECTION_ACTIONS);
    this.text('folder', TEXT.folder);
    this.toggle('openTranslatedNote', TEXT.openTranslatedNote);
  }

  private dropdown(key: Key, text: { name: string; desc: string }, options: Record<string, string>) {
    new Setting(this.containerEl)
      .setName(text.name)
      .setDesc(text.desc)
      .addDropdown((d) => d.addOptions(options).setValue(String(this.plugin.settings[key])).onChange((v) => this.setControlValue(key, v)));
  }

  private text(key: Key, text: { name: string; desc: string }) {
    new Setting(this.containerEl)
      .setName(text.name)
      .setDesc(text.desc)
      .addText((t) => t.setValue(String(this.plugin.settings[key])).onChange((v) => this.setControlValue(key, v)));
  }

  private toggle(key: Key, text: { name: string; desc: string }) {
    new Setting(this.containerEl)
      .setName(text.name)
      .setDesc(text.desc)
      .addToggle((t) => t.setValue(Boolean(this.plugin.settings[key])).onChange((v) => this.setControlValue(key, v)));
  }
}
