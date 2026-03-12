const path = require("path");

const dotenvResult = require("dotenv").config({ path: path.join(__dirname, ".env") });

if (dotenvResult.parsed) {
  for (const [key, value] of Object.entries(dotenvResult.parsed)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

module.exports = process.env;
