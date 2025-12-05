// index.js
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const app = express();

// SESSIONS
app.use(session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: false
}));

// Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());

// FORM BODY PARSER
app.use(express.urlencoded({ extended: true }));

// DATABASE CONNECTION (Elastic Beanstalk + Local)
const knex = require("knex")({
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


// ROUTES
// gets content for test page
app.get("/test", async(req, res) => {
    try {
        const rows = await db.select("*").from("test_table");
        res.render("test", { rows });
    } catch (err) {
        console.error("DB ERROR:", err);
        res.status(500).send("DB error: " + err.message);
    }
});

// gets content for teapot display
app.get("/teapot", (req, res) => {
    res.status(418).render("teapot"); // render an EJS template
});

// Middleware to pass user to all views
app.use((req, res, next) => {
    res.locals.user = req.session.userId ? { //does userid exist
        id: req.session.userId,
        email: req.session.userEmail,
        role: req.session.userRole,
        firstname: req.session.userFirstName,
        lastname: req.session.userLastName
    } : null;
    next();
});

// Middleware to require login
const requireLogin = (req, res, next) => {
    // if the user id exists
    if (!req.session.userId) {

        // Capture the page they were trying to access
        const returnTo = encodeURIComponent(req.originalUrl);
        // go back to login page
        return res.redirect(`/login?returnTo=${returnTo}`);
    }

    // connection to the db
    knex("users")
        .where({ userid: req.session.userId })
        .first()
        .then((user) => {
            if (!user) {
                return res.redirect("/login");
            }
            // Clean up the user object
            req.user = {
                id: user.userid,
                email: user.useremail,
                username: user.username,
                firstname: user.userfirstname,
                lastname: user.userlastname,
                role: user.userrole
            };
            next();
        })
        .catch((err) => {
            console.error("requireLogin error:", err);
            res.status(500).send("Server error");
        });
};


// Middleware to require manager role
const requireManager = (req, res, next) => {
    if (!req.session.userId || req.session.userRole !== "M") {
        // Redirect to login page with optional message
        return res.redirect("/login?error=Access denied. Manager role required.");
    }
    next();
};

// HOME PAGE
app.get("/", (req, res) => {
    res.render("index");
});

// LOGIN PAGE
app.get("/login", (req, res) => {
    const returnTo = req.query.returnTo || "/";
    res.render("login", { error: null, returnTo });
});


app.post("/login", (req, res) => {
    const { email, password } = req.body;

    // Determine redirect after login
    const returnTo = req.query.returnTo || req.body.returnTo || "/";

    knex("users")
        .where({ useremail: email.toLowerCase() })
        .first()
        .then((user) => {
            if (!user || user.userpassword !== password) {
                return res.render("login", {
                    error: "Invalid email or password",
                    returnTo // <-- include returnTo
                });
            }

            // Save session data
            req.session.userId = user.userid;
            req.session.userEmail = user.useremail;
            req.session.userRole = user.userrole;
            req.session.userFirstName = user.userfirstname;
            req.session.userLastName = user.userlastname;

            // Redirect back
            res.redirect(returnTo);
        })
        .catch((err) => {
            console.error("Login error:", err);
            res.render("login", {
                error: "Login failed. Please try again.",
                returnTo // <-- include returnTo
            });
        });
});


// LOGOUT
app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/");
});

// CREATE PROFILE PAGE
app.get("/createProfile", (req, res) => {
    const returnTo = req.query.returnTo || "/";
    res.render("createProfile", { error: null, returnTo });
});

// when user hits create button this is called
app.post("/createProfile", (req, res) => {
    let {
        email,
        password,
        username,
        firstname,
        lastname,
        dob,
        phone,
        city,
        state,
        zip,
        school,
        field
    } = req.body;

    phone = phone ? phone.replace(/\D/g, "").slice(0, 10) : null;
    const returnTo = req.query.returnTo || req.body.returnTo || "/";

    if (!email || !password || !username || !firstname || !lastname) {
        return res.render("createProfile", {
            error: "All required fields must be filled",
            returnTo
        });
    }

    // if user already exists
    knex("users")
        .where({ useremail: email.toLowerCase() })
        .orWhere({ username: username })
        .first()
        .then(existingUser => {
            if (existingUser) {
                throw new Error("Email or username already exists");
            }

            // if participant exists
            return knex("participants")
                .where({ participantemail: email.toLowerCase() })
                .first();
        })
        .then(existingParticipant => {
            if (existingParticipant) {
                // Participant exists, create user linked to it
                const role = existingParticipant.participantrole === 'admin' ? 'M' : 'U';
                return knex("users")
                    .insert({
                        useremail: email.toLowerCase(),
                        userpassword: password,
                        username: username,
                        userfirstname: existingParticipant.participantfirstname || firstname,
                        userlastname: existingParticipant.participantlastname || lastname,
                        userrole: role,
                        participantid: existingParticipant.participantid
                    })
                    .returning("*")
                    .then(newUser => ({ user: newUser[0], participant: existingParticipant }));
            } else {
                // Participant does not exist, create participant then user
                return knex("participants")
                    .insert({
                        participantemail: email.toLowerCase(),
                        participantfirstname: firstname,
                        participantlastname: lastname,
                        participantdob: dob || null,
                        participantphone: phone,
                        participantcity: city || null,
                        participantstate: state || null,
                        participantzip: zip || null,
                        participantschooloremployer: school || null,
                        participantfieldofinterest: field || null,
                        participantrole: 'participant'
                    })
                    .returning("*")
                    .then(newParticipant => {
                        const participant = newParticipant[0];
                        return knex("users")
                            .insert({
                                useremail: email.toLowerCase(),
                                userpassword: password,
                                username: username,
                                userfirstname: firstname,
                                userlastname: lastname,
                                userrole: 'U', // default for new participant
                                participantid: participant.participantid
                            })
                            .returning("*")
                            .then(newUser => ({ user: newUser[0], participant }));
                    });
            }
        })
        .then(({ user }) => {
            // Step 3: create session
            req.session.userId = user.userid;
            req.session.userEmail = user.useremail;
            req.session.userRole = user.userrole;
            req.session.userFirstName = user.userfirstname;
            req.session.userLastName = user.userlastname;

            // Redirect to original page
            res.redirect(returnTo);
        })
        .catch(err => {
            console.error("Create profile error:", err);
            res.render("createProfile", {
                error: err.message || "Failed to create profile. Please try again.",
                returnTo
            });
        });
});

