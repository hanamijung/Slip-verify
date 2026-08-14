import dotenv from "dotenv";
dotenv.config();

export const CONFIG = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN || "",
  MONGODB_URI: process.env.MONGODB_URI || "mongodb://localhost:27017/slipdb",
  COMMAND_PREFIX: process.env.COMMAND_PREFIX || "!",
  SLIP_API_BASE_URL: "https://slip-c.oiio.download",
} as const;

if (!CONFIG.DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN is required. Please set it in .env file.");
  process.exit(1);
}
