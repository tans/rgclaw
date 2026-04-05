import { WeChatBot } from "@wechatbot/wechatbot";

async function test() {
  const bot = new WeChatBot();
  
  // SDK v2.0+ API: login() returns credentials after QR flow
  const credentials = await bot.login({
    callbacks: {
      onQrUrl: (url: string) => {
        console.log("QR URL:", url);
      },
      onScanned: () => console.log("Scanned!"),
      onConfirmed: (creds: any) => console.log("Confirmed:", creds),
    }
  });
  
  console.log("Credentials:", credentials);
}

test().catch(console.error);