//DASHBOARD PAGE
app.get('/dashboard', (req, res) => {
    res.render('dashboard'); // matches views/dashboard.ejs
});

// EVENTS PAGE
app.get("/events", (req, res) => {
    knex("eventoccurrences")
        .select(
            "eventoccurrences.*",
            "eventtemplates.eventname as templatename",
            "eventtemplates.eventtype",
            "eventtemplates.eventdescription"
        )
        .leftJoin("eventtemplates", "eventoccurrences.templateid", "eventtemplates.templateid")
        .orderBy("eventdatetimestart", "asc")
        .then((events) => {
            res.render("events", { events });
        })
        .catch((err) => {
            console.error("Events error:", err);
            res.render("events", { events: [] });
        });
});

// EVENT REGISTER
app.get("/eventRegister/:id", requireLogin, (req, res) => {
    const occurrenceId = req.params.id;

    knex("eventoccurrences")
        .select(
            "eventoccurrences.*",
            "eventtemplates.eventname as templatename",
            "eventtemplates.eventtype",
            "eventtemplates.eventdescription"
        )
        .leftJoin("eventtemplates", "eventoccurrences.templateid", "eventtemplates.templateid")
        .where("eventoccurrences.occurrenceid", occurrenceId)
        .first()
        .then((event) => {
            if (!event) {
                return res.status(404).send("Event not found");
            }
            res.render("eventRegister", { event, error: null, success: null });
        })
        .catch((err) => {
            console.error("Event register page error:", err);
            res.status(500).send("Error loading event");
        });
});

app.post("/eventRegister/:id", requireLogin, (req, res) => {
    const occurrenceId = req.params.id;
    const { email, firstname, lastname } = req.user;
    const normalizedEmail = email.toLowerCase();

    // Step 1: Check if participant exists
    knex("participants")
        .where({ participantemail: normalizedEmail })
        .first()
        .then((existingParticipant) => {
            if (existingParticipant) {
                return existingParticipant.participantid;
            } else {
                // Insert new participant
                return knex("participants")
                    .insert({
                        participantemail: normalizedEmail,
                        participantfirstname: firstname,
                        participantlastname: lastname,
                        totaldonations: 0
                    })
                    .returning("participantid")
                    .then((result) => result[0].participantid);
            }
        })
        .then((participantid) => {
            // Step 2: Check if registration already exists
            return knex("registrations")
                .where({
                    participantid: participantid,
                    eventoccurrenceid: occurrenceId
                })
                .first()
                .then((existingRegistration) => {
                    if (existingRegistration) {
                        // Already registered
                        throw new Error("You have already registered for this event.");
                    } else {
                        // Insert new registration
                        return knex("registrations").insert({
                            participantid,
                            eventoccurrenceid: occurrenceId,
                            registrationstatus: "Registered",
                            registrationattendedflag: false
                        });
                    }
                });
        })
        .then(() => {
            // Step 3: Get event info for rendering page
            return knex("eventoccurrences")
                .select(
                    "eventoccurrences.*",
                    "eventtemplates.eventname as templatename",
                    "eventtemplates.eventtype",
                    "eventtemplates.eventdescription"
                )
                .leftJoin("eventtemplates", "eventoccurrences.templateid", "eventtemplates.templateid")
                .where("eventoccurrences.occurrenceid", occurrenceId)
                .first();
        })
        .then((event) => {
            res.render("eventRegister", {
                event,
                error: null,
                success: "You have successfully registered for this event!"
            });
        })
        .catch((err) => {
            console.error("Event registration error:", err);
            // Render page with error if already registered or other errors
            knex("eventoccurrences")
                .select(
                    "eventoccurrences.*",
                    "eventtemplates.eventname as templatename",
                    "eventtemplates.eventtype",
                    "eventtemplates.eventdescription"
                )
                .leftJoin("eventtemplates", "eventoccurrences.templateid", "eventtemplates.templateid")
                .where("eventoccurrences.occurrenceid", occurrenceId)
                .first()
                .then((event) => {
                    res.render("eventRegister", {
                        event,
                        error: err.message || "Registration failed. Please try again.",
                        success: null
                    });
                });
        });
});

// PROFILE PAGE
// PROFILE PAGE
app.get("/profile", requireLogin, (req, res) => {
    const userEmail = req.session.userEmail;

    // Step 1: Fetch participant info
    knex("participants")
        .where({ participantemail: userEmail })
        .first()
        .then((participant) => {

            // Step 2: Fetch registered events (if participant exists)
            const eventsQuery = participant ?
                knex("registrations")
                .select(
                    "registrations.registrationid",
                    "eventoccurrences.*",
                    "eventtemplates.eventname",
                    "registrations.registrationstatus"
                )
                .join("eventoccurrences", "registrations.eventoccurrenceid", "eventoccurrences.occurrenceid")
                .leftJoin("eventtemplates", "eventoccurrences.templateid", "eventtemplates.templateid")
                .where("registrations.participantid", participant.participantid)
                .orderBy("eventoccurrences.eventdatetimestart", "desc") :
                Promise.resolve([]);

            eventsQuery
                .then((events) => {
                    res.render("profile", {
                        user: req.user, // <-- Use req.user so role check works
                        participant,
                        events,
                        profileSuccess: req.query.profileSuccess || null,
                        profileError: req.query.profileError || null,
                        eventSuccess: req.query.eventSuccess || null,
                        eventError: req.query.eventError || null
                    });
                })
                .catch((err) => {
                    console.error("Events fetch error:", err);
                    res.render("profile", {
                        user: req.user,
                        participant,
                        events: [],
                        profileSuccess: null,
                        profileError: "Error loading events",
                        eventSuccess: null,
                        eventError: "Error loading events"
                    });
                });

        })
        .catch((err) => {
            console.error("Participant fetch error:", err);
            res.render("profile", {
                user: req.user,
                participant: null,
                events: [],
                profileSuccess: null,
                profileError: "Error loading participant info",
                eventSuccess: null,
                eventError: "Error loading events"
            });
        });
});

