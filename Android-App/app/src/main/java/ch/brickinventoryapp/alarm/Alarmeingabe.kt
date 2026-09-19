package ch.brickinventoryapp.alarm

/**
 * Was aus dem, was jemand ins Schwellenfeld tippt, wird.
 *
 * ── Marcos Befund ───────────────────────────────────────────────────────────
 *
 * „Der Preisalarm wird nicht gespeichert. Sowohl in der Android-App als auch
 * in der Webapp soll der Preis gespeichert werden, wenn man was eintraegt.
 * Analog dem Kaufpreis."
 *
 * Gemessen war weder der Server schuld noch die Verdrahtung: Ein PUT auf
 * /api/v1/sets/…/alert legt die Zeile an, und das gebaute Frontend schickt
 * ihn auch. Schuld war der AUSLOESER. Beide Oberflaechen speicherten erst,
 * wenn das Feld den Fokus verliert — am Telefon tippt man die Zahl, schliesst
 * die Tastatur und geht zurueck, und dieser Fokuswechsel kommt nie.
 *
 * ── Warum entprellt und nicht je Tastendruck ────────────────────────────────
 *
 * Marcos Entscheidung: still beim Tippen. Ohne Ruhezeit erzeugte „249.90"
 * sechs Anfragen und legte dabei fuenf Schwellen an, die niemand wollte —
 * eine davon bei 2. Mit [RUHE_MS] bleibt genau die letzte uebrig.
 *
 * ── Warum das hier steht und nicht im Bildschirm ────────────────────────────
 *
 * Ein Compose-Feld laesst sich ohne Android nicht ausfuehren, diese
 * Umrechnung schon. Und sie traegt die Entscheidung, die am teuersten falsch
 * waere: Ein leeres Feld LOESCHT den Alarm.
 */
object Alarmeingabe {

    /**
     * Wie lange Ruhe herrschen muss, bevor gespeichert wird.
     *
     * Dieselbe Zahl wie in der Webapp (ALARM_RUHE in public/js/07-admin.js) —
     * laufen die beiden auseinander, verhaelt sich dasselbe Feld an zwei
     * Stellen verschieden, ohne dass es jemandem auffiele.
     *
     * 800 ms und nicht 350 wie bei der Suche: Eine Suche zeigt nur an, ein
     * Alarm legt etwas an. Wer zwischen „24" und „249.90" eine halbe Sekunde
     * ueberlegt, soll keine Schwelle bei 24 bekommen.
     */
    const val RUHE_MS = 800L

    /**
     * Die getippte Zeichenkette als Zahl — oder `null`, wenn der Alarm weg
     * soll.
     *
     * `null` heisst LOESCHEN, und das ist Absicht: Die natuerliche Geste,
     * einen Alarm loszuwerden, ist das Feld zu leeren. Ein eigener Knopf
     * daneben waere ein zweiter Weg fuer dieselbe Absicht.
     *
     * Das Komma wird zum Punkt: Auf einer deutschen Tastatur tippt man
     * „249,90". Ohne diese Zeile waere das keine Zahl, also ein Loeschen —
     * der Alarm verschwaende beim Eintippen.
     *
     * Eine halb getippte Zahl („249." oder „-") ergibt ebenfalls `null`. Das
     * ist der Grund, warum [RUHE_MS] nicht kuerzer sein darf: Mit einer sehr
     * kurzen Ruhezeit traefe der Zwischenstand den Server und loeschte, was
     * gerade entsteht.
     */
    fun zahl(roh: String): Double? {
        val z = roh.replace(',', '.').trim().toDoubleOrNull() ?: return null
        // Nicht-positive Schwellen sind kein Alarm, sondern einer, der nie
        // oder immer meldet. Der Server lehnt sie ebenfalls ab
        // (pruefeEingabe in utils/preisalarm.ts) — hier faengt es die Anfrage
        // schon vorher ab.
        return if (z > 0.0) z else null
    }
}
