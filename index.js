// index.js
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const knex = require("knex");

const app = express();

// SESSIONS
app.use(session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: false
}));

// VIEW ENGINE
app.set("view engine", "ejs");

// FORM BODY PARSER
app.use(express.urlencoded({ extended: true }));

// DATABASE CONNECTION (Elastic Beanstalk + Local)
const db = knex({
    client: "pg",
    connection: {
        host: process.env.RDS_HOSTNAME || "localhost",
        user: process.env.RDS_USERNAME || "postgres",
        password: process.env.RDS_PASSWORD || "password",
        database: process.env.RDS_DB_NAME || "intexdb",
        port: Number(process.env.RDS_PORT) || 5432,

        // IMPORTANT: SSL only in production environment
        ssl: process.env.DB_SSL ? { rejectUnauthorized: false } : false
    },
});

// AUTH PROTECTOR
function requireLogin(req, res, next) {
    if (!req.session.user) return res.redirect("/");
    next();
}

// ROUTES
app.get("/", async(req, res) => {
    try {
        const rows = await db.select("*").from("test_table");
        res.render("test", { rows });
    } catch (err) {
        console.error("DB ERROR:", err);
        res.status(500).send("DB error: " + err.message);
    }
});

// PORT (Required by EB)
const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});