// UPDATE PARTICIPANT INFO
app.post("/profile/update-participant", requireLogin, (req, res) => {
    const userEmail = req.session.userEmail;
    const {
        participantdob,
        participantphone,
        participantcity,
        participantstate,
        participantzip,
        participantschooloremployer,
        participantfieldofinterest
    } = req.body;

    // Remove all non-digit characters and limit to 10 digits
    const sanitizedPhone = participantphone ? participantphone.replace(/\D/g, '').slice(0, 10) : null;

    // Check if participant exists
    knex("participants")
        .where({ participantemail: userEmail })
        .first()
        .then((participant) => {
            if (!participant) {
                // If participant record doesn't exist, create it
                return knex("participants")
                    .insert({
                        participantemail: userEmail,
                        participantdob: participantdob || null,
                        participantphone: sanitizedPhone,
                        participantcity: participantcity || null,
                        participantstate: participantstate || null,
                        participantzip: participantzip || null,
                        participantschooloremployer: participantschooloremployer || null,
                        participantfieldofinterest: participantfieldofinterest || null,
                        totaldonations: 0
                    });
            } else {
                // If participant exists, update
                return knex("participants")
                    .where({ participantid: participant.participantid })
                    .update({
                        participantdob: participantdob || null,
                        participantphone: sanitizedPhone,
                        participantcity: participantcity || null,
                        participantstate: participantstate || null,
                        participantzip: participantzip || null,
                        participantschooloremployer: participantschooloremployer || null,
                        participantfieldofinterest: participantfieldofinterest || null
                    });
            }
        })
        .then(() => {
            // Redirect back with success message
            res.redirect("/profile?profileSuccess=Participant info updated successfully");
        })
        .catch((err) => {
            console.error("Update participant error:", err);
            res.redirect("/profile?profileError=Failed to update participant info");
        });
});

//UPDATE USERNAME
app.post("/profile/update-username", requireLogin, (req, res) => {
    const userId = req.session.userId;
    const { username } = req.body;

    if (!username || username.trim() === "") {
        return res.redirect("/profile?profileError=Username cannot be empty");
    }

    knex("users")
        .where({ userid: userId })
        .update({ username: username.trim() })
        .then(() => {
            res.redirect("/profile?profileSuccess=Username updated successfully");
        })
        .catch(err => {
            console.error("Update username error:", err);
            res.redirect("/profile?profileError=Failed to update username");
        });
});


// =========================
// Update Password
// =========================
app.post("/profile/update-password", requireLogin, (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.session.userId;

    knex("users")
        .where({ userid: userId })
        .first()
        .then(user => {
            if (!user) throw new Error("User not found");

            if (user.userpassword !== currentPassword) {
                return res.redirect("/profile?profileError=Current password is incorrect");
            }
            if (newPassword !== confirmPassword) {
                return res.redirect("/profile?profileError=New passwords do not match");
            }

            return knex("users")
                .where({ userid: userId })
                .update({ userpassword: newPassword })
                .then(() => {
                    res.redirect("/profile?profileSuccess=Password updated successfully");
                });
        })
        .catch(err => {
            console.error("Password update error:", err);
            res.redirect("/profile?profileError=Failed to update password");
        });
});

// =========================
// Delete Account
// =========================
app.post("/profile/delete", requireLogin, (req, res) => {
    const userId = req.session.userId;

    knex("users")
        .where({ userid: userId })
        .del()
        .then(() => {
            req.session.destroy();
            res.redirect("/");
        })
        .catch((err) => {
            console.error("Profile delete error:", err);
            res.redirect("/profile?profileError=Failed to delete account");
        });
});

// =========================
// Unregister from Event
// =========================
app.post("/profile/unregister/:registrationId", requireLogin, (req, res) => {
    const registrationId = req.params.registrationId;

    knex("registrations")
        .where({ registrationid: registrationId })
        .del()
        .then(() => {
            res.redirect("/profile?eventSuccess=You have successfully unregistered from the event.");
        })
        .catch((err) => {
            console.error("Error unregistering from event:", err);
            res.redirect("/profile?eventError=Could not unregister. Please try again.");
        });
});

//update event status
app.post("/profile/update-event-status/:registrationId", requireLogin, (req, res) => {
    const { registrationId } = req.params;
    const { status } = req.body;

    knex("registrations")
        .where({ registrationid: registrationId })
        .update({ registrationstatus: status })
        .then(() => res.redirect("/profile?eventSuccess=Event status updated"))
        .catch(err => {
            console.error("Update event status error:", err);
            res.redirect("/profile?eventError=Failed to update event status");
        });
});


// DONATE PAGE
app.get("/donate", (req, res) => {
    const commonRender = (overrides = {}) => {
        res.render("donate", {
            needsLogin: false,
            personalDonations: [],
            error: null,
            success: null,
            ...overrides
        });
    };

    if (!req.session.userId) {
        // User not logged in
        return commonRender({ needsLogin: true });
    }

    // Fetch user's personal donations
    knex("donations")
        .join("participants", "donations.participantid", "participants.participantid")
        .where("participants.participantemail", req.session.userEmail)
        .orderBy("donationdate", "desc")
        .then(personalDonations => {
            commonRender({ personalDonations });
        })
        .catch(err => {
            console.error("Error fetching personal donations:", err);
            commonRender({ error: "Failed to load your donations" });
        });
});



app.post("/donate", requireLogin, (req, res) => {
    const { amount } = req.body;
    const userEmail = req.session.userEmail;

    if (!amount || amount <= 0) {
        return res.render("donate", {
            needsLogin: false,
            personalDonations: [],
            error: "Please enter a valid amount",
            success: null
        });
    }

    knex("participants")
        .where({ participantemail: userEmail })
        .first()
        .then(participant => {
            if (!participant) {
                return res.render("donate", {
                    needsLogin: false,
                    personalDonations: [],
                    error: "Please register for an event first to create your participant profile",
                    success: null
                });
            }

            return knex("donations")
                .insert({
                    participantid: participant.participantid,
                    donationamount: amount
                })
                .then(() => {
                    return knex("participants")
                        .where({ participantid: participant.participantid })
                        .increment("totaldonations", amount);
                })
                .then(() => {
                    // After donation, fetch updated personal donations
                    return knex("donations")
                        .where({ participantid: participant.participantid })
                        .orderBy("donationdate", "desc");
                })
                .then(personalDonations => {
                    res.render("donate", {
                        needsLogin: false,
                        personalDonations,
                        error: null,
                        success: "Thank you for your donation!"
                    });
                });
        })
        .catch(err => {
            console.error("Donation error:", err);
            res.render("donate", {
                needsLogin: false,
                personalDonations: [],
                error: "Donation failed. Please try again.",
                success: null
            });
        });
});


