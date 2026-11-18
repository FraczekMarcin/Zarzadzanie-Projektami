import { useSyncExternalStore } from 'react';
import {
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
