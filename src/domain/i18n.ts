import type { Tab } from './navigation';

export type LocaleCode = 'en' | 'es' | 'zh' | 'ja';

export interface LocaleDefinition {
  code: LocaleCode;
  label: string;
  nativeLabel: string;
  htmlLang: string;
}

export interface StudioMessages {
  skipToEditor: string;
  browserEdition: string;
  desktopEdition: string;
  localFirstRubricIde: string;
  newFromTemplate: string;
  openFolder: string;
  recent: string;
  openRecentProject: string;
  commandShortcut: string;
  browserConstraints: string;
  tabsLabel: string;
  panelLabel: (tabLabel: string) => string;
  status: {
    issues: string;
    errors: string;
    warnings: string;
    readiness: string;
    git: string;
    syncLocal: string;
  };
  commandPalette: {
    searchLabel: string;
    placeholder: string;
    recent: string;
    noMatches: string;
  };
  settings: {
    displayEyebrow: string;
    themeHeading: string;
    visualModeLabel: string;
    interfaceLanguage: string;
    languageDescription: string;
    localeSummary: string;
  };
  tabs: Record<Tab, string>;
}

export const supportedLocales: LocaleDefinition[] = [
  { code: 'en', label: 'English', nativeLabel: 'English', htmlLang: 'en' },
  { code: 'es', label: 'Spanish', nativeLabel: 'Español', htmlLang: 'es' },
  { code: 'zh', label: 'Chinese', nativeLabel: '中文', htmlLang: 'zh-Hans' },
  { code: 'ja', label: 'Japanese', nativeLabel: '日本語', htmlLang: 'ja' },
];

export const defaultLocale: LocaleCode = 'en';

