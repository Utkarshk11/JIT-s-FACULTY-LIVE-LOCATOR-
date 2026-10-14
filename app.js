const express = require("express");
const app = express();
const mongoose = require("mongoose");
const path = require("path");
const methodOverride = require("method-override");
const ejsMate = require("ejs-mate");
const wrapAsync = require("./utils/wrapAsync.js");
const Teacher = require("./models/teacher.js");
const flash = require("connect-flash");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const { savedRedirectUrl } = require("./middleware.js");
const { isLoggedIn } = require("./middleware.js");
const http = require('http');  // **For Socket.io**
const socketIo = require('socket.io');

// **Create HTTP server**
const server = http.createServer(app);

// **Initialize Socket.io**
const io = socketIo(server);

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride("_method"));
app.engine("ejs", ejsMate);
app.use(express.static(path.join(__dirname, "/public")));

// MongoDB connection
const MONGO_URL = "mongodb+srv://vanshikakamatkar:vanshika08@cluster0.iih5w.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

async function main() {
    await mongoose.connect(MONGO_URL);
}

main().then(() => {
    console.log("Connected to DB");
}).catch((err) => {
    console.log(err);
});

const store = MongoStore.create({
    mongoUrl: "mongodb+srv://vanshikakamatkar:vanshika08@cluster0.iih5w.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0",
    crypto: {
        secret: "mysecretcode"
    },
    touchAfter: 24 * 3600
});

store.on("error", () => {
    console.log("Error in MONGO SESSION STORE", err);
})


// Session configuration
const sessionOptions = {
    store,
    secret: "mysupersecretcode",
    resave: false,
    saveUninitialized: true,
    cookie: {
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        httpOnly: true
    }
};

app.use(session(sessionOptions));
app.use(flash());

app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(Teacher.authenticate()));

passport.serializeUser(Teacher.serializeUser());
passport.deserializeUser(Teacher.deserializeUser());

app.use((req, res, next) => {
    res.locals.success = req.flash("success");
    res.locals.error = req.flash("error");
    res.locals.currTeacher = req.teacher;
    next();
});

// Static KML file route
app.get("/api/map", (req, res) => {
    res.sendFile(__dirname + "/public/assets/groundfloor.kml");
});

// Home route
app.get("/", (req, res) => {
    res.send("root");
});

// Home route
app.get("/home", (req, res) => {
    res.render("home.ejs");
});

// Teacher sign-up
app.get("/teacher", (req, res) => {
    res.render("signup.ejs");
});

app.post("/teacher", wrapAsync(async (req, res) => {
    try {
        const { username, email, password } = req.body;
        const newTeacher = new Teacher({ email, username });
        const registeredTeacher = await Teacher.register(newTeacher, password);
        req.flash("success", "Successfully registered!");
        res.redirect("/teacher/map");
    } catch (err) {
        req.flash("error", "Registration failed");
        res.redirect("/teacher");
    }
}));

// Teacher login routes
app.get("/teacher/login", (req, res) => {
    res.render("login.ejs");
});

app.post("/teacher/login", savedRedirectUrl,
    passport.authenticate("local", { failureRedirect: "/teacher/login", failureFlash: true }),
    async (req, res) => {
        req.flash("success", "Welcome back to Faculty's Live Locator");
        res.redirect("/teacher/map");
    }
);

// Teacher map route (faculty updates location)
app.get("/teacher/map", isLoggedIn, (req, res) => {
    res.render("map.ejs");
});

// Logout
app.get("/teacher/logout", (req, res, next) => {
    req.logout((err) => {
        if (err) {
            next(err);
        }
        req.flash("success", "You are logged out!");
        res.redirect("/home");
    });
});

// Route for teachers to update their location
app.post("/teacher/update-location", isLoggedIn, wrapAsync(async (req, res) => {
    const { lat, lng } = req.body;
    const teacherId = req.user._id;

    // Find the teacher by ID and update their location
    const updatedTeacher = await Teacher.findByIdAndUpdate(teacherId, {
        location: { lat, lng },
        lastUpdated: Date.now()
    }, { new: true });

    if (!updatedTeacher) {
        return res.status(404).json({ error: "Teacher not found" });
    }

    res.json({ success: "Location updated" });
}));


// **Socket.io for handling live location updates** (Added)
io.on('connection', (socket) => {
    console.log('New client connected');

    // Handle 'teacher-location' event for real-time updates
    socket.on('teacher-location', async (data) => {
        try {
            const { teacherId, latitude, longitude } = data;

            // Find the teacher by ID and update their location
            await Teacher.findByIdAndUpdate(teacherId, {
                location: { lat: latitude, lng: longitude },
                lastUpdated: Date.now()
            });

            console.log(`Updated location for teacher: ${teacherId}`);
            // Broadcast updated location to students
            io.emit('location-update', { teacherId, latitude, longitude });
        } catch (err) {
            console.error("Error updating teacher's location:", err);
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// **Route for students to see faculty locations** (Added)
app.get("/student", wrapAsync(async (req, res) => {
    const allTeachers = await Teacher.find({});
    res.render("studentInterface.ejs", { allTeachers });
}));

// **Get specific teacher's location for students** (Added)
app.get("/student/teacher-location/:id", wrapAsync(async (req, res) => {
    const teacherId = req.params.id;
    const teacher = await Teacher.findById(teacherId);

    if (!teacher) {
        return res.status(404).json({ error: "Teacher not found" });
    }

    // Return the current location of the faculty
    res.json({
        lat: teacher.location.lat,
        lng: teacher.location.lng,
        lastUpdated: teacher.lastUpdated
    });
}));

// Get KML URLs
app.get("/kml-urls", (req, res) => {
    const kmlUrls = [
        'https://drive.google.com/uc?export=download&id=1WYOUgJuTZSpiRpggPIeHjkD18H51Jmv8',
        'https://drive.google.com/uc?export=download&id=1zS0vEzjcY1H8e2v059XQS_CUg1U-2K1h'
    ];
    res.json(kmlUrls);
});

// Start the server and socket.io
server.listen(3000, () => {
    console.log("Server is listening on port 3000");
});
