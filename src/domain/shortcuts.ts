export type ShortcutRow = [string, string];

export interface ShortcutLikeEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

interface ParsedShortcut {
  key: string;
  metaOrCtrl: boolean;
  shift: boolean;
  alt: boolean;
}

export function normalizeShortcut(shortcut: string): string {
  return shortcut
    .split('-')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'cmd/ctrl' || lower === 'cmd' || lower === 'command' || lower === 'ctrl' || lower === 'control') {
        return 'Cmd/Ctrl';
      }
      if (lower === 'option') {
        return 'Alt';
      }
      if (lower.length === 1) {
        return lower.toUpperCase();
      }
      return part[0].toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('-');
}

export function shortcutForAction(shortcuts: ShortcutRow[], action: string): string {
  return shortcuts.find(([, candidate]) => candidate === action)?.[0] ?? '';
}

export function actionForShortcut(event: ShortcutLikeEvent, shortcuts: ShortcutRow[]): string | null {
  const matches = shortcuts.filter(([shortcut]) => eventMatchesShortcut(event, shortcut));
  return matches.length === 1 ? matches[0][1] : null;
}

export function eventMatchesShortcut(event: ShortcutLikeEvent, shortcut: string): boolean {
  const parsed = parseShortcut(shortcut);
  if (!parsed) {
    return false;
  }
  const eventKey = normalizeKey(event.key);
  return (
    eventKey === parsed.key &&
    (event.metaKey || event.ctrlKey) === parsed.metaOrCtrl &&
    event.shiftKey === parsed.shift &&
    event.altKey === parsed.alt
  );
}

export function findShortcutConflicts(shortcuts: ShortcutRow[]): Array<{
  shortcut: string;
  actions: string[];
}> {
  const grouped = shortcuts.reduce<Record<string, string[]>>((byShortcut, [shortcut, action]) => {
    const normalized = normalizeShortcut(shortcut);
    if (!normalized) {
      return byShortcut;
    }
    byShortcut[normalized] = byShortcut[normalized] ?? [];
    byShortcut[normalized].push(action);
    return byShortcut;
  }, {});
  return Object.entries(grouped)
    .filter(([, actions]) => actions.length > 1)
    .map(([shortcut, actions]) => ({ shortcut, actions }));
}

function parseShortcut(shortcut: string): ParsedShortcut | null {
  const tokens = normalizeShortcut(shortcut).split('-').filter(Boolean);
  const keyToken = tokens[tokens.length - 1];
  if (!keyToken) {
    return null;
  }
  return {
    key: normalizeKey(keyToken),
    metaOrCtrl: tokens.includes('Cmd/Ctrl'),
    shift: tokens.includes('Shift'),
    alt: tokens.includes('Alt'),
  };
}

function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower === ' ') {
    return 'space';
  }
  if (lower === 'escape' || lower === 'esc') {
    return 'escape';
  }
  if (lower === 'return') {
    return 'enter';
  }
  return lower;
}
