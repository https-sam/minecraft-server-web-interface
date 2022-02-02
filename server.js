if(process.env.NODE_ENV !== 'production') { // load env file
    require('dotenv').config();
}


const express = require('express');
const mysql = require('mysql2');
const app = express();
const PORT = 3000;
const bcrypt = require('bcrypt');
const passport = require('passport');
const initializePassport = require('./passport-config.js');
const flash = require('express-flash');
const session = require('express-session');
const { response } = require('express');
const methodOverride = require('method-override');
const exec = require("child_process").execSync;
const { get } = require('http');
const fetch = require('node-fetch');
const { render } = require('ejs');
const schedule = require('node-schedule');


let prop_names = [ // dictionary, used for updating server.properties | add more keywords here to add more inputs in control panel
     'enable-command-block',
     'pvp',
     'difficulty',
     'max-players',
     'allow-flight',
     'view-distance',
     'server-port',
     'op-permission-level',
     'hide-online-players',
     'simulation-distance', 
     'hardcore', 
     'spawn-monsters',
]

let currentPropValues = [];
let valueTracker = [];


const getServerProp = () => { // retrives current values of server.properties
    return new Promise((resolve, reject) => {
        fetch('http://10.0.0.253:3005/fetch-props', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }, 
            }) 
            .then(res => res.json())
            .then(data => { 
                for(let i = 0; i < prop_names.length; i++) {
                    const key = String.fromCharCode(i+97);
                    let row = [prop_names[i], data[key]];
                    currentPropValues.push(row);
                }
                resolve();
            })
            .catch(err => reject('Unable to conect to server to fetch prop file'))
    });
}



const UpdateServerProp = (option, value) => {
    // updates a value of a spceified option => sends a query through ssh
    const query = `${process.env.SSH} "sed -i '/^${option}/ c\ ${option}=${value}' ${process.env.FILE_PATH}"`;
    // console.log(query);
    exec(query, (error, stdout, stderr) => { 
        if (error) {
            console.log(`error: ${error.message}`); // error
            return;
        }
        if (stderr) {
            console.log(`stderr: ${stderr}`);
            return;
        }
        // console.log(stdout);
    });
}

// SERVER ON: returns "There is a screen on:"
// SERVER OFF: returns "No Sockets found"

const getServerStatus = () => { // returns result of of screen -ls
    return fetch('http://10.0.0.253:3005/fetch-status', {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
    })
    .then(res => {
        return res.json();
    })
    .then(data => {
        return data.status;
    })
    .catch(err => { // it catches when fatch fails (server is off)
        return 'OFF'; 
    });
};

// create connection to sql server
const db = mysql.createConnection({
    host     : process.env.SQL_HOST,
    user     : process.env.SQL_USER,
    password : process.env.SQL_PASS,
    database : process.env.SQL_DATABASE
});



db.connect((err) => {
    if(err) {
        console.log('ERRORR')
        throw err;
    }
    else
    console.log('[+] Database connected');
});

const jobConnectSql = schedule.scheduleJob('0 12 * * *', function(){
    db.connect((err) => {
        if(err) {
            console.log('ERRORR')
            throw err;
        }
        else
        console.log('[+] Database connected');
    });
});

const findUser = async (username) => {
    const query = `SELECT * from users WHERE username = '${username}';`;
    const result = await db.promise().query(query); // returns promise
    if(result[0].length == 0) return null; // user not found, return null
    return result[0];
}

const findUserByID = async (id) => {
    const query = `SELECT * from users WHERE uid = '${id}';`;
    const result = await db.promise().query(query);
    if(result[0].length == 0) return []; // user not found, return null
    return result[0];
}


initializePassport(passport, findUser, findUserByID);

app.set('view engine', 'ejs');
app.use(express.urlencoded({extended: false}));
app.use(flash());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(methodOverride('_method'));
app.use(express.static(__dirname + '/static/'));


 const fetchData = () => {
    return fetch('http://10.0.0.253:3005/fetch-ram-usage', {
        method: 'POST'
    })
    .then(response =>
        response.text().then(text => text.split(/\r|\n/)));
}


app.get('/', checkAuthenticated, async (req, res) => {
    const status = await getServerStatus()
    .then(data => data);

    let last24hRamUsage = [];
        await fetchData()
            .then(arr => last24hRamUsage = [...arr]) // copy array
            .catch(err => {
                
            })
    
    res.render('index.ejs', { 
        name: req.user.username,
        title: 'home',
        server_status: status,
        ramUsage: last24hRamUsage
    });
})