export const studioMessages: Record<LocaleCode, StudioMessages> = {
  en: {
    skipToEditor: 'Skip to editor',
    browserEdition: 'Browser edition',
    desktopEdition: 'Desktop edition',
    localFirstRubricIde: 'local-first rubric IDE',
    newFromTemplate: 'New from Template',
    openFolder: 'Open Folder',
    recent: 'Recent',
    openRecentProject: 'Open recent project',
    commandShortcut: 'Cmd/Ctrl-K',
    browserConstraints: 'Browser constraints',
    tabsLabel: 'Rubric Studio Open tabs',
    panelLabel: (tabLabel) => `${tabLabel.toLowerCase()} panel`,
    status: {
      issues: 'issues',
      errors: 'errors',
      warnings: 'warnings',
      readiness: 'readiness',
      git: 'Git',
      syncLocal: 'sync local',
    },
    commandPalette: {
      searchLabel: 'Command search',
      placeholder: 'Run a command...',
      recent: 'Recent',
      noMatches: 'No commands match this search.',
    },
    settings: {
      displayEyebrow: 'Display',
      themeHeading: 'Theme and contrast',
      visualModeLabel: 'Visual mode',
      interfaceLanguage: 'Interface language',
      languageDescription: 'Switch the browser and desktop shell labels without changing project data or export formats.',
      localeSummary: 'Locale changes are stored locally and never sent to AuraOne.',
    },
    tabs: {
      authoring: 'Authoring',
      preview: 'Preview',
      calibration: 'Calibration',
      diff: 'Diff',
      export: 'Export',
      settings: 'Settings',
    },
  },
  es: {
    skipToEditor: 'Saltar al editor',
    browserEdition: 'Edicion de navegador',
    desktopEdition: 'Edicion de escritorio',
    localFirstRubricIde: 'IDE de rubricas local primero',
    newFromTemplate: 'Nuevo desde plantilla',
    openFolder: 'Abrir carpeta',
    recent: 'Recientes',
    openRecentProject: 'Abrir proyecto reciente',
    commandShortcut: 'Cmd/Ctrl-K',
    browserConstraints: 'Restricciones del navegador',
    tabsLabel: 'Pestanas de Rubric Studio Open',
    panelLabel: (tabLabel) => `panel de ${tabLabel.toLowerCase()}`,
    status: {
      issues: 'incidencias',
      errors: 'errores',
      warnings: 'advertencias',
      readiness: 'preparacion',
      git: 'Git',
      syncLocal: 'sincronizacion local',
    },
    commandPalette: {
      searchLabel: 'Buscar comando',
      placeholder: 'Ejecutar un comando...',
      recent: 'Reciente',
      noMatches: 'Ningun comando coincide con esta busqueda.',
    },
    settings: {
      displayEyebrow: 'Pantalla',
      themeHeading: 'Tema y contraste',
      visualModeLabel: 'Modo visual',
      interfaceLanguage: 'Idioma de la interfaz',
      languageDescription: 'Cambia las etiquetas del shell de navegador y escritorio sin modificar los datos del proyecto ni los formatos de exportacion.',
      localeSummary: 'Los cambios de idioma se guardan localmente y nunca se envian a AuraOne.',
    },
    tabs: {
      authoring: 'Autoria',
      preview: 'Vista previa',
      calibration: 'Calibracion',
      diff: 'Diferencias',
      export: 'Exportar',
      settings: 'Ajustes',
    },
  },
  zh: {
    skipToEditor: '跳到编辑器',
    browserEdition: '浏览器版',
    desktopEdition: '桌面版',
    localFirstRubricIde: '本地优先的评分规程 IDE',
    newFromTemplate: '从模板新建',
    openFolder: '打开文件夹',
    recent: '最近',
    openRecentProject: '打开最近项目',
    commandShortcut: 'Cmd/Ctrl-K',
    browserConstraints: '浏览器限制',
    tabsLabel: 'Rubric Studio Open 标签',
    panelLabel: (tabLabel) => `${tabLabel}面板`,
    status: {
      issues: '问题',
      errors: '错误',
      warnings: '警告',
      readiness: '就绪度',
      git: 'Git',
      syncLocal: '本地同步',
    },
    commandPalette: {
      searchLabel: '命令搜索',
      placeholder: '运行命令...',
      recent: '最近',
      noMatches: '没有匹配的命令。',
    },
    settings: {
      displayEyebrow: '显示',
      themeHeading: '主题和对比度',
      visualModeLabel: '视觉模式',
      interfaceLanguage: '界面语言',
      languageDescription: '切换浏览器和桌面外壳标签，不会更改项目数据或导出格式。',
      localeSummary: '语言更改只保存在本地，绝不会发送到 AuraOne。',
    },
    tabs: {
      authoring: '编写',
      preview: '预览',
      calibration: '校准',
      diff: '差异',
      export: '导出',
      settings: '设置',
    },
  },
  ja: {
    skipToEditor: 'エディターへ移動',
    browserEdition: 'ブラウザー版',
    desktopEdition: 'デスクトップ版',
    localFirstRubricIde: 'ローカル優先のルーブリック IDE',
    newFromTemplate: 'テンプレートから新規作成',
    openFolder: 'フォルダーを開く',
    recent: '最近',
    openRecentProject: '最近のプロジェクトを開く',
    commandShortcut: 'Cmd/Ctrl-K',
    browserConstraints: 'ブラウザー制約',
    tabsLabel: 'Rubric Studio Open タブ',
    panelLabel: (tabLabel) => `${tabLabel}パネル`,
    status: {
      issues: '件の問題',
      errors: '件のエラー',
      warnings: '件の警告',
      readiness: '準備度',
      git: 'Git',
      syncLocal: 'ローカル同期',
    },
    commandPalette: {
      searchLabel: 'コマンド検索',
      placeholder: 'コマンドを実行...',
      recent: '最近',
      noMatches: '一致するコマンドはありません。',
    },
    settings: {
      displayEyebrow: '表示',
      themeHeading: 'テーマとコントラスト',
      visualModeLabel: '表示モード',
      interfaceLanguage: 'インターフェイス言語',
      languageDescription: 'プロジェクトデータやエクスポート形式を変えずに、ブラウザー版とデスクトップ版のシェル表示を切り替えます。',
      localeSummary: '言語設定はローカルにのみ保存され、AuraOne には送信されません。',
    },
    tabs: {
      authoring: '作成',
      preview: 'プレビュー',
      calibration: '較正',
      diff: '差分',
      export: 'エクスポート',
      settings: '設定',
    },
  },
};

export function normalizeLocale(value: unknown): LocaleCode {
  return supportedLocales.some((locale) => locale.code === value) ? value as LocaleCode : defaultLocale;
}

export function htmlLangForLocale(locale: LocaleCode): string {
  return supportedLocales.find((item) => item.code === locale)?.htmlLang ?? 'en';
}