// DONATIONS PAGE (View)
app.get("/donations", requireLogin, (req, res) => {
    const isManager = req.session.userRole === "M";

    knex("donations")
        .select(
            "donations.*",
            "participants.participantfirstname",
            "participants.participantlastname"
        )
        .join("participants", "donations.participantid", "participants.participantid")
        .orderByRaw('COALESCE(donations.donationdate, CURRENT_TIMESTAMP) DESC')
        .then((donations) => {
            res.render("donations", { donations, isManager });
        })
        .catch((err) => {
            console.error("Donations view error:", err);
            res.render("donations", { donations: [], isManager });
        });
});

// EDIT DONATION - MANAGER ONLY
app.post("/donations/edit/:id", requireLogin, (req, res) => {
    const isManager = req.session.userRole === "M";
    if (!isManager) {
        return res.status(403).send("Access denied.");
    }

    const donationId = req.params.id;
    const { donor, amount, date } = req.body;

    if (!donor || !amount || !date) {
        return res.status(400).send("All fields are required.");
    }

    // Split donor name into first and last
    const nameParts = donor.trim().split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ") || ""; // in case there are middle names

    // Find participant ID based on name
    knex("participants")
        .select("participantid")
        .where({
            participantfirstname: firstName,
            participantlastname: lastName
        })
        .first()
        .then((participant) => {
            if (!participant) {
                return res.status(404).send("Participant not found.");
            }

            // Update donation
            return knex("donations")
                .where("donationid", donationId)
                .update({
                    participantid: participant.participantid,
                    donationamount: parseFloat(amount),
                    donationdate: date
                });
        })
        .then(() => {
            res.redirect("/donations");
        })
        .catch((err) => {
            console.error("Error editing donation:", err);
            res.status(500).send("Failed to update donation.");
        });
});


// USER SURVEYS
// USER SURVEYS
app.get("/userSurveys", requireLogin, (req, res) => {
    const userEmail = req.session.userEmail;

    knex("participants")
        .where({ participantemail: userEmail })
        .first()
        .then((participant) => {
            if (!participant) {
                const errorMsg = "Please register for an event first";
                const successMsg = req.session.success || null;
                req.session.success = null;
                return res.render("userSurveys", { events: [], userSurveys: [], error: errorMsg, success: successMsg });
            }

            // Get user's submitted surveys
            knex("surveys")
                .join("registrations", "surveys.registrationid", "registrations.registrationid")
                .join("eventoccurrences", "registrations.eventoccurrenceid", "eventoccurrences.occurrenceid")
                .where("registrations.participantid", participant.participantid)
                .select(
                    "surveys.*",
                    "eventoccurrences.eventname",
                    "eventoccurrences.eventdatetimestart"
                )
                .then((userSurveys) => {
                    const submittedRegistrationIds = userSurveys.map(s => s.registrationid);

                    // Get past events user attended but hasn't submitted a survey for
                    knex("registrations")
                        .select(
                            "registrations.registrationid",
                            "eventoccurrences.occurrenceid",
                            "eventoccurrences.eventname",
                            "eventoccurrences.eventdatetimestart",
                            "eventoccurrences.eventdatetimeend"
                        )
                        .join("eventoccurrences", "registrations.eventoccurrenceid", "eventoccurrences.occurrenceid")
                        .where("registrations.participantid", participant.participantid)
                        .andWhere("registrations.registrationattendedflag", true)
                        .andWhere("eventoccurrences.eventdatetimeend", "<", new Date())
                        .whereNotIn("registrations.registrationid", submittedRegistrationIds)
                        .then((events) => {
                            const errorMsg = events.length === 0 && userSurveys.length === 0 ?
                                "You have no past events to submit a survey for." :
                                null;
                            const successMsg = req.session.success || null;
                            req.session.success = null; // clear after rendering

                            res.render("userSurveys", {
                                events,
                                userSurveys,
                                error: errorMsg,
                                success: successMsg
                            });
                        })
                        .catch((err) => {
                            console.error("Error fetching past events:", err);
                            res.render("userSurveys", { events: [], userSurveys, error: "Error loading events", success: null });
                        });
                })
                .catch((err) => {
                    console.error("Error fetching submitted surveys:", err);
                    res.render("userSurveys", { events: [], userSurveys: [], error: "Error loading surveys", success: null });
                });
        })
        .catch((err) => {
            console.error("Error fetching participant:", err);
            res.render("userSurveys", { events: [], userSurveys: [], error: "Error loading participant", success: null });
        });
});





app.post("/userSurveys/submit", requireLogin, (req, res) => {
    const { registrationid, satisfactionscore, usefulnessscore, instructorscore, recommendationscore, comments } = req.body;

    const scores = [
        Number(satisfactionscore),
        Number(usefulnessscore),
        Number(instructorscore),
        Number(recommendationscore)
    ];

    const invalidScore = scores.some(score => score < 1 || score > 5 || isNaN(score));
    if (invalidScore) {
        req.session.success = null;
        req.session.error = "Scores must be between 1 and 5.";
        return res.redirect("/userSurveys");
    }

    const overallScore = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2);

    knex("surveys")
        .insert({
            registrationid: registrationid,
            surveysatisfactionscore: scores[0],
            surveyusefulnessscore: scores[1],
            surveyinstructorscore: scores[2],
            surveyrecommendationscore: scores[3],
            surveyoverallscore: overallScore,
            surveycomments: comments || null
        })
        .then(() => {
            req.session.success = "Survey submitted successfully!";
            req.session.error = null;
            res.redirect("/userSurveys");
        })
        .catch((err) => {
            console.error("Survey submission error:", err);
            req.session.success = null;
            req.session.error = "Survey submission failed. Please try again.";
            res.redirect("/userSurveys");
        });
});

//user survey delete
app.post("/userSurveys/delete/:id", requireLogin, (req, res) => {
    const surveyId = req.params.id;

    knex("surveys")
        .where("surveyid", surveyId)
        .del()
        .then(() => {
            req.session.success = "Survey deleted successfully!";
            req.session.error = null;
            res.redirect("/userSurveys");
        })
        .catch(err => {
            console.error("Error deleting survey:", err);
            req.session.error = "Could not delete survey.";
            req.session.success = null;
            res.redirect("/userSurveys");
        });
});


