package ch.brickinventoryapp.alarm

/**
 * Was aus dem, was jemand ins Schwellenfeld tippt, wird. Gespeichert wird beim
 * Tippen, entprellt, wie der Kaufpreis — nicht erst beim Fokusverlust: Am Telefon
 * tippt man die Zahl, schliesst die Tastatur und geht zurück, und dieser
 * Fokuswechsel kommt nie. Ohne Ruhezeit legte „249.90“ unterwegs Schwellen an, die
 * niemand wollte; mit [RUHE_MS] bleibt die letzte.
 *
 * Hier und nicht im Bildschirm, weil sich ein Compose-Feld ohne Android nicht
 * ausführen lässt, diese Umrechnung schon — und sie trägt die teuerste
 * Entscheidung: Ein leeres Feld löscht den Alarm.
 */
object Alarmeingabe {

    /**
     * Wie lange Ruhe herrschen muss, bevor gespeichert wird. Dieselbe Zahl wie in der
     * Webapp (ALARM_RUHE in public/js/07-admin.js), damit sich dasselbe Feld an beiden
     * Stellen gleich verhält. 800 ms statt 350 wie bei der Suche: Ein Alarm legt etwas
     * an, und wer zwischen „24“ und „249.90“ kurz überlegt, soll keine Schwelle bei 24
     * bekommen, die sofort meldet.
     */
    const val RUHE_MS = 800L

    /**
     * Die getippte Zeichenkette als Zahl — oder `null`, wenn der Alarm weg soll. Das
     * Feld zu leeren ist die natürliche Geste, einen Alarm loszuwerden; ein eigener
     * Knopf wäre ein zweiter Weg für dieselbe Absicht.
     *
     * Das Komma wird zum Punkt: Auf einer deutschen Tastatur tippt man „249,90“, ohne
     * diese Zeile wäre das ein Löschen. Ein halber Anfang („-“, „abc“, „,“) ergibt
     * `null`. „249.“ dagegen nicht: `Double.parseDouble("249.")` ist 249.0, wie
     * `parseFloat` in der Webapp — beide setzen dort eine Schwelle.
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
