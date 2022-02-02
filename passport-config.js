const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');


 const initializePassport = (passport, getUserByUsername, getUserById) => {

    const authentificateUser = async (username, password, done) => {
        const user = await getUserByUsername(username);
        
        if (user == null) { // user not found
            return done(null, false, {message: 'User not Found or Incorrect Password'})
        }
        try {
            const pass = user[0].password; // hash password

            if (await bcrypt.compare(password, pass)) { // compare if entered pass is correct <---- error: not comparing correctly -->> see this page UPDATE
                return done(null, user[0]); // user found and authentificated
            } else { // password not mach
                return done(null, false, {message: 'User not Found or Incorrect Password'})
            }
        } catch(e) {
            return done(e);
        }
    }   
    passport.use(new LocalStrategy({ usernameField: 'username' }, authentificateUser))
    passport.serializeUser((user, done) => done(null, user.uid))
    passport.deserializeUser( async (id, done) => { // takes a promise so async
        authorizedUser = await getUserById(id);
        return await done(null, authorizedUser[0]); // if there is other info needed to be accesible, pass it here
    })
}


module.exports = initializePassport;