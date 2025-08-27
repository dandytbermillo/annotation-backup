/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Don't bundle these Node.js modules for the browser
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        os: false,
        path: false,
        zlib: false,
        http: false,
        https: false,
        child_process: false,
        pg: false,
        'pg-native': false,
      }
    }
    return config
  },
}

module.exports = nextConfig