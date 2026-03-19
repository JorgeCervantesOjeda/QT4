import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const resolveManualChunk = (id: string): string | undefined => {
  if( !id.includes( 'node_modules' ) ) {
    return undefined
  }
  if( id.includes( 'node_modules/react-big-calendar/' ) || id.includes( 'node_modules/date-fns/' ) ) {
    return 'vendor-calendar'
  }
  if( id.includes( 'node_modules/@tanstack/react-table/' ) ) {
    return 'vendor-table'
  }
  if( id.includes( 'node_modules/firebase/' ) || id.includes( 'node_modules/@firebase/' ) ) {
    return 'vendor-firebase'
  }
  if( id.includes( 'node_modules/react-router/' ) || id.includes( 'node_modules/react-router-dom/' ) ) {
    return 'vendor-router'
  }
  if(
    id.includes( 'node_modules/react/' ) ||
    id.includes( 'node_modules/react-dom/' ) ||
    id.includes( 'node_modules/scheduler/' )
  ) {
    return 'vendor-react'
  }
  return 'vendor-misc'
}

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
    build: {
      rollupOptions: {
        output: {
          manualChunks: resolveManualChunk,
        },
      },
    },
  }
} )
