require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');
const cors = require('cors');
const corsOptions = require('./config/corsOptions');
const { logger } = require('./middleware/logEvents');
const errorHandler = require('./middleware/errorHandler');
// const verifyJWT = require('./middleware/verifyJWT');
const cookieParser = require('cookie-parser');
const credentials = require('./middleware/credentials');
const mongoose = require('mongoose');
const connectDB = require('./config/dbConn');
const PORT = process.env.PORT || 3500;

mongoose.set('strictQuery', false);
// Connect to MongoDB
connectDB();

// custom middleware logger
app.use(logger);

// Handle options credentials check - before CORS!
// and fetch cookies credentials requirement
app.use(credentials);

// Cross Origin Resource Sharing
app.use(cors(corsOptions));

// built-in middleware to handle urlencoded form data
app.use(express.urlencoded({ extended: false }));

// built-in middleware for json 
app.use(express.json());

//middleware for cookies
app.use(cookieParser());

// No auth guard is mounted. `middleware/verifyJWT` and `verifyRoles` are kept
// and deliberately left unmounted: SR001 and SR005 require RBAC before a
// clinician sees a prompt, and an unmounted guard is visible here where someone
// reading the routes will find it. A guard that is present but permissive is not.
// app.use(verifyJWT);

// The whole API. The dashboard reads everything through here; scoring happens in
// the model service and this layer stores what it returns.
app.use('/api', require('./routes/api/assessment'));

app.all('*', (req, res) => {
    res.status(404);
    if (req.accepts('html')) {
        res.sendFile(path.join(__dirname, 'views', '404.html'));
    } else if (req.accepts('json')) {
        res.json({ "error": "404 Not Found" });
    } else {
        res.type('txt').send("404 Not Found");
    }
});

app.use(errorHandler);

// Backstop. Node exits the process on an unhandled rejection, so one bad
// request in an unwrapped handler takes every bed off the board.
process.on('unhandledRejection', (reason) => {
    console.error('unhandled rejection:', reason);
});

mongoose.connection.once('open', () => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});