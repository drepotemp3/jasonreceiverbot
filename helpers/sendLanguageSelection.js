const { Markup } = require("telegraf");

async function sendLanguageSelection(ctx) {
  const text =
    `لطفا زبان موردنظرتان را انتخاب کنید.\n\n` +
    `Please choose your preferred language.`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("🇮🇷 فارسی", "LANG_FA")],
    [Markup.button.callback("🇬🇧 English", "LANG_EN")],
  ]);

  await ctx.reply(
    `${text}`,
    {
      ...keyboard,
      parse_mode: "Markdown",
      reply_to_message_id: ctx.message.message_id,
    }
  );
}


module.exports = sendLanguageSelection