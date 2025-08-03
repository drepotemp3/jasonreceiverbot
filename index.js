require("dotenv/config");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { Telegraf, Markup } = require("telegraf");
const Queue = require("queue-promise");
const connectDb = require("./db/connectDb");
const getMainKeyboard = require("./helpers/getMainKeyboard");
const bot = new Telegraf(process.env.BOT_TOKEN);
global.bot = bot;

// Queue configuration for bot commands
const queue = new Queue({
  concurrent: 30,
  interval: 1000,
});
const app = express();

// throttle queue: up to 25 messages/sec → interval ≈ 40 ms, concurrency 1
const msgQueue = new Queue({ concurrent: 1, interval: 40 });

// mongoose user schema
const userSchema = new mongoose.Schema({
  chatId: { type: Number, unique: true },
  name: String,
  balance: { type: Number, default: 0 },
  language: { type: String, default: "english" },
  addressBinance: String,
  addressTRX: String,
  addressTON: String,
});
const User = mongoose.model("User", userSchema);

// utility to enqueue send/edit
function sendWrapped(fn) {
  msgQueue.enqueue(() => fn().catch(console.error));
}

// middleware: ensure channel membership
const CHANNEL = process.env.CHANNEL_USERNAME; // e.g. '@yourchannel'
async function requireJoin(ctx, next) {
  try {
    const member = await ctx.telegram.getChatMember(CHANNEL, ctx.from.id);
    const okStatuses = ["member", "creator", "administrator"];
    if (!okStatuses.includes(member.status)) {
      await ctx.reply(`Please join channel ${CHANNEL} to use this bot.`);
      return;
    }
  } catch (err) {
    console.error(err);
    await ctx.reply("Error verifying membership. Try again later.");
    return;
  }
  return next();
}

bot.start(requireJoin, async (ctx) => {
  const chatId = ctx.from.id;
  let user = await User.findOne({ chatId });
  let name =
    ctx.from.username || ctx.from.first_name || ctx.from.last_name || "there";
  let menuText;
  if (user) {
    const lang = user.language || "english";
    menuText =
      lang === "persian"
        ? `خوش برگشتی ${name}\nموجودی شما: $${user.balance}`
        : `Welcome back, ${name}\nYour balance is $${user.balance}`;
  } else {
    user = await User.create({ chatId, name });
    menuText = `Hey ${name}, welcome to JasonReceiver bot\nYour balance is $${user.balance}`;
  }

  sendWrapped(() => ctx.reply(menuText, getMainKeyboard(user.language)));

});

// language selector
bot.action("LANG", async (ctx) => {
  await ctx.editMessageText(
    "Select a language\n\nزبان خود را انتخاب کنید",
    Markup.inlineKeyboard([
      [Markup.button.callback("🇮🇷 Persian", "SETLANG_persian")],
      [Markup.button.callback("🇬🇧 English", "SETLANG_english")],
    ])
  );
});
bot.action(/SETLANG_(.+)/, async (ctx) => {
  const lang = ctx.match[1];
  await User.updateOne({ chatId: ctx.from.id }, { language: lang });
  const u = await User.findOne({ chatId: ctx.from.id });
  await ctx.reply(
    lang === "persian" ? "زبان بروزرسانی شد" : "Language updated"
  );
  // resend menu
  const menuText = `${u.language === "persian" ? "خوش آمدید" : "Hello"} ${
    u.name
  }\nYour balance is $${u.balance}`;
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback(
        u.language === "persian" ? "زبان" : "Language",
        "LANG"
      ),
    ],
    [Markup.button.callback("Upload Account", "UPLOAD")],
    [Markup.button.callback("Withdraw", "WITHDRAW")],
  ]);
  sendWrapped(() => ctx.reply(menuText, keyboard));
});

// Withdraw flow
bot.action("WITHDRAW", async (ctx) => {
  const u = await User.findOne({ chatId: ctx.from.id });
  const kn = Markup.inlineKeyboard([
    [Markup.button.callback("Binance", "PM_binance")],
    [Markup.button.callback("TRX", "PM_trx")],
    [Markup.button.callback("TON", "PM_ton")],
  ]);
  await ctx.editMessageText(
    `Your balance: $${u.balance}\nSelect payment method`,
    kn
  );
});

const withdrawChoice = async (ctx, method) => {
  const u = await User.findOne({ chatId: ctx.from.id });
  const addrField = {
    binance: "addressBinance",
    trx: "addressTRX",
    ton: "addressTON",
  }[method];
  if (!u[addrField]) {
    await ctx.reply(`Please send your ${method.toUpperCase()} address.`);
    ctx.session = { expectAddr: method };
    return;
  }
  ctx.session = { expectWithdraw: method };
  await ctx.reply("Enter withdrawal amount:");
};

bot.action("PM_binance", (ctx) => withdrawChoice(ctx, "binance"));
bot.action("PM_trx", (ctx) => withdrawChoice(ctx, "trx"));
bot.action("PM_ton", (ctx) => withdrawChoice(ctx, "ton"));

bot.on("text", async (ctx) => {
  const session = ctx.session || {};
  const u = await User.findOne({ chatId: ctx.from.id });
  if (session.expectAddr) {
    const field = {
      binance: "addressBinance",
      trx: "addressTRX",
      ton: "addressTON",
    }[session.expectAddr];
    u[field] = ctx.message.text.trim();
    await u.save();
    await ctx.reply(`${session.expectAddr.toUpperCase()} address saved.`);
    delete ctx.session.expectAddr;
    return;
  }
  if (session.expectWithdraw) {
    const amt = parseFloat(ctx.message.text.trim());
    if (isNaN(amt) || amt > u.balance) {
      await ctx.reply(
        u.language === "persian" ? "موجودی ناکافی است" : "Insufficient balance"
      );
    } else {
      // register withdrawal request (not detailed here)
      await ctx.reply(`Request for $${amt} sent, you will be updated in chat.`);
    }
    delete ctx.session.expectWithdraw;
    // resend menu
    const menuText = `${u.language === "persian" ? "خوش آمدید" : "Hello"} ${
      u.name
    }\nYour balance is $${u.balance}`;
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("Language", "LANG")],
      [Markup.button.callback("Upload Account", "UPLOAD")],
      [Markup.button.callback("Withdraw", "WITHDRAW")],
    ]);
    sendWrapped(() => ctx.reply(menuText, keyboard));
    return;
  }
});

bot.telegram.setMyCommands([
  { command: "/start", description: "Start the bot" },
]);

app.get("/ping", async (req, res) => {
  res.status(200).json({ message: "Hello" });
});

const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`App is listening on port ${port}`);
});

// Initial connection
connectDb();

// Optional: Reconnect if connection is lost after being established
mongoose.connection.on("disconnected", () => {
  console.warn("⚠️ MongoDB disconnected. Retrying...");
  connectDb();
});
