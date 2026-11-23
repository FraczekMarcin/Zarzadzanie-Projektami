import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface SettingsDirtyContextValue {
  reportTabDirty: (tabId: string, isDirty: boolean) => void;
  isAnyTabDirty: boolean;
}

const SettingsDirtyContext = createContext<SettingsDirtyContextValue>({
  reportTabDirty: () => {},
  isAnyTabDirty: false,
});

export const SettingsDirtyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [dirtyMap, setDirtyMap] = useState<Record<string, boolean>>({});

  const reportTabDirty = useCallback((tabId: string, isDirty: boolean) => {
    setDirtyMap((prev) => {
      if (Boolean(prev[tabId]) === isDirty) return prev;
      return { ...prev, [tabId]: isDirty };
    });
  }, []);

  const isAnyTabDirty = useMemo(
    () => Object.values(dirtyMap).some(Boolean),
    [dirtyMap]
  );

  const value = useMemo(
    () => ({ reportTabDirty, isAnyTabDirty }),
    [reportTabDirty, isAnyTabDirty]
  );

  return (
    <SettingsDirtyContext.Provider value={value}>
      {children}
    </SettingsDirtyContext.Provider>
  );
};

export function useSettingsTabDirty(): (tabId: string, isDirty: boolean) => void {
  return useContext(SettingsDirtyContext).reportTabDirty;
}

export function useSettingsAnyDirty(): boolean {
  return useContext(SettingsDirtyContext).isAnyTabDirty;
}
