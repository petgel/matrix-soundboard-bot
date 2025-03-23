require('dotenv').config();
console.log("Environment variables:");
console.log("MATRIX_HOMESERVER_URL:", process.env.MATRIX_HOMESERVER_URL);
console.log("MATRIX_USER_ID:", process.env.MATRIX_BOT_USER_ID);
console.log("Access token available:", process.env.MATRIX_ACCESS_TOKEN ? "Yes" : "No");