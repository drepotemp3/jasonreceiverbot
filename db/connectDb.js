const mongoose = require("mongoose");
const launchBot = require("../helpers/launchBot");
require("dotenv/config");


let isConnecting = false;

function connectDb(retryCount = 0) {
  if (isConnecting) return;
  isConnecting = true;

  console.log("🟡 Attempting to connect to MongoDB...");

  mongoose
    .connect(process.env.MONGODB_URI, {
      dbName: "jasonreceiver",
    })
    .then(() => {
      console.log("✅ Connected to MongoDB");
      isConnecting = false;

      if (!global.isBotLaunched) {
        launchBot(); // ✅ only launch bot once
        global.isBotLaunched = true;
      }

    })
    .catch((err) => {
      console.error(`❌ MongoDB connection error (attempt ${retryCount + 1}):`, err.message);
      isConnecting = false;

      const delay = 2000;
      console.log(`🔁 Retrying MongoDB connection in ${delay / 1000}s...`);
      setTimeout(() => connectDb(retryCount + 1), delay);
    });
}

module.exports = connectDb;