// GET /userMilestones - show the form AND the user's milestones
app.get("/userMilestones", requireLogin, (req, res) => {
    knex("participants")
        .where({ participantemail: req.session.userEmail })
        .first()
        .then(participant => {
            if (!participant) {
                return res.render("userMilestones", {
                    success: null,
                    error: "Participant not found.",
                    userMilestones: [] // prevent EJS crash
                });
            }

            return knex("milestones")
                .where({ participantid: participant.participantid })
                .orderBy("milestonedate", "desc");
        })
        .then(userMilestones => {
            res.render("userMilestones", {
                success: req.query.success || null,
                error: req.query.error || null,
                userMilestones: userMilestones || [] // always send array
            });
        })
        .catch(err => {
            console.error("Error loading milestones:", err);
            res.render("userMilestones", {
                success: null,
                error: "Failed to load milestones.",
                userMilestones: [] // prevent EJS crash
            });
        });
});


// POST /userMilestones/add - add a milestone
app.post("/userMilestones/add", requireLogin, (req, res) => {
    const { title, date } = req.body;
    const participantEmail = req.session.userEmail;

    // Find the participant first
    knex("participants")
        .where({ participantemail: participantEmail })
        .first()
        .then(participant => {
            if (!participant) {
                return res.render("userMilestones", {
                    success: null,
                    error: "Participant not found. Please register for the program first."
                });
            }

            // Insert the milestone
            return knex("milestones")
                .insert({
                    participantid: participant.participantid,
                    milestonedate: date,
                    milestonetitle: title
                })
                .then(() => {
                    res.render("userMilestones", {
                        success: "Milestone added successfully!",
                        error: null
                    });
                });
        })
        .catch(err => {
            console.error("Add milestone error:", err);
            res.render("userMilestones", {
                success: null,
                error: "Failed to add milestone. Please try again."
            });
        });
});




// DASHBOARD
app.get("/dashboard", requireLogin, (req, res) => {
    res.render("dashboard");
});

// MANAGER - PARTICIPANTS
app.get("/participants", requireManager, (req, res) => {
    knex("participants")
        .select("*")
        .orderBy("participantlastname", "asc")
        .then(participants => {

            const formattedParticipants = participants.map(p => {
                const dob = p.participantdob ?
                    new Date(p.participantdob).toISOString().split("T")[0] :
                    "";

                const phone = p.participantphone && p.participantphone.length === 10 ?
                    `(${p.participantphone.slice(0,3)}) ${p.participantphone.slice(3,6)}-${p.participantphone.slice(6)}` :
                    p.participantphone;

                return {
                    ...p,
                    formattedDob: dob,
                    formattedPhone: phone,
                    participantrole: p.participantrole || 'participant' // default
                };
            });

            res.render("participants", {
                participants: formattedParticipants,
                success: req.query.success || null
            });
        })
        .catch(err => {
            console.error("Participants error:", err);
            res.render("participants", { participants: [], success: req.query.success || null });
        });
});

// add participant
app.post("/participants/add", requireManager, async(req, res) => {
    let { firstname, lastname, email, dob, phone, city, state, zip, school, field, role } = req.body;

    if (phone) phone = phone.replace(/\D/g, "");
    if (phone && phone.length !== 10) return res.redirect("/participants?success=errorPhone");

    try {
        // Insert participant
        await knex("participants").insert({
            participantfirstname: firstname,
            participantlastname: lastname,
            participantemail: email,
            participantdob: dob || null,
            participantphone: phone || null,
            participantcity: city || null,
            participantstate: state || null,
            participantzip: zip || null,
            participantschooloremployer: school || null,
            participantfieldofinterest: field || null,
            participantrole: role || 'participant'
        });

        // Insert or update user role
        const userRole = role === 'admin' ? 'M' : 'U';
        const existingUser = await knex("users").where({ useremail: email }).first();
        if (existingUser) {
            await knex("users").where({ useremail: email }).update({ userrole: userRole });
        } else {
            await knex("users").insert({
                useremail: email,
                username: email.split('@')[0],
                userpassword: 'changeme123',
                userfirstname: firstname,
                userlastname: lastname,
                userrole: userRole
            });
        }

        res.redirect("/participants?success=added");
    } catch (err) {
        console.error("Add participant error:", err);
        res.redirect("/participants?success=error");
    }
});



// MANAGER - UPDATE PARTICIPANT
app.post("/participants/edit/:id", requireManager, async(req, res) => {
    const participantId = req.params.id;
    const { firstname, lastname, email, phone, dob, city, state, zip, school, field, totaldonations, role } = req.body;

    try {
        await knex("participants").where({ participantid: participantId }).update({
            participantfirstname: firstname,
            participantlastname: lastname,
            participantemail: email.toLowerCase(),
            participantphone: phone ? phone.replace(/\D/g, "").slice(0, 10) : null,
            participantdob: dob || null,
            participantcity: city || null,
            participantstate: state || null,
            participantzip: zip || null,
            participantschooloremployer: school || null,
            participantfieldofinterest: field || null,
            totaldonations: totaldonations || 0,
            participantrole: role
        });

        // Sync with users table
        const userRole = role === 'admin' ? 'M' : 'U';
        await knex("users").where({ useremail: email.toLowerCase() }).update({ userrole: userRole });

        res.redirect("/participants");
    } catch (err) {
        console.error("Update participant error:", err);
        res.status(500).send("Failed to update participant");
    }
});


// MANAGER - DELETE PARTICIPANT
app.post("/participants/delete/:id", requireManager, (req, res) => {
    const participantId = req.params.id;

    knex("participants")
        .where({ participantid: participantId })
        .del()
        .then(() => {
            res.redirect("/participants?success=deleted");
        })
        .catch((err) => {
            console.error("Delete participant error:", err);
            res.status(500).send("Failed to delete participant");
        });
});