app.get('/control-panel', checkAuthenticated, async (req, res) => {
    await getServerProp() // retrives data from server.properties
    .catch(err => console.log(err)); // Unable to connect to server
    res.render('control-panel.ejs', { name: req.user.username, title:'control-p', data: currentPropValues});
    valueTracker = [...currentPropValues];
    currentPropValues = [];  // resets array
})

app.get('/logs', checkAuthenticated, async (req, res) => {
    let logs = [];
    await fetchLogs()
        .then(arr => {
            logs = [...arr]}) // copy array
        .catch(err => {
            console.log(err);
            // do nothing and let it render old data
        });
    res.render('logs.ejs', {title: 'logs', logData: logs});
})

app.get('/login', checkNotAuthenicated, (req, res) => {
    res.render('login.ejs');
})

app.get('/register', checkNotAuthenicated, (req, res) => {
    res.render('register.ejs', {err: ''});
})

app.post('/login', checkNotAuthenicated, passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/login',
    failureFlash: true
}));


const fetchLogs = () => {
    return fetch('http://10.0.0.253:3005/fetch-logs', {
        method: 'POST'
    })
    .then(response =>
        response.text().then(text => text.split(/\r|\n/)));
}


const checkIfUserExists = async (username) => { 
    const query = `SELECT COUNT(username) AS num from users where username = '${username}';`;
    const result = await db.promise().query(query);
    if(result[0][0].num == 0) return false; // user does not exist
    else return true; // user exists
}

app.post('/register', checkNotAuthenicated, async (req, res) => { // resgister request
   if(await checkIfUserExists(req.body.username)) { // user exists
        res.render('register.ejs', { err: 'Username Already Taken.'});
   }    
   else if(req.body.password != req.body.password_confirm) {
       res.render('register.ejs', {err: "The passwords didn't match. Try again."})
   }
   else if(req.body.code.replace(/\s/g, '') != process.env.REGISTER_CODE) { // register code invalid
        res.render('register.ejs', { err: 'Access Code Invalid.'}); 
   }
   else{
        try {
            const hashedPassword = await bcrypt.hash(req.body.password, 10); // salt -> 10
            const registerQuery = `INSERT INTO users(username, password) VALUES('${req.body.username}', '${hashedPassword}');`;
            db.query(registerQuery, (err) => {
                if(err) throw err;
            })
            res.redirect('/login');
        } catch(err) {
            console.log(err);
            res.redirect('/register');
        } 
    }
})

app.delete('/logout', (req, res) => {
    req.logOut(); // clear session
    res.redirect('/login');
})

app.post('/update-prop', (req, res) => {
    // searches for altered values and sends server a query to alter values
    // this algorithm saves time as ssh queries take some time
    // without this, it will try to update every value including unchanged values
    // so this part is cuisial 

   for(let i = 0; i < valueTracker.length; i++) { 
       if(valueTracker[i][1] != req.body[String.fromCharCode(i+97)]) { // uses asii codes for indecies
           UpdateServerProp(prop_names[i], req.body[String.fromCharCode(i+97)])
       }
   }
   valueTracker = [];
   res.redirect('/control-panel');
});

app.get('/server-restart', (req, res) => {
    fetch('http://10.0.0.253:3005/server-restart', {
                method: 'POST'
            })
            .then(response => {
                res.redirect('/');
            })
            .catch(err => {
                res.redirect('/');
            })
});

app.get('/server-stop', (req, res) => {
    fetch('http://10.0.0.253:3005/server-stop', {
                method: 'POST'
            })
            .then(response => {
                res.redirect('/');
            })
            .catch(err => {
                res.redirect('/');
            })
});

app.get('/server-start', (req, res) => { // need to send some error message to browser saying unable to connect to server
    fetch('http://10.0.0.253:3005/server-start', {
                method: 'POST'
            })
            .then(response => {
                res.redirect('/');
            })
            .catch(err => {
                res.redirect('/');
            })
});




function checkAuthenticated(req, res, next) {
    if(req.isAuthenticated()) {
        return next();
    }
    else {
        res.redirect('/login');
    }
}

function checkNotAuthenicated(req, res, next) {
    if(req.isAuthenticated()) {
        return res.redirect('/');
    }
    next();
}

app.listen(PORT, '0.0.0.0', () => {
    console.info(`App Ruuning on ${PORT}`);
})


