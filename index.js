require("dotenv/config");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { Telegraf, Markup, session } = require("telegraf");
const Queue = require("queue-promise");
const connectDb = require("./db/connectDb");
const getMainKeyboard = require("./helpers/getMainKeyboard");

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

bot.use((ctx, next) => {
  if (!ctx.session) ctx.session = {};
  return next();
});

global.bot = bot;

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
  const isFa = u.language === "persian";

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(isFa ? "🌐 زبان" : "🌐 Language", "LANG")],
    [
      Markup.button.callback(
        isFa ? "📤 آپلود حساب" : "📤 Upload Account",
        "UPLOAD"
      ),
    ],
    [Markup.button.callback(isFa ? "💸 برداشت" : "💸 Withdraw", "WITHDRAW")],
  ]);

  sendWrapped(() => ctx.reply(menuText, keyboard));
});

// Withdraw flow
bot.action("WITHDRAW", async (ctx) => {
  const user = await User.findOne({ chatId: ctx.from.id });
  if (!user) return ctx.reply("User not found.");

  const isFa = user.language === "persian";
  const message = isFa
    ? `موجودی شما: $${user.balance}\nروش پرداخت را انتخاب کنید`
    : `Your balance: $${user.balance}\nSelect payment method`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("Binance", "PM_binance")],
    [Markup.button.callback("TRX", "PM_trx")],
    [Markup.button.callback("TON", "PM_ton")],
  ]);

  try {
    await ctx.editMessageText(message, keyboard);
  } catch (e) {
    // fallback to sending a new message if edit fails (e.g. stale message)
    await ctx.reply(message, keyboard);
  }
});

const withdrawChoice = async (ctx, method) => {
  const u = await User.findOne({ chatId: ctx.from.id });
  const lang = u?.language || "english";
  const isFa = lang === "persian";

  const addrField = {
    binance: "addressBinance",
    trx: "addressTRX",
    ton: "addressTON",
  }[method];

  if (!u[addrField]) {
    const addressPrompt = {
      binance: isFa
        ? "لطفاً شناسه Binance خود را ارسال کنید."
        : "Please send your Binance ID.",
      trx: isFa
        ? "لطفاً آدرس TRX خود را ارسال کنید."
        : "Please send your TRX address.",
      ton: isFa
        ? "لطفاً آدرس TON خود را ارسال کنید."
        : "Please send your TON address.",
    }[method];

    await ctx.reply(addressPrompt);
    ctx.session = { expectAddr: method };
    return;
  }

  const amountPrompt = isFa
    ? "مقدار برداشت را وارد کنید:"
    : "Enter withdrawal amount:";
  ctx.session = { expectWithdraw: method };
  await ctx.reply(amountPrompt);
};

bot.action("PM_binance", (ctx) => withdrawChoice(ctx, "binance"));
bot.action("PM_trx", (ctx) => withdrawChoice(ctx, "trx"));

bot.command("update_wallet", async (ctx) => {
  const u = await User.findOne({ chatId: ctx.from.id });
  const isFa = u.language === "persian";
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("Binance", "UW_binance")],
    [Markup.button.callback("TRX", "UW_trx")],
    [Markup.button.callback("TON", "UW_ton")],
  ]);

  await ctx.reply(
    isFa ? "یک روش را انتخاب کنید:" : "Select a method:",
    keyboard
  );
});

["binance", "trx", "ton"].forEach((method) => {
  bot.action(`UW_${method}`, async (ctx) => {
    const u = await User.findOne({ chatId: ctx.from.id });
    const isFa = u.language === "persian";
    ctx.session.expectWalletUpdate = method;

    let prompt;
    if (method === "binance") {
      prompt = isFa
        ? "لطفاً شناسه جدید Binance خود را ارسال کنید:"
        : "Please send your new Binance ID:";
    } else {
      prompt = isFa
        ? `لطفاً آدرس جدید ${method.toUpperCase()} خود را ارسال کنید:`
        : `Please send your new ${method.toUpperCase()} wallet address:`;
    }

    await ctx.editMessageText(prompt);
  });
});

