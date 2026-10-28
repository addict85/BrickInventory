package ch.brickinventoryapp.util

/*
 * Was die App mit einem 401 macht. Der Server antwortet auf ein fehlendes,
 * ungültiges und abgelaufenes Token gleich; beide Fragen hier — nachfassen?
 * melden? — entscheiden am selben Unterschied: Ging ein Token mit?
 */

/**
 * Eine mit 401 beantwortete Anfrage geht ein zweites Mal hinaus, jetzt mit Token,
 * wenn sie ohne Token an unseren Server ging und nur liest. Die Anmeldung setzt
 * den Token und feuert sofort Abrufe; einer kann ohne Kopf hinausgehen. Mit Kopf
 * abgewiesen ist der Token wirklich ungültig (das schliesst auch eine Schleife
 * aus); einen Login oder eine Schreibanfrage zu wiederholen zählte sie doppelt.
 */
fun darfNachfassen(
    status: Int,
    unserServer: Boolean,
    hatteAuthKopf: Boolean,
    methode: String,
): Boolean =
    status == 401 &&
        unserServer &&
        !hatteAuthKopf &&
        (methode == "GET" || methode == "HEAD")

/**
 * Ein 401, der die Anzeige erreicht, während die App angemeldet ist, ist schon
 * behandelt: Bei echtem Ablauf meldet der Interceptor ab, im Wettlauf beim
 * Anmelden hat darfNachfassen() nachgefasst. Der Abruf schweigt dann. Nicht
 * angemeldet heisst Anmeldeversuch — dort ist der Satz des Servers richtig.
 */
fun meldetDieSitzungsschicht(unauthorized: Boolean, angemeldet: Boolean): Boolean =
    unauthorized && angemeldet
