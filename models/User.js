const { Schema, model } = require("mongoose");

// mongoose user schema
const userSchema = new Schema({
  chatId: { type: Number, unique: true },
  name: String,
  balance: { type: Number, default: 0 },
  language: { type: String, default: null },
  addressBinance: String,
  addressTRX: String,
  addressTON: String,
});
const User = model("User", userSchema);
module.exports = User