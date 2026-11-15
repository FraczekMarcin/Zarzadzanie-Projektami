import React, { useState, useEffect } from 'react';
import { User, Project, Task, ActivityLog, Comment } from '../types';
import { INITIAL_PROJECTS, INITIAL_TASKS, INITIAL_ACTIVITY } from '../data/initialData';
import { isDemoUser } from '../utils/demoData';

export interface NotificationToast {
  message: string;
  type: 'success' | 'info' | 'error';
}

interface UseAuthSessionParams {
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  setActivityLogs: React.Dispatch<React.SetStateAction<ActivityLog[]>>;
  setComments: React.Dispatch<React.SetStateAction<Comment[]>>;
  setNotificationToast: React.Dispatch<React.SetStateAction<NotificationToast | null>>;
  setIsUserModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  closeEventSourceRef: React.MutableRefObject<() => void>;
  logActivityRef: React.MutableRefObject<(action: string, taskId?: string, details?: string) => void>;
}

export function useAuthSession({
  setProjects,
  setTasks,
  setActivityLogs,
  setComments,
  setNotificationToast,
  setIsUserModalOpen,
  closeEventSourceRef,
  logActivityRef,
}: UseAuthSessionParams) {
  // Authentication session gate: requires login on first visit or after logout
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    try {
      return localStorage.getItem('oph_is_authenticated') === 'true';
    } catch {
      return false;
    }
  });

  // Setup required state (detected from server /api/auth/setup-status)
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);

  // Persistence state with users loaded strictly from server
  const [users, setUsers] = useState<User[]>([]);

  const [currentUser, setCurrentUser] = useState<User>({
    id: '',
    name: '',
    email: '',
    role: 'admin',
    department: '',
    initials: '',
  });

  // Weryfikacja statusu konfiguracji oraz aktywnej sesji HTTP bez wywoływania zbędnych błędów 401 w konsoli
  useEffect(() => {
    let isMounted = true;

    fetch('/api/auth/setup-status', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then(async (data) => {
        if (!isMounted || !data) return;
        if (typeof data.setupRequired === 'boolean') {
          setSetupRequired(data.setupRequired);
        }
        if (Array.isArray(data.users)) {
          setUsers(data.users);
        }

        if (data.authenticated === false) {
          setIsAuthenticated(false);
          try {
            localStorage.removeItem('oph_is_authenticated');
          } catch {}
          return;
        }

        try {
          const meRes = await fetch('/api/auth/me', { credentials: 'same-origin' });
          const meData = meRes.ok ? await meRes.json() : null;
          if (!isMounted) return;
          if (meData && meData.authenticated && meData.user) {
            setIsAuthenticated(true);
            setCurrentUser(meData.user);
            try {
              localStorage.setItem('oph_is_authenticated', 'true');
            } catch {}
          } else {
            setIsAuthenticated(false);
            try {
              localStorage.removeItem('oph_is_authenticated');
            } catch {}
          }
        } catch {
          if (!isMounted) return;
          setIsAuthenticated(false);
          try {
            localStorage.removeItem('oph_is_authenticated');
          } catch {}
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  // Helper to refresh public user profiles
  const refreshUsersList = async () => {
    try {
      const res = await fetch('/api/auth/setup-status', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.users)) {
          setUsers(data.users);
        }
      }
    } catch {}
  };

  // Login handler
  const handleLoginSuccess = (user: User) => {
    setCurrentUser(user);
    setIsAuthenticated(true);
    try {
      localStorage.setItem('oph_is_authenticated', 'true');
    } catch {}

    // Synchronize latest state immediately
    fetch('/api/state', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.state) {
          if (Array.isArray(data.state.projects)) setProjects(data.state.projects);
          if (Array.isArray(data.state.tasks)) setTasks(data.state.tasks);
          if (Array.isArray(data.state.users)) setUsers(data.state.users);
          if (Array.isArray(data.state.activityLogs)) setActivityLogs(data.state.activityLogs);
          if (Array.isArray(data.state.comments)) setComments(data.state.comments);
        }
      })
      .catch(() => {});

    logActivityRef.current(`${user.name} zalogował się do systemu`);
    setNotificationToast({
      message: `Zalogowano jako ${user.name}. Dobrej pracy w pracowni!`,
      type: 'success',
    });
  };

  // Logout handler - calls logActivity first, then server logout, cleans localStorage and React state
  const handleLogout = async () => {
    // 1. Najpierw wywołaj logActivity
    logActivityRef.current(`${currentUser?.name || 'Użytkownik'} wylogował się z systemu`);

    // 2. Zamknij strumień SSE przed wylogowaniem i wywołaj /api/auth/logout
    closeEventSourceRef.current();
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {}

    // 3. Po wylogowaniu usuń z localStorage wszystkie klucze zaczynające się od 'oph_' z wyjątkiem preferencji wyglądu (motyw: oph_theme_mode)
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('oph_') && k !== 'oph_theme_mode') {
          keysToRemove.push(k);
        }
      }
      for (const k of keysToRemove) {
        localStorage.removeItem(k);
      }
    } catch {}

    // 4. Wyczyść stan React (projects, tasks, comments, activityLogs, currentUser) do wartości początkowych
    setProjects(INITIAL_PROJECTS);
    setTasks(INITIAL_TASKS);
    setComments([]);
    setActivityLogs(INITIAL_ACTIVITY);
    setCurrentUser({
      id: '',
      name: '',
      email: '',
      role: 'admin',
      department: '',
      initials: '',
    });

    setIsAuthenticated(false);
    setIsUserModalOpen(false);
    setNotificationToast({
      message: 'Wylogowano z systemu. Ekran logowania jest aktywny.',
      type: 'info',
    });
  };

  const handleAddUser = async (newUserData: Omit<User, 'id' | 'initials'>) => {
    if (!newUserData.password || !newUserData.password.trim()) {
      setNotificationToast({
        message: 'Hasło jest wymagane do utworzenia konta użytkownika.',
        type: 'error',
      });
      return;
    }
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newUserData.name,
          email: newUserData.email,
          role: newUserData.role,
          department: newUserData.department,
          password: newUserData.password.trim(),
          twoFactorEnabled: newUserData.twoFactorEnabled,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        setNotificationToast({
          message: err.error || 'Nie udało się dodać użytkownika.',
          type: 'error',
        });
        return;
      }

      const data = await res.json();
      setUsers((prev) => [...prev, data.user]);
      logActivityRef.current(`Utworzono nowe konto użytkownika: ${data.user.name} (${data.user.role})`);
      setNotificationToast({
        message: `Użytkownik ${data.user.name} został pomyślnie dodany i zabezpieczony scrypt.`,
        type: 'success',
      });
    } catch {
      setNotificationToast({
        message: 'Błąd połączenia z serwerem podczas dodawania użytkownika.',
        type: 'error',
      });
    }
  };

  // Delete demo users
  const handleDeleteDemoUsers = () => {
    setUsers((prev) => {
      const nonDemo = prev.filter((u) => !isDemoUser(u));
      if (nonDemo.length === 0) {
        return prev;
      }
      if (isDemoUser(currentUser)) {
        setCurrentUser(nonDemo[0]);
      }
      return nonDemo;
    });
    logActivityRef.current('Usunięto konta demonstracyjne użytkowników');
    setNotificationToast({
      message: 'Konta demonstracyjne zostały usunięte z bazy.',
      type: 'success',
    });
  };

  // Delete specific user via server endpoint
  const handleDeleteUser = async (userId: string) => {
    if (currentUser && currentUser.id === userId) {
      setNotificationToast({
        message: 'Nie możesz usunąć aktualnie aktywnego użytkownika.',
        type: 'error',
      });
      return;
    }
    const user = users.find((u) => u.id === userId);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== userId));
        logActivityRef.current(`Usunięto użytkownika ${user?.name || userId}`);
        setNotificationToast({
          message: `Użytkownik ${user?.name || userId} został usunięty.`,
          type: 'info',
        });
      } else {
        const err = await res.json();
        setNotificationToast({
          message: err.error || 'Błąd usuwania użytkownika.',
          type: 'error',
        });
      }
    } catch {
      setNotificationToast({
        message: 'Błąd połączenia z serwerem.',
        type: 'error',
      });
    }
  };

  // Update user password via server scrypt endpoint
  const handleUpdateUserPassword = async (userId: string, newPass: string, currentPass?: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/users/${userId}/password`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: newPass, currentPassword: currentPass }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Błąd podczas zmiany hasła');
      }
      logActivityRef.current('Zaktualizowano hasło dostępu użytkownika (zabezpieczone scrypt)');
      setNotificationToast({
        message: 'Hasło użytkownika zostało pomyślnie zaktualizowane na serwerze (scrypt).',
        type: 'success',
      });
      return true;
    } catch (e: any) {
      setNotificationToast({
        message: e.message || 'Nie udało się zmienić hasła.',
        type: 'error',
      });
      return false;
    }
  };

  // Registration handler via server endpoint
  const handleRegisterUser = async (newUserData: Omit<User, 'id' | 'initials'>) => {
    if (!newUserData.password || !newUserData.password.trim()) {
      setNotificationToast({
        message: 'Hasło jest wymagane do rejestracji konta.',
        type: 'error',
      });
      return;
    }
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newUserData.name,
          email: newUserData.email,
          role: newUserData.role,
          department: newUserData.department,
          password: newUserData.password.trim(),
          twoFactorEnabled: newUserData.twoFactorEnabled,
        }),
      });

      if (res.ok) {
        await refreshUsersList();
        logActivityRef.current(`Nowa rejestracja konta: ${newUserData.name} (${newUserData.email}) - oczekuje na zatwierdzenie przez Administratora`);
        setNotificationToast({
          message: `Wniosek rejestracji użytkownika ${newUserData.name} został zarejestrowany. Administrator musi zatwierdzić konto przed pierwszym logowaniem.`,
          type: 'info',
        });
      }
    } catch {}
  };

  // Administrator approval handlers via dedicated endpoints
  const handleApproveUser = async (userId: string) => {
    const user = users.find((u) => u.id === userId);
    try {
      const res = await fetch(`/api/users/${userId}/approve`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (res.ok) {
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, isApproved: true } : u)));
        logActivityRef.current(`Administrator zatwierdził konto użytkownika: ${user?.name || userId}`);
        setNotificationToast({
          message: `Konto ${user?.name || userId} zostało pomyślnie zatwierdzone. Użytkownik ma teraz dostęp do systemu.`,
          type: 'success',
        });
      } else {
        const err = await res.json();
        setNotificationToast({
          message: err.error || 'Błąd zatwierdzania konta.',
          type: 'error',
        });
      }
    } catch {}
  };

  const handleRejectUser = async (userId: string) => {
    const user = users.find((u) => u.id === userId);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== userId));
        logActivityRef.current(`Administrator odrzucił wniosek rejestracji użytkownika: ${user?.name || userId}`);
        setNotificationToast({
          message: `Wniosek rejestracyjny ${user?.name || userId} został odrzucony i usunięty.`,
          type: 'info',
        });
      }
    } catch {}
  };

  return {
    isAuthenticated,
    setIsAuthenticated,
    setupRequired,
    users,
    setUsers,
    currentUser,
    setCurrentUser,
    refreshUsersList,
    handleLoginSuccess,
    handleLogout,
    handleRegisterUser,
    handleApproveUser,
    handleRejectUser,
    handleAddUser,
    handleDeleteUser,
    handleDeleteDemoUsers,
    handleUpdateUserPassword,
  };
}
