package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Fehlercode
/**
 * Ergebnis eines Serveraufrufs — genau zwei Fälle, damit jedes `when` erschöpfend
 * ist und eine neue Variante an jeder Stelle bricht, die sie behandeln muss. Bitte
 * keinen `else`-Zweig nachrüsten: Er verschluckte künftige Fälle still.
 */
sealed class Ergebnis<out T> {
    /**
     * [stand] ist gesetzt, wenn die Daten aus der lokalen Ablage kommen
     * (Millisekunden seit 1970, Zeitpunkt der Ablage) — sonst sähe ein alter Stand aus
     * wie ein frischer. [gepuffert]: Die Änderung liegt im Ausgang und geht raus,
     * sobald der Server erreichbar ist; [data] ist dann ein Ersatz, keine Serverantwort.
     */
    data class Erfolg<T>(val data: T, val stand: Long? = null, val gepuffert: Boolean = false) : Ergebnis<T>() {
        val veraltet: Boolean get() = stand != null
    }
    /**
     * Was schiefging, als geschlossene Hierarchie statt freier Felder: Wer nach der Art
     * verzweigt, schreibt ein erschöpfendes `when`, und ein neuer Fall bricht dort den
     * Build. Den Satz bildet die Anzeige (AppTexte.meldung()), die Datenschicht hat
     * keinen Context und kann nicht übersetzen.
     */
    sealed class Fehler : Ergebnis<Nothing>() {
        /** Der Satz des Servers zum Durchreichen, leer ohne einen; er kennt seine Fälle genauer. */
        open val message: String get() = ""

        /** Der Fehlercode des Servers: Nach ihm wird verzweigt, der Satz wechselt mit der Sprache. */
        open val code: Fehlercode? get() = null

        /** Text der Ursache, nur fürs Log: Bibliothekstexte sind englisch und kein Satz an Menschen. */
        open val technisch: String? get() = null

        /** Der Server war nicht erreichbar: Ein zweiter Versuch kann gelingen, der Plattenspeicher einspringen. */
        val transient: Boolean get() = when (this) {
            is Netz, Zeitueberschreitung -> true
            Abgebrochen, is LeereAntwort, is Abgewiesen, is Server, is Absage, Klartext, is Unbekannt -> false
        }

        /** Host nicht auflösbar, Verbindung abgelehnt oder unterwegs abgerissen. */
        data class Netz(override val technisch: String? = null) : Fehler()

        data object Zeitueberschreitung : Fehler()

        /** Abriss mitten im Ereignisstrom: Ob der Server schon schrieb, ist offen — darum nicht vorübergehend. */
        data object Abgebrochen : Fehler()

        /** HTTP 2xx ohne Rumpf. */
        data class LeereAntwort(override val technisch: String? = null) : Fehler()

        /** HTTP 401: Der Token gilt nicht (mehr). Kein Netzproblem, das ein Wiederholen behebt. */
        data class Abgewiesen(override val message: String = "", override val code: Fehlercode? = null) : Fehler()

        /** Jeder andere HTTP-Fehlerstatus, mit Satz und Code des Servers, wenn er welche schickte. */
        data class Server(
            val status: Int,
            override val message: String = "",
            override val code: Fehlercode? = null,
        ) : Fehler()

        /**
         * HTTP 2xx mit `success: false`: Der Server hat geantwortet und abgelehnt. Als Fehler,
         * damit kein Aufrufer ein Erfolgsfeld prüfen muss, das es nur im Wire-Format gibt.
         */
        data class Absage(override val message: String = "", override val code: Fehlercode? = null) : Fehler()

        /** Die Server-Adresse ist http; die App sendet nur über https (util/KlartextAbgelehnt). */
        data object Klartext : Fehler()

        /** Jede andere Ausnahme, ohne nähere Einordnung. */
        data class Unbekannt(override val technisch: String? = null) : Fehler()
    }
}

/** Die Daten eines Erfolgs umformen; Stand und Puffer bleiben, ein Fehler bleibt derselbe. */
internal inline fun <T, R> Ergebnis<T>.abgebildet(f: (T) -> R): Ergebnis<R> = when (this) {
    is Ergebnis.Erfolg -> Ergebnis.Erfolg(f(data), stand, gepuffert)
    is Ergebnis.Fehler -> this
}
