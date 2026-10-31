package ch.brickinventoryapp

import ch.brickinventoryapp.alarm.Alarmabholung
import ch.brickinventoryapp.data.model.PendingAlertsResponse
import ch.brickinventoryapp.data.model.Preisalarm
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.test.runTest
import org.junit.Test

/**
 * Was der stuendliche Abruf ENTSCHEIDET.
 *
 * ── Warum es diesen Test gibt ───────────────────────────────────────────────
 *
 * Der Worker selbst laeuft nur mit Android. Die Entscheidungen darin sind aber
 * genau die Sorte, die im Betrieb NICHT auffaellt, wenn sie falsch ist:
 *
 *   * Wird die Marke nicht fortgeschrieben, kommt dieselbe Meldung stuendlich
 *     wieder — und wer sie einmal weggewischt hat, haelt die naechste fuer
 *     eine neue.
 *   * Wird beim ersten Durchgang gemeldet, schlaegt eine frisch eingerichtete
 *     App mit Schwellen auf, die vor Wochen gerissen sind.
 *   * Wird nach einem Fehlschlag trotzdem markiert, ist die Meldung fuer
 *     immer verloren.
 *
 * Alle drei sind Aussagen ueber eine FOLGE von Durchgaengen. Am Quelltext
 * waere nur zu sehen, dass es eine Marke gibt.
 *
 * Deshalb nimmt [Alarmabholung.hole] die Abfrage als Parameter entgegen und
 * nicht das BrickRepository — die Begruendung steht dort.
 */
class AlarmabholungTest {

    private fun alarm(sn: String = "10179-1", richtung: String = "unter",
                      schwelle: Double = 200.0, preis: Double? = 100.0) =
        Preisalarm(setNumber = sn, condition = "N", richtung = richtung,
                   schwelle = schwelle, currencyCode = "EUR",
                   ausgeloest = true, zuletztAm = "2026-09-19T17:00:00.000Z",
                   zuletztPreis = preis)

    private fun antwort(vararg a: Preisalarm, now: String? = "2026-09-19T18:00:00.000Z") =
        Result.Success(PendingAlertsResponse(success = true, alerts = a.toList(), now = now))

    @Test
    fun `der erste Durchgang markiert nur und meldet nichts`() = runTest {
        // Leer und null muessen sich GLEICH verhalten: Auf einem Geraet, das
        // die Marke schon einmal geschrieben hat, kann sie leer sein.
        for (ohne in listOf(null, "", "   ")) {
            var gefragtMit: String? = "nicht gefragt"
            val e = Alarmabholung.hole(ohne) { seit ->
                gefragtMit = seit
                antwort(alarm())
            }
            assert(e is Alarmabholung.Ergebnis.Markiert) {
                "marke=${ohne?.let { "\"$it\"" }}: $e statt Markiert — eine frisch " +
                    "eingerichtete App wuerde mit alten Schwellen aufschlagen"
            }
            assert((e as Alarmabholung.Ergebnis.Markiert).neueMarke == "2026-09-19T18:00:00.000Z")
            assert(gefragtMit == null) {
                "Eine leere Marke wurde als `since` mitgeschickt: $gefragtMit"
            }
        }
    }

    @Test
    fun `ein weiterer Durchgang meldet und schreibt die Marke fort`() = runTest {
        var gefragtMit: String? = null
        val e = Alarmabholung.hole("2026-09-19T17:30:00.000Z") { seit ->
            gefragtMit = seit
            antwort(alarm(), alarm(sn = "75192-1"))
        }
        assert(e is Alarmabholung.Ergebnis.Geholt) { "$e statt Geholt" }
        e as Alarmabholung.Ergebnis.Geholt
        assert(e.meldungen.size == 2) { "${e.meldungen.size} Meldungen statt zwei" }
        // Die neue Marke ist die des SERVERS, nicht die mitgegebene und nicht
        // die Uhr des Telefons. Sonst entscheidet die Gangabweichung darueber,
        // ob eine Meldung doppelt kommt oder ausfaellt.
        assert(e.neueMarke == "2026-09-19T18:00:00.000Z") { "neueMarke=${e.neueMarke}" }
        assert(gefragtMit == "2026-09-19T17:30:00.000Z") { "gefragt mit $gefragtMit" }
    }

    @Test
    fun `eine leere Antwort ist der Normalfall und schreibt die Marke trotzdem fort`() = runTest {
        // Ohne das fragte der naechste Durchgang wieder ab dem alten Zeitpunkt
        // — und die Spanne wuechse mit jeder ruhigen Stunde.
        val e = Alarmabholung.hole("2026-09-19T17:30:00.000Z") { antwort() }
        assert(e is Alarmabholung.Ergebnis.Geholt) { "$e statt Geholt" }
        e as Alarmabholung.Ergebnis.Geholt
        assert(e.meldungen.isEmpty())
        assert(e.neueMarke == "2026-09-19T18:00:00.000Z")
    }

    @Test
    fun `ohne brauchbare Antwort bleibt die Marke, wie sie war`() = runTest {
        val kaputt = listOf<Pair<String, Result<PendingAlertsResponse>>>(
            "Netz weg" to Result.Error("offline", transient = true),
            "Server sagt nein" to Result.Success(PendingAlertsResponse(success = false)),
            // Eine aeltere Serverfassung kennt das Feld nicht. Dann lieber gar
            // keine Marke als eine falsche — es bleibt beim Mailversand.
            "kein Zeitpunkt" to Result.Success(PendingAlertsResponse(success = true, now = null)),
            "leerer Zeitpunkt" to Result.Success(PendingAlertsResponse(success = true, now = "")),
        )
        for ((warum, r) in kaputt) {
            val e = Alarmabholung.hole("2026-09-19T17:30:00.000Z") { r }
            assert(e is Alarmabholung.Ergebnis.Fehlgeschlagen) {
                "$warum: $e statt Fehlgeschlagen — die Meldung waere verloren"
            }
        }
    }

    @Test
    fun `der Text nennt Set, Preis und Schwelle — in der Waehrung des Alarms`() {
        // Nicht in der aktuellen Kontowaehrung: Die Schwelle wurde in jener
        // Waehrung gesetzt, und 200 CHF sind nicht 200 EUR.
        assert(Alarmabholung.text(alarm(), "faellt unter", "steigt ueber") ==
            "10179-1: EUR 100.00 (faellt unter EUR 200.00)")
        assert(Alarmabholung.text(alarm(richtung = "ueber", schwelle = 300.0, preis = 350.5),
                                  "faellt unter", "steigt ueber") ==
            "10179-1: EUR 350.50 (steigt ueber EUR 300.00)")
        // Ohne bekannten Preis bleibt die Aussage die Schwelle — ein
        // erfundener Preis waere schlimmer als keiner.
        assert(Alarmabholung.text(alarm(preis = null), "faellt unter", "steigt ueber") ==
            "10179-1: faellt unter EUR 200.00")
    }
}
