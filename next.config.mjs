/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produce a self-contained server bundle for containerized deploys.
  output: "standalone",
  // Never expose Supabase keys to the browser: all keys are read server-side
  // only (no NEXT_PUBLIC_* Supabase vars anywhere in this app).
  experimental: {
    // Allow image uploads through server actions (board attachments).
    serverActions: { bodySizeLimit: "8mb" },
  },
};

export default nextConfig;
