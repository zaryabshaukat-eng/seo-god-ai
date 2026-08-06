import { createStore } from '../store.js';
import type { NotificationKind, Toast } from '../types.js';

export interface UiState {
  sidebarOpen: boolean;
  mobileNavOpen: boolean;
  route: string;
  toasts: Toast[];
}

export interface UiStore {
  getState(): UiState;
  isSidebarOpen(): boolean;
  isMobileNavOpen(): boolean;
  getRoute(): string;
  openSidebar(): void;
  closeSidebar(): void;
  toggleSidebar(): void;
  openMobileNav(): void;
  closeMobileNav(): void;
  navigate(route: string): void;
  pushToast(message: string, kind?: NotificationKind, autoDismissMs?: number): string;
  dismissToast(id: string): void;
  subscribe(listener: (state: UiState) => void): () => void;
}

const DEFAULT_TOAST_DISMISS_MS = 4_000;

/** Creates the global UI store: navigation chrome, active route and toasts. */
export function createUiStore(): UiStore {
  const store = createStore<UiState>({
    sidebarOpen: true,
    mobileNavOpen: false,
    route: '/',
    toasts: [],
  });

  let toastCounter = 0;

  return {
    getState: () => store.get(),
    isSidebarOpen: () => store.get().sidebarOpen,
    isMobileNavOpen: () => store.get().mobileNavOpen,
    getRoute: () => store.get().route,
    openSidebar() {
      store.set((state) => ({ ...state, sidebarOpen: true }));
    },
    closeSidebar() {
      store.set((state) => ({ ...state, sidebarOpen: false }));
    },
    toggleSidebar() {
      store.set((state) => ({ ...state, sidebarOpen: !state.sidebarOpen }));
    },
    openMobileNav() {
      store.set((state) => ({ ...state, mobileNavOpen: true }));
    },
    closeMobileNav() {
      store.set((state) => ({ ...state, mobileNavOpen: false }));
    },
    navigate(route: string) {
      store.set((state) => ({ ...state, route }));
    },
    pushToast(message: string, kind: NotificationKind = 'info', autoDismissMs = DEFAULT_TOAST_DISMISS_MS): string {
      const id = `toast-${++toastCounter}`;
      store.set((state) => ({ ...state, toasts: [...state.toasts, { id, message, kind, autoDismissMs }] }));
      if (autoDismissMs > 0) {
        setTimeout(() => {
          store.set((state) => ({ ...state, toasts: state.toasts.filter((toast) => toast.id !== id) }));
        }, autoDismissMs);
      }
      return id;
    },
    dismissToast(id: string) {
      store.set((state) => ({ ...state, toasts: state.toasts.filter((toast) => toast.id !== id) }));
    },
    subscribe: (listener) => store.subscribe(listener),
  };
}
