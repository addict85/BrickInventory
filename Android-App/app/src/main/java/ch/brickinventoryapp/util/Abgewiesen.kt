package ch.brickinventoryapp.util

/*
 * Was die App mit einem 401 macht — beide Entscheidungen an einer Stelle.
 *
 * Der Server antwortet auf ein fehlendes, ein ungueltiges und ein abgelaufenes
 * Token mit demselben Status und demselben Satz. Aus der Antwort allein laesst
 * sich also nicht ablesen, welcher der drei Faelle vorliegt — und genau daran
 * haengen zwei verschiedene Fragen:
 *
 *   darfNachfassen()        Geht die Anfrage noch einmal hinaus?
 *   istAbgelaufeneSitzung() Was steht danach auf dem Bildschirm?
 *
 * Beide beantworten sie mit demselben Unterschied: Ging ein Token mit oder
 * nicht. Deshalb stehen sie nebeneinander.
 */

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

/**
 * Ist dieser 401 eine abgelaufene Sitzung — oder eine Absage an der Anmeldung?
 *
 * ── Warum die Frage ueberhaupt gestellt werden muss ───────────────────
 *
 * Der Server antwortet in BEIDEN Faellen mit 401 und demselben Satz
 * „Ungültiger oder abgelaufener Token" (utils/fehlerTexte.ts, `token_ungueltig`).
 * Aus der Antwort allein ist nicht zu erkennen, was gemeint ist.
 *
 * Bisher zeigte die App bei einer abgelaufenen Sitzung deshalb ZWEI Meldungen:
 * der Interceptor meldete „Sitzung abgelaufen" und meldete ab, und der Abruf,
 * der den 401 kassiert hatte, schob den rohen Serversatz hinterher. Zwei
 * Meldungen zu einem Vorgang, und die zweite klingt nach einem zweiten Fehler.
 *
 * ── Der Unterschied ist derselbe wie im Interceptor ───────────────────
 *
 * Dort heisst er „ging ein Token mit?". Hier heisst er „war die App
 * angemeldet?" — dieselbe Aussage aus Sicht der Anzeige:
 *
 *   angemeldet      Der Token war da und wurde abgewiesen → die Sitzung ist
 *                   vorbei. Die Anzeige sagt das, EINMAL, und in ihren eigenen
 *                   Worten.
 *   nicht angemeldet  Es gab gar keine Sitzung — das ist ein
 *                   Anmeldeversuch, und 401 heisst dort „falsches Passwort".
 *                   Der Satz des Servers ist genau richtig und darf NICHT
 *                   durch „Sitzung abgelaufen" ersetzt werden.
 *
 * Genau dieselbe Form wie qrFehler() in SessionFeature.kt: ein Boolean statt
 * des ganzen Zustands, damit die Regel ohne UI-Zustand und ohne
 * Android-Laufzeit pruefbar ist.
 */
fun istAbgelaufeneSitzung(unauthorized: Boolean, angemeldet: Boolean): Boolean =
    unauthorized && angemeldet
