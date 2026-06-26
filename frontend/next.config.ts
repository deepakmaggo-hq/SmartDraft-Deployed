import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ["172.22.0.1", "localhost","192.168.20.184","smart-draft-deployed.vercel.app"],
};

export default nextConfig;