// manager registrations
// MANAGER - REGISTRATIONS
app.get("/registrations", requireManager, (req, res) => {
    const search = req.query.search ? req.query.search.trim() : "";
    const offset = parseInt(req.query.offset) || 0;
    const limit = 200; // load 200 rows at a time

    let query = knex("registrations as r")
        .leftJoin("participants as p", "p.participantid", "r.participantid")
        .leftJoin("eventoccurrences as e", "e.occurrenceid", "r.eventoccurrenceid")
        .select(
            "r.*",
            "p.participantfirstname",
            "p.participantlastname",
            "e.eventname"
        )
        .orderBy("r.registrationcreatedat", "desc")
        .limit(limit)
        .offset(offset);

    if (search) {
        query = query.where(function() {
            this.whereRaw("LOWER(p.participantfirstname || ' ' || p.participantlastname) LIKE ?", [`%${search.toLowerCase()}%`])
                .orWhereRaw("LOWER(e.eventname) LIKE ?", [`%${search.toLowerCase()}%`]);
        });
    }

    query.then(registrations => {
            // Format check-in time for <input type="datetime-local">
            const formatted = registrations.map(r => {
                return {
                    ...r,
                    formattedCheckIn: r.registrationcheckintime ?
                        new Date(r.registrationcheckintime).toISOString().slice(0, 16) :
                        ""
                };
            });

            // Get participants for Add Modal
            knex("participants")
                .orderBy("participantlastname")
                .then(participants => {
                    // Get events for Add Modal
                    knex("eventoccurrences")
                        .orderBy("eventdatetimestart", "desc")
                        .then(events => {
                            res.render("registrations", {
                                registrations: formatted,
                                participants,
                                events,
                                offset,
                                limit,
                                search,
                                success: req.query.success || null
                            });
                        });
                });
        })
        .catch(err => {
            console.error("Registrations fetch error:", err);
            res.render("registrations", {
                registrations: [],
                participants: [],
                events: [],
                offset: 0,
                limit,
                search: "",
                success: null
            });
        });
});




//add registration
app.post("/registrations/add", requireManager, (req, res) => {
    const { participantid, eventid } = req.body;

    knex("registrations")
        .insert({
            participantid,
            eventoccurrenceid: eventid
        })
        .then(() => {
            res.redirect("/registrations?success=added");
        })
        .catch(err => {
            console.error("Add registration error:", err);
            res.redirect("/registrations?success=error");
        });
});


//edit registration
app.post("/registrations/edit/:id", requireManager, (req, res) => {
    const id = req.params.id;
    const { status, attendedflag, checkin } = req.body;

    knex("registrations")
        .where({ registrationid: id })
        .update({
            registrationstatus: status || null,
            registrationattendedflag: attendedflag === "" ? null : attendedflag === "true",
            registrationcheckintime: checkin || null
        })
        .then(() => {
            res.redirect("/registrations?success=edited");
        })
        .catch(err => {
            console.error("Edit registration error:", err);
            res.status(500).send("Failed to update registration");
        });
});

//delete registration
app.post("/registrations/delete/:id", requireManager, (req, res) => {
    const id = req.params.id;

    knex("registrations")
        .where({ registrationid: id })
        .del()
        .then(() => {
            res.redirect("/registrations?success=deleted");
        })
        .catch(err => {
            console.error("Delete registration error:", err);
            res.status(500).send("Failed to delete registration");
        });
});


// MANAGER - SURVEYS PAGE
// MANAGER - SURVEYS PAGE WITH SEARCH + PAGINATION
app.get("/surveys", requireManager, (req, res) => {
    const search = req.query.search ? req.query.search.trim() : "";
    const offset = parseInt(req.query.offset) || 0;
    const limit = 200; // load 200 surveys at a time

    let query = knex("surveys")
        .select(
            "surveys.*",
            "participants.participantfirstname",
            "participants.participantlastname",
            "eventoccurrences.eventname"
        )
        .join("registrations", "surveys.registrationid", "registrations.registrationid")
        .join("participants", "registrations.participantid", "participants.participantid")
        .leftJoin("eventoccurrences", "registrations.eventoccurrenceid", "eventoccurrences.occurrenceid")
        .orderBy("surveys.surveysubmissiondate", "desc")
        .limit(limit)
        .offset(offset);

    if (search) {
        query = query.where(function() {
            this.whereRaw("LOWER(participants.participantfirstname || ' ' || participants.participantlastname) LIKE ?", [`%${search.toLowerCase()}%`])
                .orWhereRaw("LOWER(eventoccurrences.eventname) LIKE ?", [`%${search.toLowerCase()}%`])
                .orWhereRaw("CAST(surveys.surveysubmissiondate AS TEXT) LIKE ?", [`%${search}%`]);
        });
    }

    query.then(surveys => {
            // Fetch registrations for Add Survey dropdown
            knex("registrations")
                .select(
                    "registrations.registrationid",
                    "participants.participantfirstname",
                    "participants.participantlastname",
                    "eventoccurrences.eventname"
                )
                .join("participants", "registrations.participantid", "participants.participantid")
                .leftJoin("eventoccurrences", "registrations.eventoccurrenceid", "eventoccurrences.occurrenceid")
                .then(registrations => {
                    res.render("surveys", {
                        surveys,
                        registrations,
                        offset,
                        limit,
                        search
                    });
                })
                .catch(err => {
                    console.error("Registrations fetch error:", err);
                    res.render("surveys", { surveys, registrations: [], offset, limit, search });
                });
        })
        .catch(err => {
            console.error("Surveys fetch error:", err);
            res.render("surveys", { surveys: [], registrations: [], offset: 0, limit, search: "" });
        });
});


// ADD SURVEY
app.post("/surveys/add", requireManager, (req, res) => {
    const { registrationid, satisfactionscore, usefulnessscore, instructorscore, recommendationscore, comments } = req.body;

    const scores = [satisfactionscore, usefulnessscore, instructorscore, recommendationscore].map(Number);
    const overallScore = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2);

    knex("surveys")
        .insert({
            registrationid: registrationid,
            surveysatisfactionscore: satisfactionscore,
            surveyusefulnessscore: usefulnessscore,
            surveyinstructorscore: instructorscore,
            surveyrecommendationscore: recommendationscore,
            surveyoverallscore: overallScore,
            surveycomments: comments || null
        })
        .then(() => {
            res.redirect("/surveys");
        })
        .catch((err) => {
            console.error("Add survey error:", err);
            res.status(500).send("Failed to add survey");
        });
});

