import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig( ( { mode } ) => {
  const env = loadEnv( mode, process.cwd(), '' )
  const filesApiProxyPathRaw = env.VITE_FILES_API_PROXY_PATH ?? '/files-api'
  const filesApiProxyPath = filesApiProxyPathRaw.startsWith( '/' )
    ? filesApiProxyPathRaw
    : `/${filesApiProxyPathRaw}`
  const filesApiBaseUrl = env.QT4_FILES_API_BASE_URL ?? 'http://localhost:42873/api/v1'

  return {
    plugins: [react()],
    server: {
      proxy: {
        [filesApiProxyPath]: {
          target: filesApiBaseUrl,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.startsWith( filesApiProxyPath )
            ? path.slice( filesApiProxyPath.length ) || '/'
            : path,
        },
      },
    },
  }
} )
