import { useSyncExternalStore } from 'react';
import {
  getAppTimezone,
  getVariablesSnapshot,
  ServerVariablesState,
  subscribeVariables,
} from '../utils/variableSettings';

export function useVariables(): ServerVariablesState {
  return useSyncExternalStore(
    subscribeVariables,
    getVariablesSnapshot,
    getVariablesSnapshot
  );
}

export function useAppTimezone(): string {
  return useSyncExternalStore(
    subscribeVariables,
    getAppTimezone,
    getAppTimezone
  );
}

