// index.js
// This file runs your web server for Assignment 4
//

// dotenv reads the .env file and puts each value into a global object called process.env.
require("dotenv").config();

// Bring in the Express library (used to make websites with Node.js)
// Express is what lets your website move between pages,
// handle user actions, and send or receive data.
const express = require("express");
// It lets you store data across multiple requests (like login info).
const session = require("express-session");

// Bring in Knex (a helper for talking to your PostgreSQL database)
// Knex is a query builder
const knex = require("knex");

// Make a new Express app — this is your website
const app = express();

// Enable sessions to remember logged-in users
app.use(session({
    secret: "supersecretkey", // you can change this to anything random
    resave: false,
    saveUninitialized: false
}));

// Optional: bcrypt can be used later if password security is needed
// const bcrypt = require("bcrypt");

// SETUP VIEW ENGINE
// app.set() is how you configure settings for your Express app.
// EJS lets you make HTML files that can include data from JavaScript.
app.set("view engine", "ejs");

// MIDDLEWARE
// This line lets your website read data that’s sent from HTML forms.
// Without it, things like req.body.name won’t work later.
app.use(express.urlencoded({ extended: true }));

// DATABASE CONNECTION
// This connects to your PostgreSQL database using values from .env.
// (Knex is just making it easier to write SQL queries.)
const db = knex({
    client: "pg",
    connection: {
        host: process.env.RDS_HOSTNAME || "localhost",
        user: process.env.RDS_USERNAME || "postgres",
        password: process.env.RDS_PASSWORD || "admin",
        database: process.env.RDS_DB_NAME || "assignment3",
        port: Number(process.env.RDS_PORT) || 5432,
        ssl: process.env.DB_SSL ? { rejectUnauthorized: false } : false
    },
});

// Helper function to protect pages
// Checks if a user is logged in before letting them access certain routes
function requireLogin(req, res, next) {
    if (!req.session.user) {
        return res.redirect("/");
    }
    next();
}

// Home / Login page
app.get("/", (req, res) => {
    // Pass a blank error_message so EJS has something to read
    // res.render() = “take a template + data → make HTML → send it to the browser.”
    res.render("test", { error_message: "" });
});


// START THE SERVER
// Use the port number from .env (or 3000 if none is set)
const PORT = Number(process.env.PORT) || 3000;

// Start listening for web requests
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});

//jade edited