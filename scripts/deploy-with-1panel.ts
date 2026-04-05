#!/usr/bin/env bun
/**
 * Deploy script using 1Panel API
 * Requires: ONEPANEL_BASE_URL, ONEPANEL_API_KEY in environment
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

// Load .env file
const envPath = join(import.meta.dir, "..", ".env");
try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // ignore missing .env
}

const BASE_URL = process.env.ONEPANEL_BASE_URL?.replace(/\/$/, "") || "http://localhost:8090";
const API_KEY = process.env.ONEPANEL_API_KEY || "";

if (!API_KEY) {
  console.error("Error: ONEPANEL_API_KEY not set");
  process.exit(1);
}

// Generate auth headers
function getAuthHeaders(): Record<string, string> {
  return {
    "Authorization": `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
}

// API client
async function apiCall(path: string, options: RequestInit = {}): Promise<any> {
  const url = `${BASE_URL}/api/v1${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API call failed: ${response.status} ${text}`);
  }
  return response.json();
}

// Check if website exists
async function getWebsite(domain: string): Promise<any | null> {
  try {
    const result = await apiCall(`/websites/search?page=1&pageSize=100`);
    const websites = result?.data?.items || [];
    return websites.find((w: any) => w.primaryDomain === domain) || null;
  } catch {
    return null;
  }
}

// Create website with reverse proxy
async function createWebsite(params: {
  domain: string;
  port: number;
  appName: string;
}): Promise<void> {
  const { domain, port, appName } = params;

  // Check if already exists
  const existing = await getWebsite(domain);
  if (existing) {
    console.log(`Website ${domain} already exists, updating...`);
    // Update proxy config
    await updateProxyConfig(existing.id, port);
    return;
  }

  console.log(`Creating website ${domain}...`);
  
  // Get default group ID
  const groups = await apiCall("/groups?type=website");
  const defaultGroup = groups?.data?.find((g: any) => g.isDefault)?.id || 1;

  // Create website
  const createData = {
    primaryDomain: domain,
    otherDomains: "",
    remark: appName,
    groupId: defaultGroup,
    type: "proxy",
    proxy: `http://127.0.0.1:${port}`,
    proxyType: "tcp",
    source: "local",
    protocol: "http",
  };

  const result = await apiCall("/websites", {
    method: "POST",
    body: JSON.stringify(createData),
  });

  console.log(`Website created: ${result?.data?.id}`);
}

// Update proxy configuration
async function updateProxyConfig(websiteId: number, port: number): Promise<void> {
  console.log(`Updating proxy config for website ${websiteId}...`);
  
  await apiCall(`/websites/${websiteId}/proxy`, {
    method: "POST",
    body: JSON.stringify({
      proxy: `http://127.0.0.1:${port}`,
      proxyType: "tcp",
      modifyPath: false,
      proxyPath: "/",
      content: "",
    }),
  });

  console.log("Proxy config updated");
}

// Apply HTTPS certificate
async function applyHttps(domain: string): Promise<void> {
  const website = await getWebsite(domain);
  if (!website) {
    console.error(`Website ${domain} not found`);
    return;
  }

  console.log(`Applying HTTPS for ${domain}...`);

  // Get SSL certificate
  const certs = await apiCall("/websites/ssl/search?page=1&pageSize=100");
  const cert = certs?.data?.items?.find((c: any) => 
    c.domains?.includes(domain) || c.primaryDomain === domain
  );

  if (!cert) {
    console.log(`No SSL cert found for ${domain}, applying for new certificate...`);
    // Apply for Let's Encrypt certificate
    await apiCall("/websites/ssl/obtain", {
      method: "POST",
      body: JSON.stringify({
        websiteId: website.id,
        primaryDomain: domain,
        otherDomains: "",
        provider: "letsencrypt",
        acmeAccountId: 0,
        keyType: "P256",
        pushDir: false,
        autoRenew: true,
      }),
    });
    console.log("SSL certificate applied");
  } else {
    console.log(`Using existing SSL cert: ${cert.id}`);
  }

  // Enable HTTPS
  await apiCall(`/websites/${website.id}/https`, {
    method: "POST",
    body: JSON.stringify({
      enable: true,
      hsts: false,
      sslProtocol: "TLSv1.2",
      algorithm: "ECDHE-ECDSA-AES256-GCM-SHA384",
    }),
  });

  console.log("HTTPS enabled");
}

// Restart OpenResty
async function restartOpenResty(): Promise<void> {
  console.log("Restarting OpenResty...");
  await apiCall("/openresty/restart", { method: "POST" });
  console.log("OpenResty restarted");
}

// Main deployment function
async function deploy(params: {
  domain: string;
  port: number;
  appName: string;
}): Promise<void> {
  const { domain, port, appName } = params;

  try {
    console.log(`\n=== Deploying ${appName} to ${domain}:${port} ===\n`);

    // Step 1: Create/update website
    await createWebsite({ domain, port, appName });

    // Step 2: Apply HTTPS
    await applyHttps(domain);

    // Step 3: Restart OpenResty
    await restartOpenResty();

    console.log("\n=== Deployment complete ===");
    console.log(`Website: https://${domain}`);
    console.log(`Backend: http://127.0.0.1:${port}`);

  } catch (error) {
    console.error("Deployment failed:", error);
    process.exit(1);
  }
}

// CLI
if (import.meta.main) {
  const domain = process.argv[2] || "regou.app";
  const port = parseInt(process.argv[3] || "30082", 10);
  const appName = process.argv[4] || "regou";

  deploy({ domain, port, appName });
}

export { deploy, createWebsite, applyHttps, restartOpenResty };