// EDIT SURVEY
app.post("/surveys/edit/:id", requireManager, (req, res) => {
    const { id } = req.params;
    const { satisfactionscore, usefulnessscore, instructorscore, recommendationscore, comments } = req.body;

    const scores = [satisfactionscore, usefulnessscore, instructorscore, recommendationscore].map(Number);
    const overallScore = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2);

    knex("surveys")
        .where("surveyid", id)
        .update({
            surveysatisfactionscore: satisfactionscore,
            surveyusefulnessscore: usefulnessscore,
            surveyinstructorscore: instructorscore,
            surveyrecommendationscore: recommendationscore,
            surveyoverallscore: overallScore,
            surveycomments: comments || null
        })
        .then(() => {
            res.redirect("/surveys");
        })
        .catch((err) => {
            console.error("Edit survey error:", err);
            res.status(500).send("Failed to edit survey");
        });
});

// DELETE SURVEY
app.post("/surveys/delete/:id", requireManager, (req, res) => {
    const { id } = req.params;

    knex("surveys")
        .where("surveyid", id)
        .del()
        .then(() => {
            res.redirect("/surveys");
        })
        .catch((err) => {
            console.error("Delete survey error:", err);
            res.status(500).send("Failed to delete survey");
        });
});



// MANAGER - MILESTONES LIST
// ------------------------------
// MILESTONES PAGE (View)
// ------------------------------
app.get("/milestones", requireLogin, (req, res) => {
    const isManager = req.session.userRole === "M";
    const limit = 100;
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.search || '';

    let query = knex("milestones")
        .select(
            "milestones.*",
            "participants.participantfirstname",
            "participants.participantlastname"
        )
        .join("participants", "milestones.participantid", "participants.participantid")
        .orderBy("milestones.milestonedate", "desc")
        .limit(limit)
        .offset(offset);

    if (search) {
        query = query.where(function() {
            this.where("participants.participantfirstname", "ilike", `%${search}%`)
                .orWhere("participants.participantlastname", "ilike", `%${search}%`)
                .orWhere("milestones.milestonetitle", "ilike", `%${search}%`)
                .orWhereRaw("to_char(milestones.milestonedate, 'YYYY-MM-DD') ilike ?", [`%${search}%`]);
        });
    }

    query
        .then((milestones) => {
            knex("participants")
                .select("*")
                .orderBy("participantlastname", "asc")
                .then((participants) => {
                    res.render("milestones", { milestones, participants, isManager, limit, offset, search });
                })
                .catch((err) => {
                    console.error("Error fetching participants:", err);
                    res.render("milestones", { milestones, participants: [], isManager, limit, offset, search });
                });
        })
        .catch((err) => {
            console.error("Error fetching milestones:", err);
            res.render("milestones", { milestones: [], participants: [], isManager, limit, offset, search });
        });
});



// ------------------------------
// ADD MILESTONE (Manager Only)
// ------------------------------
app.post("/milestones/add", requireLogin, (req, res) => {
    const isManager = req.session.userRole === "M";
    if (!isManager) return res.status(403).send("Access denied.");

    const { participantid, title, date } = req.body;

    if (!participantid || !title || !date) {
        return res.status(400).send("All fields are required.");
    }

    knex("milestones")
        .insert({
            participantid,
            milestonetitle: title,
            milestonedate: date
        })
        .then(() => res.redirect("/milestones"))
        .catch((err) => {
            console.error("Error adding milestone:", err);
            res.status(500).send("Failed to add milestone.");
        });
});


// ------------------------------
// EDIT MILESTONE (Manager Only)
// ------------------------------
app.post("/milestones/edit/:id", requireLogin, (req, res) => {
    const isManager = req.session.userRole === "M";
    if (!isManager) return res.status(403).send("Access denied.");

    const milestoneId = req.params.id;
    const { participantid, title, date } = req.body;

    if (!participantid || !title || !date) {
        return res.status(400).send("All fields are required.");
    }

    knex("milestones")
        .where("milestoneid", milestoneId)
        .update({
            participantid,
            milestonetitle: title,
            milestonedate: date
        })
        .then(() => res.redirect("/milestones"))
        .catch((err) => {
            console.error("Error updating milestone:", err);
            res.status(500).send("Failed to update milestone.");
        });
});


// ------------------------------
// DELETE MILESTONE (Manager Only)
// ------------------------------
app.post("/milestones/delete/:id", requireLogin, (req, res) => {
    const isManager = req.session.userRole === "M";
    if (!isManager) return res.status(403).send("Access denied.");

    const milestoneId = req.params.id;

    knex("milestones")
        .where("milestoneid", milestoneId)
        .del()
        .then(() => res.redirect("/milestones"))
        .catch((err) => {
            console.error("Error deleting milestone:", err);
            res.status(500).send("Failed to delete milestone.");
        });
});

// ------------------------------
// MANAGER - EVENTS LIST
// ------------------------------
app.get("/managerEvents", requireLogin, (req, res) => {
    const isManager = req.session.userRole === "M";
    if (!isManager) return res.status(403).send("Access denied.");

    const success = req.query.success; // <-- get success from query string

    // Fetch all events
    knex("eventoccurrences")
        .orderBy("eventdatetimestart", "desc")
        .then(events => {
            // Fetch all templates for dropdown
            knex("eventtemplates")
                .orderBy("eventname", "asc")
                .then(templates => {
                    res.render("managerEvents", {
                        events,
                        templates,
                        isManager,
                        success // <-- pass it to EJS
                    });
                })
                .catch(err => {
                    console.error("Error fetching templates:", err);
                    res.render("managerEvents", {
                        events,
                        templates: [],
                        isManager,
                        success
                    });
                });
        })
        .catch(err => {
            console.error("Error fetching events:", err);
            res.render("managerEvents", {
                events: [],
                templates: [],
                isManager,
                success
            });
        });
});


// ADD EVENT
app.post("/managerEvents/add", requireLogin, (req, res) => {
    const isManager = req.session.userRole === "M";
    if (!isManager) return res.status(403).send("Access denied.");

    const {
        templateid,
        eventname,
        eventdatetimestart,
        eventdatetimeend,
        eventlocation,
        eventcapacity,
        eventregistrationdeadline
    } = req.body;

    if (!templateid || !eventname || !eventdatetimestart || !eventdatetimeend) {
        return res.status(400).send("Template, event name, and dates are required.");
    }

    knex("eventoccurrences")
        .insert({
            templateid,
            eventname,
            eventdatetimestart,
            eventdatetimeend,
            eventlocation: eventlocation || "",
            eventcapacity: eventcapacity || 30,
            eventregistrationdeadline: eventregistrationdeadline || null
        })
        .then(() => res.redirect("/managerEvents?success=added"))
        .catch(err => {
            console.error("Error adding event:", err);
            res.status(500).send("Failed to add event.");
        });
});

