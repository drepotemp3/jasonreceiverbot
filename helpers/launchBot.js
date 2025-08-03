module.exports = launchBot = () => {
  global.bot.telegram
    .getMe()
    .then((botInfo) => {
      console.log(`Bot ${botInfo.username} is connected and running.`);
      global.bot.launch();
    })
    .catch((err) => {
      console.error("Error connecting bot:", err);
      setTimeout(launchBot, 5000)
    });
};
