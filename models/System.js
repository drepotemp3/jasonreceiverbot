const { model, Schema } = require("mongoose");

const System = model(
  "System",
  new Schema({
    admin: Boolean,
    admins: [String],
    channel: String,
  })
);

module.exports = System