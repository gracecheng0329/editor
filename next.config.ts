import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
   distDir:
      process.env.S2_LOCAL_FRONTEND === '1'
         ? '.next-s2-remote'
         : process.env.S1_ENABLED === '1'
           ? '.next-s1'
           : process.env.G0_ENABLED === '1'
             ? '.next-g0'
             : '.next',
   /* config options here */
   output: 'standalone',
   reactStrictMode: true,
   logging: process.env.S2_LOCAL_FRONTEND === '1' ? false : undefined,
   poweredByHeader: false,
   cacheComponents: true,
   partialPrefetching: true,
   turbopack: {
      rules: {
         '*.css': {
            loaders: ['@tailwindcss/turbopack'],
            as: '*.css',
         },
      },
   },
   experimental: {
      // reactCompiler: true,
      // turbopackFileSystemCache: true,
      optimizePackageImports: ['lucide-react'],
      inlineCss: true, // Inline critical CSS
      useLightningcss: true, // Faster CSS compilation (experimental)
   },
}

export default nextConfig
