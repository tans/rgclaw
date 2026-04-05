import { WeChatBot } from "@wechatbot/wechatbot";

const QR_GENERATION_TIMEOUT_MS = 25000;

async function testQRLogin(): Promise<void> {
  console.log("Starting QR login test...");
  
  const userId = "test-user-" + Date.now();
  let resolved = false;
  let bot: WeChatBot | null = null;

  const generationTimeout = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      console.error("❌ QR code generation timeout after 25s");
      try {
        (bot as any)?.stop?.();
      } catch {}
      process.exit(1);
    }
  }, QR_GENERATION_TIMEOUT_MS);

  try {
    console.log("Creating WeChatBot instance...");
    bot = new WeChatBot();
    console.log("✅ WeChatBot created");
  } catch (error) {
    clearTimeout(generationTimeout);
    if (!resolved) {
      resolved = true;
      console.error("❌ Failed to initialize WeChatBot:", error);
      process.exit(1);
    }
    return;
  }

  (bot as any).login({
    onQRCode: (qrCodeUrl: string, qrToken: string) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(generationTimeout);
      console.log("\n✅ QR Code received!");
      console.log("\n🔗 QR Code URL:");
      console.log(qrCodeUrl);
      console.log("\n📱 QR Token:", qrToken);
      console.log("\n⏰ This QR code will expire in 5 minutes");
      
      // Keep process alive to show the QR code
      setTimeout(() => {
        console.log("\n👋 Test complete");
        process.exit(0);
      }, 300000); // 5 minutes
    },
    onScanned: () => {
      console.log("📲 QR code scanned!");
    },
    onConfirmed: (credentials: any) => {
      console.log("✅ Login confirmed!");
      console.log("Credentials:", {
        botId: credentials.botId,
        accountId: credentials.accountId,
        userId: credentials.userId,
        baseUrl: credentials.baseUrl,
      });
      (bot as any)?.stop?.();
    },
    onError: (error: Error) => {
      clearTimeout(generationTimeout);
      if (resolved) return;
      resolved = true;
      console.error("❌ Login error:", error.message);
      (bot as any)?.stop?.();
      process.exit(1);
    },
  });
}

testQRLogin();
