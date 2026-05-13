import { useState } from 'react';
import {
  BookOpen,
  Eye,
  FileText,
  HelpCircle,
  Play,
  SquarePen,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { shortcutForAction, type ShortcutRow } from '../domain/shortcuts';
import './ApplicationMenu.css';

type MenuName = 'File' | 'Edit' | 'View' | 'Rubric' | 'Run' | 'Tools' | 'Help';

const menuIcons: Record<MenuName, LucideIcon> = {
  File: FileText,
  Edit: SquarePen,
  View: Eye,
  Rubric: BookOpen,
  Run: Play,
  Tools: Wrench,
  Help: HelpCircle,
};

const menuActions: Record<MenuName, string[]> = {
  File: [
    'New project from template',
    'Quick open',
    'Save current project',
    'Export: AuraOne intake package',
  ],
  Edit: [
    'New criterion',
    'New theme',
    'Duplicate criterion',
    'Delete criterion',
    'Find in current criterion',
    'Find across project',
    'Toggle comments',
  ],
  View: [
    'Command palette',
    'Switch to Authoring',
    'Switch to Preview',
    'Switch to Calibration',
    'Switch to Diff',
    'Switch to Export',
    'Switch to Settings',
  ],
  Rubric: [
    'Open calibration',
    'Run bias probes',
    'Run contamination audit',
    'Open semantic diff',
    'Try criterion variant',
  ],
  Run: ['Run preview', 'Score current sample', 'Score all samples'],
  Tools: [
    'Git init',
    'Git commit',
    'Generate CI helper',
    'Open keyboard shortcuts',
    'Toggle browser constraints',
  ],
  Help: ['Command palette', 'Open keyboard shortcuts'],
};

export function ApplicationMenu({
  shortcuts,
  onExecute,
}: {
  shortcuts: ShortcutRow[];
  onExecute: (action: string) => void;
}) {
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);
  const menuNames = Object.keys(menuActions) as MenuName[];

  return (
    <nav
      className="menu app-menu"
      aria-label="Application menu"
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpenMenu(null);
      }}
    >
      {menuNames.map((name) => {
        const MenuIcon = menuIcons[name];
        const menuId = `menu-${name.toLowerCase()}`;
        return (
          <div className="app-menu-item" key={name}>
            <button
              className="ghost-button"
              type="button"
              aria-haspopup="menu"
              aria-expanded={openMenu === name}
              aria-controls={menuId}
              onClick={() => setOpenMenu((current) => (current === name ? null : name))}
            >
              <MenuIcon className="button-icon" aria-hidden="true" />
              {name}
            </button>
            {openMenu === name ? (
              <div className="app-menu-dropdown" id={menuId} role="menu" aria-label={`${name} menu`}>
                {menuActions[name].map((action) => (
                  <button
                    key={action}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenu(null);
                      onExecute(action);
                    }}
                  >
                    <span>{action}</span>
                    <kbd>{shortcutForAction(shortcuts, action)}</kbd>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

export function applicationMenuActionLabels(): string[] {
  return [...new Set(Object.values(menuActions).flat())];
}