// EDIT EVENT
app.post("/managerEvents/edit/:id", requireLogin, (req, res) => {
    const isManager = req.session.userRole === "M";
    if (!isManager) return res.status(403).send("Access denied.");

    const occurrenceid = req.params.id;
    const { eventname, eventdatetimestart, eventdatetimeend, eventlocation, eventcapacity, eventregistrationdeadline } = req.body;

    if (!eventname || !eventdatetimestart || !eventdatetimeend) {
        return res.status(400).send("Event name and dates are required.");
    }

    knex("eventoccurrences")
        .where("occurrenceid", occurrenceid)
        .update({
            eventname,
            eventdatetimestart,
            eventdatetimeend,
            eventlocation: eventlocation || "",
            eventcapacity: eventcapacity || 30,
            eventregistrationdeadline: eventregistrationdeadline || null
        })
        .then(() => res.redirect("/managerEvents?success=edited"))
        .catch(err => {
            console.error("Error updating event:", err);
            res.status(500).send("Failed to update event.");
        });
});

// DELETE EVENT
app.post("/managerEvents/delete/:id", requireLogin, (req, res) => {
    const isManager = req.session.userRole === "M";
    if (!isManager) return res.status(403).send("Access denied.");

    const occurrenceid = req.params.id;

    knex("eventoccurrences")
        .where("occurrenceid", occurrenceid)
        .del()
        .then(() => res.redirect("/managerEvents?success=deleted"))
        .catch(err => {
            console.error("Error deleting event:", err);
            res.status(500).send("Failed to delete event.");
        });
});


// MANAGER - USERS
app.get("/users", requireManager, (req, res) => {
    const search = req.query.search || "";

    knex("users")
        .leftJoin("participants", function() {
            this.on(knex.raw('LOWER(users.useremail)'), '=', knex.raw('LOWER(participants.participantemail)'));
        })
        .leftJoin("donations", "participants.participantid", "donations.participantid")
        .modify((query) => {
            if (search) {
                query.where((qb) => {
                    qb.where("users.useremail", "ilike", `%${search}%`)
                        .orWhere("users.username", "ilike", `%${search}%`);
                });
            }
        })
        .select(
            "users.userid",
            "users.useremail",
            "users.username",
            "users.userrole",
            "participants.participantid",
            "participants.participantfirstname",
            "participants.participantlastname",
            "participants.participantemail",
            knex.raw("COALESCE(SUM(donations.donationamount), 0) AS totaldonations")
        )
        .groupBy(
            "users.userid",
            "users.useremail",
            "users.username",
            "users.userrole",
            "participants.participantid",
            "participants.participantfirstname",
            "participants.participantlastname",
            "participants.participantemail"
        )
        .orderBy("users.useremail", "asc")
        .then((users) => {
            console.log("Users fetched:", users); // <-- debug output
            res.render("users", { users, search });
        })
        .catch((err) => {
            console.error("Users error:", err);
            res.render("users", { users: [], search });
        });
});



// ADD USER
app.post("/users/add", requireManager, (req, res) => {
    const { firstname, lastname, email, password, username, role } = req.body;

    // Convert role to single-char for DB
    const dbRole = role === "Manager" ? "M" : "U";
    const participantRole = role === "Manager" ? "admin" : "participant";

    // Insert user
    knex("users")
        .insert({
            userfirstname: firstname,
            userlastname: lastname,
            username: username,
            useremail: email,
            userpassword: password, // plain text
            userrole: dbRole
        })
        .then(() => {
            // Insert corresponding participant with matching participantrole
            return knex("participants").insert({
                participantfirstname: firstname,
                participantlastname: lastname,
                participantemail: email,
                participantrole: participantRole,
                totaldonations: 0
            });
        })
        .then(() => res.redirect("/users"))
        .catch((err) => {
            console.error("Add user error:", err);
            res.status(500).send("Failed to add user");
        });
});




// EDIT USER
app.post("/users/edit", requireManager, (req, res) => {
    const { userid, firstname, lastname, email, username, role } = req.body;

    const dbRole = role === "Manager" ? "M" : "U";
    const participantRole = role === "Manager" ? "admin" : "participant";

    // Update user first
    knex("users")
        .where({ userid })
        .update({
            userfirstname: firstname,
            userlastname: lastname,
            username: username,
            useremail: email,
            userrole: dbRole
        })
        .then(() => {
            // Update participant with matching email and sync role
            return knex("participants")
                .where({ participantemail: email })
                .update({
                    participantfirstname: firstname,
                    participantlastname: lastname,
                    participantemail: email,
                    participantrole: participantRole
                });
        })
        .then(() => res.redirect("/users"))
        .catch((err) => {
            console.error("Edit user error:", err);
            res.status(500).send("Failed to update user");
        });
});




// DELETE USER
app.post("/users/delete/:id", requireManager, (req, res) => {
    knex("users")
        .where({ userid: req.params.id })
        .del()
        .then(() => res.redirect("/users"))
        .catch((err) => {
            console.error("Delete user error:", err);
            res.status(500).send("Failed to delete user");
        });
});

// MANAGER/ADMIN - View single participant
app.get("/participants/:id", requireManager, (req, res) => {
    const participantId = req.params.id;

    knex("participants")
        .where({ participantid: participantId })
        .first()
        .then((participant) => {
            if (!participant) {
                return res.status(404).send("Participant not found");
            }

            // Optionally, fetch total donations
            knex("donations")
                .where({ participantid: participantId })
                .sum("donationamount as totaldonations")
                .first()
                .then((donation) => {
                    participant.totaldonations = donation.totaldonations || 0;

                    res.render("participantDetails", { participant });
                })
                .catch((err) => {
                    console.error("Error fetching donations:", err);
                    participant.totaldonations = 0;
                    res.render("participantDetails", { participant });
                });
        })
        .catch((err) => {
            console.error("Error fetching participant:", err);
            res.status(500).send("Error loading participant");
        });
});



// PORT (Required by EB)
const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
    console.log(`Ella Rises server running on port ${PORT}`);
});