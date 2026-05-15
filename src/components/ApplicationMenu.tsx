import { useRef, useState, type KeyboardEvent } from 'react';
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
  Help: ['Start guided tour', 'Command palette', 'Open keyboard shortcuts'],
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
  const menuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const menuItemRefs = useRef<Record<string, Array<HTMLButtonElement | null>>>({});

  function focusMenuButton(name: MenuName) {
    menuButtonRefs.current[name]?.focus();
  }

  function focusMenuItem(name: MenuName, index: number) {
    window.requestAnimationFrame(() => {
      menuItemRefs.current[name]?.[index]?.focus();
    });
  }

  function openAndFocusMenu(name: MenuName, index = 0) {
    setOpenMenu(name);
    focusMenuItem(name, index);
  }

  function menuAtOffset(name: MenuName, offset: -1 | 1) {
    const index = menuNames.indexOf(name);
    return menuNames[(index + offset + menuNames.length) % menuNames.length];
  }

  function handleMenuButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>, name: MenuName) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openAndFocusMenu(name);
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const nextMenu = menuAtOffset(name, event.key === 'ArrowRight' ? 1 : -1);
      if (openMenu) {
        openAndFocusMenu(nextMenu);
      } else {
        focusMenuButton(nextMenu);
      }
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusMenuButton(event.key === 'Home' ? menuNames[0] : menuNames[menuNames.length - 1]);
    }
  }

  function handleDropdownKeyDown(event: KeyboardEvent<HTMLDivElement>, name: MenuName) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpenMenu(null);
      focusMenuButton(name);
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      openAndFocusMenu(menuAtOffset(name, event.key === 'ArrowRight' ? 1 : -1));
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
      return;
    }
    const items = menuItemRefs.current[name]?.filter((item): item is HTMLButtonElement => item !== null) ?? [];
    if (items.length === 0) {
      return;
    }
    event.preventDefault();
    const currentIndex = Math.max(0, items.findIndex((item) => item === document.activeElement));
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (currentIndex + 1) % items.length
            : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex].focus();
  }

  return (
    <nav
      className="menu rs-app-menu"
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
              ref={(button) => {
                menuButtonRefs.current[name] = button;
              }}
              className="ghost-button"
              type="button"
              aria-haspopup="menu"
              aria-expanded={openMenu === name}
              aria-controls={menuId}
              onClick={() => setOpenMenu((current) => (current === name ? null : name))}
              onKeyDown={(event) => handleMenuButtonKeyDown(event, name)}
            >
              <MenuIcon className="button-icon" aria-hidden="true" />
              {name}
            </button>
            {openMenu === name ? (
              <div className="app-menu-dropdown" id={menuId} role="menu" aria-label={`${name} menu`} onKeyDown={(event) => handleDropdownKeyDown(event, name)}>
                {menuActions[name].map((action, actionIndex) => (
                  <button
                    ref={(button) => {
                      menuItemRefs.current[name] = menuItemRefs.current[name] ?? [];
                      menuItemRefs.current[name][actionIndex] = button;
                    }}
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
