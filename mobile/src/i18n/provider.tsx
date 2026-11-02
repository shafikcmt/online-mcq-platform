import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { setApiLanguage } from "@/api/client";

import i18n, { deviceLanguage, loadStoredLanguage, storeLanguage, type Language } from "./index";

type LanguageState = {
  /** False until the stored choice has been read. */
  ready: boolean;
  /** True once the student has picked a language on this phone (first-launch screen). */
  chosen: boolean;
  language: Language;
  /** Switches instantly (no restart), remembers it on this phone and sends it as
   * `Accept-Language` from now on. Syncing to the account is the caller's job. */
  setLanguage: (language: Language) => Promise<void>;
};

const LanguageContext = createContext<LanguageState | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [chosen, setChosen] = useState(false);
  const [language, setCurrent] = useState<Language>(() => deviceLanguage());

  const apply = useCallback(async (next: Language) => {
    setApiLanguage(next);
    await i18n.changeLanguage(next);
    setCurrent(next);
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = await loadStoredLanguage();
      if (!active) return;
      await apply(stored ?? deviceLanguage());
      setChosen(stored !== null);
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [apply]);

  const setLanguage = useCallback(
    async (next: Language) => {
      await apply(next);
      setChosen(true);
      await storeLanguage(next);
    },
    [apply],
  );

  const value = useMemo(() => ({ ready, chosen, language, setLanguage }), [ready, chosen, language, setLanguage]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageState {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used inside LanguageProvider");
  return value;
}
