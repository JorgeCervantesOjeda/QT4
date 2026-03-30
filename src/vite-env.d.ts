/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID: string;
  readonly VITE_FIREBASE_MONITOR_FUNCTION_URL?: string;
  readonly VITE_GIPHY_API_KEY?: string;
  readonly VITE_APP_BUILD?: string;
  readonly VITE_FILES_API_MODE?: 'proxy' | 'direct';
  readonly VITE_FILES_API_PROXY_PATH?: string;
  readonly VITE_FILES_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
