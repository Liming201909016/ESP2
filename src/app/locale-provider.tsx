"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Languages } from "lucide-react";
import { defaultLocale, localePreferenceCookie, resolveLocale, translate, type Locale, type TranslationKey } from "../lib/esp/locale";

const LocaleContext = createContext<{ locale: Locale; changeLocale: (locale: Locale) => void } | null>(null);
export function LocaleProvider({ initialLocale = defaultLocale, children }: { initialLocale?: Locale; children?: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(resolveLocale(initialLocale));
  function changeLocale(next: Locale) {
    const selected = resolveLocale(next);
    document.cookie = localePreferenceCookie(selected, location.protocol === "https:");
    document.documentElement.lang = selected;
    setLocale(selected);
  }
  return <LocaleContext.Provider value={{ locale, changeLocale }}>{children}</LocaleContext.Provider>;
}
export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("LocaleProvider is required");
  return { ...context, t: (key: TranslationKey) => translate(context.locale, key) };
}
export function LanguageSelector() {
  const { locale, changeLocale, t } = useLocale();
  return <label className="locale-selector" title={t("language")}><Languages size={16} aria-hidden="true" /><select aria-label={t("language")} value={locale} onChange={(event) => changeLocale(resolveLocale(event.target.value))}><option value="en-US" lang="en">English</option><option value="zh-CN" lang="zh-CN">中文</option></select></label>;
}