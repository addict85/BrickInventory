package ch.brickinventoryapp.util

/**
 * Darf eine mit 401 beantwortete Anfrage ein zweites Mal hinausgehen — mit Token?
 *
 * ── Marcos Befund vom 25.09. ────────────────────────────────────────────────
 *
 *   „Wenn ich mich in der Webapp einlogge, einen qr Code erzeuge und mit diesem
 *    in die App einlogge funktioniert es, es erscheint aber die Meldung, dass
 *    das token nicht gültig sei. Wenn ich einen 2. Qr Code generiere und
 *    nochmals einlogge erscheint die Meldung nicht mehr."
 *
 * ── Was belegt ist und was nicht ────────────────────────────────────────────
 *
 * Welche Anfrage den 401 bekam, liess sich ohne Logcat nicht feststellen. Das
 * steht hier ausdrücklich, weil der Unterschied zwischen „gemessen" und
 * „angenommen" nicht in einer Nacherzählung verschwinden soll.
 *
 * Belegt ist, was der Fall AUSSCHLIESST: Die App blieb angemeldet. Der
 * Interceptor meldet aber jeden 401 von unserem Server, bei dem ein Token
 * mitging, als abgelaufene Sitzung und meldet ab (AppModule.kt). Also ging die
 * Anfrage OHNE Authorization-Kopf hinaus — in dem Fenster zwischen „Token ist
 * da" und „Anfrage ist gebaut", das jede Anmeldung öffnet, weil sie den Token
 * setzt und unmittelbar danach die ersten Abrufe feuert.
 *
 * Statt die eine Stelle zu suchen, die es bei Marco war, behandelt die App die
 * FOLGE: Ein solcher 401 wird einmal wiederholt, sobald ein Token vorliegt.
 *
 * ── Warum die vier Bedingungen ──────────────────────────────────────────────
 *
 *   status == 401     Alles andere ist kein Anmeldeproblem.
 *
 *   unserServer       Ein 401 von einem fremden Host (Bild-CDN, BrickLink) geht
 *                     uns nichts an, und unser Token erst recht nicht.
 *
 *   !hatteKopf        Trug die Anfrage bereits einen Token und wurde trotzdem
 *                     abgewiesen, ist der Token wirklich ungültig. Wiederholen
 *                     hiesse, denselben Fehler zweimal zu machen. Diese
 *                     Bedingung schliesst zugleich jede Schleife aus: Der zweite
 *                     Anlauf TRÄGT den Kopf.
 *
 *   lesend            Ein 401 auf POST /auth/login heisst „falsches Passwort"
 *                     und ist keine Wettlaufsituation. Ihn zu wiederholen hiesse,
 *                     einen Anmeldeversuch doppelt zu zählen — gegen die Drossel
 *                     des Servers und gegen die Kontosperre. Schreibende Anfragen
 *                     blind zu wiederholen ist ausserdem eine eigene Fehlerquelle.
 *                     Der beobachtete Fall (die Galerie) ist ein GET.
 *
 * ── Warum das eine eigene Funktion ist ──────────────────────────────────────
 *
 * Aus demselben Grund wie qrFehler() und fehlerTextId(): So braucht die Regel
 * keinen OkHttp-Stapel, keinen DataStore und kein Gerät — und ist damit
 * wirklich prüfbar, statt nur im Quelltext nachlesbar. Was schwer prüfbar ist,
 * ist meistens nicht zu kompliziert, sondern nur mit etwas verwoben, das es
 * nicht braucht.
 *
 * Ob ein Token VORLIEGT, steht bewusst nicht hier: Das ist kein Merkmal der
 * Anfrage, sondern ein Zustand, der sich zwischen zwei Aufrufen ändert.
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
