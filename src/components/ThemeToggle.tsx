'use client';

import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from './Icons';

type Theme = 'light' | 'dark';

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* プライベートモード等で localStorage が使えなくても切り替えは効かせる */
    }
    setTheme(next);
  };

  // ハイドレーション不一致を避けるため、確定するまでは中身を出さない
  const label = theme === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-[4px] border border-border bg-surface text-text-secondary transition-colors duration-150 hover:text-text-primary"
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
