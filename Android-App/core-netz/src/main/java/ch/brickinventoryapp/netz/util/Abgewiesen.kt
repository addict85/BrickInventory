package ch.brickinventoryapp.netz.util

/*
 * What the app does with a 401. The server answers a missing, invalid and
 * expired token the same way; both questions here — retry? sign out? — are
 * decided by the same distinction: did a token go out with the request?
 */

/**
 * A request answered with 401 goes out a second time, now with a token, if it
 * went to our server without one and only reads. Signing in sets the token and
 * immediately fires requests; one can go out without a header. Rejected with a
 * header, the token is really invalid (which also rules out a loop); retrying
 * a login or a write request would count it twice.
 */
fun followUpMay(
    status: Int,
    ourServer: Boolean,
    hadAuthHeader: Boolean,
    methode: String,
): Boolean =
    status == 401 &&
        ourServer &&
        !hadAuthHeader &&
        (methode == "GET" || methode == "HEAD")

/**
 * A 401 that reaches the UI while the app is signed in is already handled: on
 * a real expiry the interceptor signs out, in the sign-in race followUpMay()
 * already retried. The request then stays silent. Not signed in means a
 * sign-in attempt — there the server's own sentence is the right one.
 */
fun reportsTheSessionLayer(unauthorized: Boolean, angemeldet: Boolean): Boolean =
    unauthorized && angemeldet
