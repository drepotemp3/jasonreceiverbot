const { Markup } = require("telegraf");

function getMainKeyboard(lang = 'english') {
  const isFa = lang === 'persian';

  return Markup.inlineKeyboard([
    [Markup.button.callback(isFa ? '🌐 زبان' : '🌐 Language', 'LANG')],
    [Markup.button.callback(isFa ? '📤 آپلود حساب' : '📤 Upload Account', 'UPLOAD')],
    [Markup.button.callback(isFa ? '💸 برداشت' : '💸 Withdraw', 'WITHDRAW')],
  ]);
}

module.exports = getMainKeyboard;
