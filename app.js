const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');

const app = express();

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');

// MongoDB Connection Configuration
const MONGODB_URI = 'mongodb+srv://lonbg5417:JNLelJ2sFp7WF4xN@cluster0.v04u9ap.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
})
.then(() => {
    console.log('Successfully connected to MongoDB Atlas.');
    console.log('Database:', MONGODB_URI);
    createInitialUsers(); // Create initial users after successful DB connection
})
.catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
});

// Handle MongoDB connection events
mongoose.connection.on('error', err => {
    console.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
    console.log('MongoDB disconnected');
});

// Handle application termination
process.on('SIGINT', async () => {
    try {
        await mongoose.connection.close();
        console.log('MongoDB connection closed through app termination');
        process.exit(0);
    } catch (err) {
        console.error('Error during MongoDB disconnection:', err);
        process.exit(1);
    }
});

// Session Configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'a_very_secret_key_th@t_sh0uld_be_l0ng_and_r@ndom', // Change this to an environment variable in production
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGODB_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day
}));

// Passport Configuration
app.use(passport.initialize());
app.use(passport.session());

// User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' }
});

const User = mongoose.model('User', userSchema);

passport.use(new LocalStrategy(
    async (username, password, done) => {
        try {
            const user = await User.findOne({ username: username });
            if (!user) {
                return done(null, false, { message: 'Incorrect username.' });
            }
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return done(null, false, { message: 'Incorrect password.' });
            }
            return done(null, user);
        } catch (err) {
            return done(err);
        }
    }
));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (err) {
        done(err);
    }
});

// Middleware to pass user to all views
app.use((req, res, next) => {
    res.locals.currentUser = req.user;
    next();
});

// Toy Schema
const toySchema = new mongoose.Schema({
    name: String,
    description: String,
    price: Number,
    image: String,
    category: String
});

const Toy = mongoose.model('Toy', toySchema);

// Function to create initial users
async function createInitialUsers() {
    try {
        const adminExists = await User.findOne({ username: 'admin' });
        if (!adminExists) {
            const hashedPassword = await bcrypt.hash('adminpassword', 10);
            await User.create({ username: 'admin', password: hashedPassword, role: 'admin' });
            console.log('Admin user created.');
        }

        const userExists = await User.findOne({ username: 'user' });
        if (!userExists) {
            const hashedPassword = await bcrypt.hash('userpassword', 10);
            await User.create({ username: 'user', password: hashedPassword, role: 'user' });
            console.log('Regular user created.');
        }
    } catch (error) {
        console.error('Error creating initial users:', error);
    }
}

// Middleware to check if user is authenticated
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    // Optionally, you can add a flash message here: req.flash('error_msg', 'Please log in to view this resource');
    res.redirect('/login');
}

function ensureAdmin(req, res, next) {
    if (req.isAuthenticated() && req.user.role === 'admin') {
        return next();
    }
    // Optionally, you can add a flash message here: req.flash('error_msg', 'You do not have permission to view this resource');
    res.redirect('/'); // Or a specific error page
}

// Routes
app.get('/', async (req, res) => {
    try {
        const toys = await Toy.find();
        res.render('index', { toys });
    } catch (err) {
        console.error('Error fetching toys:', err);
        res.status(500).send('Error loading toy items');
    }
});

// Registration Page
app.get('/register', (req, res) => {
    res.render('register'); // We will create this view next
});

app.post('/register', async (req, res) => {
    const { username, password, password2 } = req.body;
    let errors = [];

    if (!username || !password || !password2) {
        errors.push({ msg: 'Please enter all fields' });
    }

    if (password != password2) {
        errors.push({ msg: 'Passwords do not match' });
    }

    if (password.length < 6) {
        errors.push({ msg: 'Password must be at least 6 characters' });
    }

    if (errors.length > 0) {
        res.render('register', {
            errors,
            username,
            password,
            password2
        });
    } else {
        try {
            const user = await User.findOne({ username: username });
            if (user) {
                errors.push({ msg: 'Username already exists' });
                res.render('register', {
                    errors,
                    username,
                    password,
                    password2
                });
            } else {
                const newUser = new User({
                    username,
                    password,
                    // role will default to 'user' as per schema
                });
                const salt = await bcrypt.genSalt(10);
                const hash = await bcrypt.hash(newUser.password, salt);
                newUser.password = hash;
                await newUser.save();
                // req.flash('success_msg', 'You are now registered and can log in'); // Optional: if you add connect-flash
                res.redirect('/login');
            }
        } catch (err) {
            console.error(err);
            res.status(500).send('Server Error');
        }
    }
});

// Login Page
app.get('/login', (req, res) => {
    res.render('login'); // We will create this view next
});

app.post('/login', (req, res, next) => {
    passport.authenticate('local', {
        successRedirect: '/',
        failureRedirect: '/login',
        // failureFlash: true // Optional: if you add connect-flash
    })(req, res, next);
});

// Logout
app.get('/logout', (req, res, next) => {
    req.logout(function(err) {
        if (err) { return next(err); }
        // req.flash('success_msg', 'You are logged out'); // Optional: if you add connect-flash
        res.redirect('/');
    });
});

app.get('/add-toy', ensureAuthenticated, (req, res) => { // Protected route
    res.render('add-toy');
});

app.post('/add-toy', ensureAuthenticated, async (req, res) => { // Protected route
    try {
        const newToy = new Toy(req.body);
        await newToy.save();
        res.redirect('/');
    } catch (err) {
        console.error('Error adding toy:', err);
        res.status(500).send('Error adding toy item');
    }
});

// Edit Toy - GET (Show form)
app.get('/edit-toy/:id', ensureAdmin, async (req, res) => {
    try {
        const toy = await Toy.findById(req.params.id);
        if (!toy) {
            // req.flash('error_msg', 'Toy not found');
            return res.redirect('/');
        }
        res.render('edit-toy', { toy });
    } catch (err) {
        console.error('Error fetching toy for edit:', err);
        // req.flash('error_msg', 'Error loading toy for editing');
        res.redirect('/');
    }
});

// Edit Toy - POST (Handle update)
app.post('/edit-toy/:id', ensureAdmin, async (req, res) => {
    try {
        const { name, description, price, image, category } = req.body;
        await Toy.findByIdAndUpdate(req.params.id, { name, description, price, image, category });
        // req.flash('success_msg', 'Toy updated successfully');
        res.redirect('/');
    } catch (err) {
        console.error('Error updating toy:', err);
        // req.flash('error_msg', 'Error updating toy');
        res.redirect('/'); // Or back to edit page with error
    }
});

// Delete Toy - POST
app.post('/delete-toy/:id', ensureAdmin, async (req, res) => {
    try {
        await Toy.findByIdAndDelete(req.params.id);
        // req.flash('success_msg', 'Toy deleted successfully');
        res.redirect('/');
    } catch (err) {
        console.error('Error deleting toy:', err);
        // req.flash('error_msg', 'Error deleting toy');
        res.redirect('/');
    }
});

// Toy Detail Page - GET
app.get('/toy/:id', async (req, res) => {
    try {
        const toy = await Toy.findById(req.params.id);
        if (!toy) {
            // req.flash('error_msg', 'Toy not found');
            return res.status(404).send('Toy not found');
        }
        res.render('toy-detail', { toy });
    } catch (err) {
        console.error('Error fetching toy details:', err);
        // req.flash('error_msg', 'Error loading toy details');
        res.status(500).send('Server Error');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 