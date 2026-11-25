import { useCallback, useRef, useState } from 'react';

export interface FormSubmitResult<T = unknown> {
  ok: boolean;
  status?: number;
  data?: T;
  error?: string;
  field?: string;
  itemType?: string;
  itemId?: string;
}

export async function parseApiErrorResponse(
  res: Response,
  fallbackMessage = 'Nie udało się zapisać zmian na serwerze.'
): Promise<{
  error: string;
  field?: string;
  itemType?: string;
  itemId?: string;
}> {
  let payload: any = null;
  try {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      payload = await res.json();
    } else {
      const text = await res.text();
      if (text && text.trim().startsWith('{')) {
        payload = JSON.parse(text);
      }
    }
  } catch {
    payload = null;
  }

  const rawError =
    typeof payload?.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : Array.isArray(payload?.errors) && payload.errors.length > 0
      ? String(payload.errors[0])
      : '';

  const field = typeof payload?.field === 'string' && payload.field.trim() ? payload.field.trim() : undefined;
  const itemType =
    typeof payload?.itemType === 'string' && payload.itemType.trim()
      ? payload.itemType.trim()
      : undefined;
  const itemId =
    typeof payload?.itemId === 'string' && payload.itemId.trim() ? payload.itemId.trim() : undefined;

  if (rawError) {
    return { error: rawError, field, itemType, itemId };
  }

  if (res.status === 401) {
    return { error: 'Sesja wygasła. Zaloguj się ponownie.', field, itemType, itemId };
  }
  if (res.status === 403) {
    return { error: 'Brak uprawnień do wykonania tej operacji.', field, itemType, itemId };
  }
  if (res.status === 404) {
    return { error: 'Nie znaleziono wskazanego zasobu na serwerze.', field, itemType, itemId };
  }
  if (res.status === 409) {
    return {
      error: 'Konflikt danych lub zasób jest już używany. Odśwież dane i spróbuj ponownie.',
      field,
      itemType,
      itemId,
    };
  }
  if (res.status === 413) {
    return { error: 'Przesłane dane przekraczają dopuszczalny rozmiar.', field, itemType, itemId };
  }
  if (res.status === 507) {
    return {
      error: 'Brak wolnego miejsca na dysku serwera. Zwolnij miejsce przed zapisem.',
      field,
      itemType,
      itemId,
    };
  }
  if (res.status >= 500) {
    return {
      error: 'Wystąpił błąd serwera podczas zapisu. Spróbuj ponownie za chwilę.',
      field,
      itemType,
      itemId,
    };
  }

  return { error: fallbackMessage, field, itemType, itemId };
}

export function normalizeSubmitError(
  err: unknown,
  fallbackMessage = 'Nie udało się zapisać zmian. Spróbuj ponownie.'
): { error: string; field?: string } {
  if (err && typeof err === 'object') {
    const anyErr = err as Record<string, any>;
    if (typeof anyErr.error === 'string' && anyErr.error.trim()) {
      return {
        error: anyErr.error.trim(),
        field: typeof anyErr.field === 'string' ? anyErr.field : undefined,
      };
    }
    if (anyErr instanceof Error) {
      const msg = anyErr.message?.trim() || '';
      if (
        anyErr.name === 'TypeError' &&
        (msg.includes('Failed to fetch') ||
          msg.includes('NetworkError') ||
          msg.includes('Load failed') ||
          msg.includes('fetch'))
      ) {
        return { error: 'Brak połączenia z serwerem. Sprawdź sieć i spróbuj ponownie.' };
      }
      if (msg) {
        const customField = (err as Record<string, unknown>).field;
        return {
          error: msg,
          field: typeof customField === 'string' ? customField : undefined,
        };
      }
    }
  } else if (typeof err === 'string' && err.trim()) {
    return { error: err.trim() };
  }

  return { error: fallbackMessage };
}

export interface UseFormSubmitOptions<TResult = unknown> {
  onSuccess?: (data: TResult | undefined) => void | Promise<void>;
}

export function useFormSubmit<TResult = unknown>(options?: UseFormSubmitOptions<TResult>) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const alertRef = useRef<HTMLDivElement | null>(null);

  const focusAlert = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.requestAnimationFrame(() => {
      alertRef.current?.focus();
    });
  }, []);

  const clearError = useCallback(() => {
    setSubmitError(null);
    setErrorField(null);
  }, []);

  const setValidationError = useCallback(
    (message: string, field?: string | null) => {
      setSubmitError(message);
      setErrorField(field ?? null);
      focusAlert();
    },
    [focusAlert]
  );

  const getFieldA11yProps = useCallback(
    (fieldName: string, errorAlertId?: string) => {
      if (!submitError || errorField !== fieldName) {
        return {};
      }
      return {
        'aria-invalid': true as const,
        ...(errorAlertId ? { 'aria-describedby': errorAlertId } : {}),
      };
    },
    [submitError, errorField]
  );

  const submit = useCallback(
    async (
      executor: () => Promise<FormSubmitResult<TResult> | boolean | void>,
      execOptions?: { fallbackError?: string }
    ): Promise<FormSubmitResult<TResult>> => {
      if (inFlightRef.current) {
        return { ok: false, error: 'Operacja zapisu jest już w toku.' };
      }

      inFlightRef.current = true;
      setIsSubmitting(true);
      setSubmitError(null);
      setErrorField(null);

      const fallbackError =
        execOptions?.fallbackError || 'Nie udało się zapisać zmian na serwerze.';

      try {
        const raw = await executor();

        if (raw === false) {
          setSubmitError(fallbackError);
          setErrorField(null);
          focusAlert();
          return { ok: false, error: fallbackError };
        }

        if (raw && typeof raw === 'object' && 'ok' in raw) {
          if (!raw.ok) {
            const msg = raw.error?.trim() || fallbackError;
            setSubmitError(msg);
            setErrorField(raw.field ?? null);
            focusAlert();
            return { ...raw, ok: false, error: msg };
          }
          if (options?.onSuccess) {
            await options.onSuccess(raw.data);
          }
          return raw;
        }

        if (options?.onSuccess) {
          await options.onSuccess(undefined);
        }
        return { ok: true };
      } catch (err) {
        const normalized = normalizeSubmitError(err, fallbackError);
        setSubmitError(normalized.error);
        setErrorField(normalized.field ?? null);
        focusAlert();
        return {
          ok: false,
          error: normalized.error,
          field: normalized.field,
        };
      } finally {
        inFlightRef.current = false;
        setIsSubmitting(false);
      }
    },
    [focusAlert, options]
  );

  return {
    isSubmitting,
    submitError,
    errorField,
    alertRef,
    inFlightRef,
    submit,
    clearError,
    setValidationError,
    getFieldA11yProps,
  };
}