bot.on("text", async (ctx) => {
  const session = ctx.session || {};
  const u = await User.findOne({ chatId: ctx.from.id });
  const isFa = u.language === "persian";

  // Handle updating address
  if (session.expectAddr) {
    const fieldMap = {
      binance: "addressBinance",
      trx: "addressTRX",
      ton: "addressTON",
    };
    const field = fieldMap[session.expectAddr];

    u[field] = ctx.message.text.trim();
    await u.save();

    const confirmationText = isFa
      ? `${session.expectAddr.toUpperCase()} با موفقیت ذخیره شد.`
      : `${session.expectAddr.toUpperCase()} address saved.`;

    await ctx.reply(confirmationText);
    delete ctx.session.expectAddr;

    // Resend menu (no hello)
    const menuText = isFa
      ? `موجودی شما هنوز *${u.balance}* است.`
      : `Your balance is still *${u.balance}* for now.`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(isFa ? "🌐 زبان" : "🌐 Language", "LANG")],
      [
        Markup.button.callback(
          isFa ? "📤 آپلود حساب" : "📤 Upload Account",
          "UPLOAD"
        ),
      ],
      [Markup.button.callback(isFa ? "💸 برداشت" : "💸 Withdraw", "WITHDRAW")],
    ]);

    await ctx.replyWithMarkdownV2(menuText, keyboard);
    return;
  }

  if (session.expectWalletUpdate) {
    const field = {
      binance: "addressBinance",
      trx: "addressTRX",
      ton: "addressTON",
    }[session.expectWalletUpdate];

    u[field] = ctx.message.text.trim();
    await u.save();

    await ctx.reply(
      isFa
        ? `${session.expectWalletUpdate.toUpperCase()} با موفقیت ذخیره شد.`
        : `${session.expectWalletUpdate.toUpperCase()} address saved successfully.`
    );

    delete ctx.session.expectWalletUpdate;

    // resend menu (no hello)
    const menuText = isFa
      ? `موجودی شما هنوز *${u.balance}* است.`
      : `Your balance is still *${u.balance}* for now.`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(isFa ? "🌐 زبان" : "🌐 Language", "LANG")],
      [
        Markup.button.callback(
          isFa ? "📤 آپلود حساب" : "📤 Upload Account",
          "UPLOAD"
        ),
      ],
      [Markup.button.callback(isFa ? "💸 برداشت" : "💸 Withdraw", "WITHDRAW")],
    ]);

    return sendWrapped(() => ctx.replyWithMarkdown(menuText, keyboard));
  }
});

bot.action("PM_ton", (ctx) => withdrawChoice(ctx, "ton"));

bot.on("text", async (ctx) => {
  const session = ctx.session || {};
  const u = await User.findOne({ chatId: ctx.from.id });
  const lang = u?.language || "english";
  const isFa = lang === "persian";

  // handle address input
  if (session.expectAddr) {
    const method = session.expectAddr;
    const field = {
      binance: "addressBinance",
      trx: "addressTRX",
      ton: "addressTON",
    }[method];

    u[field] = ctx.message.text.trim();
    await u.save();

    const confirmationMsg = {
      binance: isFa ? "شناسه Binance ذخیره شد." : "Binance ID saved.",
      trx: isFa ? "آدرس TRX ذخیره شد." : "TRX address saved.",
      ton: isFa ? "آدرس TON ذخیره شد." : "TON address saved.",
    }[method];

    await ctx.reply(confirmationMsg);

    // move immediately to withdrawal step
    ctx.session = { expectWithdraw: method };
    const promptMsg = isFa
      ? "مقدار برداشت را وارد کنید:"
      : "Enter withdrawal amount:";
    await ctx.reply(promptMsg);
    return;
  }

  // handle withdrawal amount
  if (session.expectWithdraw) {
    const amt = parseFloat(ctx.message.text.trim());
    if (isNaN(amt) || amt <= 0) {
      await ctx.reply(
        isFa ? "مقدار معتبر وارد کنید." : "Please enter a valid amount."
      );
      return;
    }

    if (amt > u.balance) {
      await ctx.reply(isFa ? "موجودی ناکافی است" : "Insufficient balance");
    } else {
      await ctx.reply(
        isFa
          ? `درخواست برداشت $${amt} ثبت شد. به زودی به شما اطلاع داده خواهد شد.`
          : `Request for $${amt} sent. You will be updated in chat.`
      );
      // register withdrawal here if needed
    }

    delete ctx.session.expectWithdraw;

    // resend localized menu
    const menuText = isFa
      ? `موجودی شما هنوز *${u.balance}* است.`
      : `Your balance is still *${u.balance}* for now.`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(isFa ? "🌐 زبان" : "🌐 Language", "LANG")],
      [
        Markup.button.callback(
          isFa ? "📤 آپلود حساب" : "📤 Upload Account",
          "UPLOAD"
        ),
      ],
      [Markup.button.callback(isFa ? "💸 برداشت" : "💸 Withdraw", "WITHDRAW")],
    ]);

    sendWrapped(() =>
      ctx.reply(menuText, {
        parse_mode: "Markdown",
        ...keyboard,
      })
    );
  }
});

bot.telegram.setMyCommands([
  { command: "start", description: "Start the bot" },
  { command: "update_wallet", description: "Update wallet address" },
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
